import "server-only";
import { cookies } from "next/headers";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getOidcConfig,
  isDefinitiveTokenRejection,
  jwtClaims,
  refreshTokens,
  revokeRefreshToken,
  type AuthorizationRequest,
  type OidcTokenSet,
  type OidcUser,
} from "@/lib/canton-oidc";
import {
  MAX_COOKIE_CHUNKS,
  SessionCookieError,
  chunkCookieName,
  openPayload,
  sealPayload,
} from "@/lib/session-cookie";

interface AuthStore {
  refreshToken: string;
}

export type CantonUser = OidcUser;

export type CantonAuthSource = "wallet" | "environment" | "localnet";

export interface CantonAuth {
  accessToken?: string;
  ledgerUserId?: string;
  user?: CantonUser;
  authenticated: boolean;
  source: CantonAuthSource;
}

export interface CantonAuthStatus {
  mode: "localnet" | "devnet";
  authenticated: boolean;
  user: CantonUser | null;
  source?: CantonAuthSource;
  reason?: "expired" | "configuration";
}

export type CantonAuthErrorCode = "missing" | "expired" | "provider" | "configuration";

export class CantonAuthError extends Error {
  constructor(
    public readonly code: CantonAuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CantonAuthError";
  }
}

export const CANTON_SESSION_COOKIE = "shadowdesk_canton_session";
export const CANTON_AUTHZ_COOKIE = "shadowdesk_authz";
export const CANTON_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SESSION_PURPOSE = "canton-session";
const AUTHZ_PURPOSE = "canton-authz";
const AUTHZ_TTL_MS = 10 * 60 * 1000;

const SESSION_DIR = process.env.SHADOWDESK_AUTH_SESSION_DIR || join(homedir(), ".config", "shadowdesk", "sessions");
const AUTH_STORE_PATH = process.env.SHADOWDESK_AUTH_STORE_PATH || join(homedir(), ".config", "shadowdesk", "hackcanton-auth.json");
const REFRESH_MARGIN_MS = 60_000;
const SESSION_TTL_MS = CANTON_SESSION_MAX_AGE_SECONDS * 1000;

interface StoredSession {
  id: string;
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  accessTokenExpiresAt: number;
  createdAt: number;
  expiresAt: number;
  user: CantonUser;
}

interface StoredAuthorization extends AuthorizationRequest {
  createdAt: number;
}

/** Minimal read view over a request's cookie jar. */
export interface CantonCookieSource {
  get(name: string): { value: string } | undefined;
}

export interface CantonCookieOptions {
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  path: string;
  maxAge: number;
}

/** Minimal write view: satisfied by NextResponse.cookies and the next/headers cookie store. */
export interface CantonCookieSink {
  set(name: string, value: string, options: CantonCookieOptions): unknown;
}

interface RequestJars {
  source: CantonCookieSource;
  sink: CantonCookieSink;
}

let environmentAccessToken: string | undefined;
let environmentAccessTokenExpiresAt = 0;
let environmentRefreshToken: string | undefined;
let environmentRefreshInFlight: Promise<string> | undefined;
const sessionRefreshInFlight = new Map<string, Promise<StoredSession>>();

const isDevnet = (): boolean => process.env.SHADOWDESK_NETWORK === "devnet";

const cookieIsSecure = (): boolean => {
  const configured = process.env.SHADOWDESK_AUTH_COOKIE_SECURE;
  if (configured === "true") return true;
  if (configured === "false") return false;
  return process.env.NODE_ENV === "production";
};

export const getCantonSessionCookieOptions = (maxAge = CANTON_SESSION_MAX_AGE_SECONDS): CantonCookieOptions => ({
  httpOnly: true,
  sameSite: "lax",
  secure: cookieIsSecure(),
  path: "/",
  maxAge,
});

const isAuthorizationState = (value: string): boolean => /^[A-Za-z0-9_-]{40,100}$/.test(value);

const ensureDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
};

const writeJsonFile = async (path: string, value: unknown): Promise<void> => {
  const directory = dirname(path);
  if (directory !== ".") await ensureDirectory(directory);
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value), { mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (err) {
    await removeFile(temporaryPath);
    throw err;
  }
};

const readJsonFile = async <T>(path: string): Promise<T | undefined> => {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

const removeFile = async (path: string): Promise<void> => {
  try {
    await unlink(path);
  } catch {
    return;
  }
};

const pruneExpiredFiles = async (directory: string, olderThanMs: number): Promise<void> => {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }
  const cutoff = Date.now() - olderThanMs;
  await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json") || entry.endsWith(".tmp"))
      .map(async (entry) => {
        try {
          if ((await stat(join(directory, entry))).mtimeMs < cutoff) await removeFile(join(directory, entry));
        } catch {
          return;
        }
      }),
  );
};

const sessionPath = (id: string): string => join(SESSION_DIR, `${id}.json`);

// ---------------------------------------------------------------------------
// Sealed cookie payloads
// ---------------------------------------------------------------------------

const readSealedPayload = <T>(source: CantonCookieSource, baseName: string, purpose: string): T | undefined => {
  try {
    return openPayload<T>(purpose, (index) => source.get(chunkCookieName(baseName, index))?.value);
  } catch (err) {
    if (err instanceof SessionCookieError) {
      throw new CantonAuthError("configuration", `Session storage is not configured correctly: ${err.message}`);
    }
    throw err;
  }
};

const writeSealedPayload = (
  sink: CantonCookieSink,
  baseName: string,
  purpose: string,
  payload: unknown,
  maxAge: number,
): void => {
  let chunks: string[];
  try {
    chunks = sealPayload(purpose, payload);
  } catch (err) {
    if (err instanceof SessionCookieError) {
      throw new CantonAuthError("configuration", `Session storage is not configured correctly: ${err.message}`);
    }
    throw err;
  }
  const options = getCantonSessionCookieOptions(maxAge);
  chunks.forEach((value, index) => sink.set(chunkCookieName(baseName, index), value, options));
  // A previous, larger payload may have used continuation chunks that this one
  // does not; leaving them behind would splice stale bytes onto the next read.
  const expired = getCantonSessionCookieOptions(0);
  for (let index = chunks.length; index < MAX_COOKIE_CHUNKS; index += 1) {
    sink.set(chunkCookieName(baseName, index), "", expired);
  }
};

const clearSealedPayload = (sink: CantonCookieSink, baseName: string): void => {
  const expired = getCantonSessionCookieOptions(0);
  for (let index = 0; index < MAX_COOKIE_CHUNKS; index += 1) {
    sink.set(chunkCookieName(baseName, index), "", expired);
  }
};

/** The browser-facing session cookie. maxAge tracks the session's own expiry. */
export const writeSessionCookie = (sink: CantonCookieSink, session: StoredSession): void => {
  const maxAge = Math.max(60, Math.ceil((session.expiresAt - Date.now()) / 1000));
  writeSealedPayload(sink, CANTON_SESSION_COOKIE, SESSION_PURPOSE, session, maxAge);
};

export const clearSessionCookies = (sink: CantonCookieSink): void => {
  clearSealedPayload(sink, CANTON_SESSION_COOKIE);
};

export const clearAuthorizationCookie = (sink: CantonCookieSink): void => {
  clearSealedPayload(sink, CANTON_AUTHZ_COOKIE);
};

const requestJars = async (): Promise<RequestJars | undefined> => {
  try {
    const jar = await cookies();
    return { source: jar, sink: jar };
  } catch {
    // Outside a request scope there is no browser session to read or write.
    return undefined;
  }
};

// ---------------------------------------------------------------------------
// Local session mirror
//
// The cookie is the source of truth everywhere. On a developer machine the
// session is additionally mirrored to disk so with-devnet-auth.sh and the
// agent scripts can reuse the same tokens. Serverless hosts skip the mirror:
// their filesystem is not shared across invocations.
// ---------------------------------------------------------------------------

const mirrorSessions = (): boolean => !process.env.VERCEL;

const writeSessionMirror = async (session: StoredSession): Promise<void> => {
  if (!mirrorSessions()) return;
  await writeJsonFile(sessionPath(session.id), session);
  await pruneExpiredFiles(SESSION_DIR, SESSION_TTL_MS);
};

const removeSessionMirror = async (id: string): Promise<void> => {
  if (!mirrorSessions()) return;
  await removeFile(sessionPath(id));
};

// ---------------------------------------------------------------------------
// Authorization request (login -> callback handoff)
// ---------------------------------------------------------------------------

export const storeAuthorizationRequest = (sink: CantonCookieSink, request: AuthorizationRequest): void => {
  writeSealedPayload(
    sink,
    CANTON_AUTHZ_COOKIE,
    AUTHZ_PURPOSE,
    { ...request, createdAt: Date.now() },
    Math.ceil(AUTHZ_TTL_MS / 1000),
  );
};

export const consumeAuthorizationRequest = (source: CantonCookieSource, state: string): AuthorizationRequest => {
  if (!isAuthorizationState(state)) {
    throw new CantonAuthError("expired", "The Canton login request is no longer valid.");
  }
  const pending = readSealedPayload<StoredAuthorization>(source, CANTON_AUTHZ_COOKIE, AUTHZ_PURPOSE);
  if (
    !pending ||
    !pending.codeVerifier ||
    !pending.nonce ||
    pending.state !== state ||
    Date.now() - pending.createdAt > AUTHZ_TTL_MS
  ) {
    throw new CantonAuthError("expired", "The Canton login request has expired. Start the connection again.");
  }
  return {
    state: pending.state,
    nonce: pending.nonce,
    codeVerifier: pending.codeVerifier,
    codeChallenge: pending.codeChallenge,
    returnTo: pending.returnTo,
  };
};

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------

export const createCantonSession = async (tokens: OidcTokenSet, user: CantonUser): Promise<StoredSession> => {
  const createdAt = Date.now();
  const accessTokenExpiresAt = createdAt + tokens.expiresIn * 1000;
  const session: StoredSession = {
    id: randomUUID(),
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken,
    accessTokenExpiresAt,
    createdAt,
    expiresAt: tokens.refreshToken ? createdAt + SESSION_TTL_MS : accessTokenExpiresAt,
    user,
  };
  await writeSessionMirror(session);
  return session;
};

const validateSession = (session: StoredSession | undefined): StoredSession | undefined => {
  if (
    !session ||
    typeof session.id !== "string" ||
    session.id.length === 0 ||
    typeof session.accessToken !== "string" ||
    !session.user?.sub
  ) {
    return undefined;
  }
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) return undefined;
  return session;
};

const readStoredSession = (source: CantonCookieSource): StoredSession | undefined =>
  validateSession(readSealedPayload<StoredSession>(source, CANTON_SESSION_COOKIE, SESSION_PURPOSE));

const persistSession = async (sink: CantonCookieSink, session: StoredSession): Promise<StoredSession> => {
  writeSessionCookie(sink, session);
  await writeSessionMirror(session);
  return session;
};

const ensureSessionAccessToken = async (sink: CantonCookieSink, session: StoredSession): Promise<StoredSession> => {
  if (session.accessTokenExpiresAt > Date.now() + REFRESH_MARGIN_MS) return session;
  if (!session.refreshToken) {
    await removeSessionMirror(session.id);
    clearSessionCookies(sink);
    throw new CantonAuthError("expired", "Your Canton session has expired. Connect the wallet again.");
  }
  const inFlight = sessionRefreshInFlight.get(session.id);
  if (inFlight) return inFlight;
  const refreshToken = session.refreshToken;
  const refresh = (async () => {
    try {
      const refreshed = await refreshTokens(getOidcConfig(), refreshToken);
      const next: StoredSession = {
        ...session,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken ?? refreshToken,
        idToken: refreshed.idToken ?? session.idToken,
        accessTokenExpiresAt: Date.now() + refreshed.expiresIn * 1000,
      };
      // Persisted once, here: the response that ran the refresh carries the
      // rotated tokens to the browser. Concurrent requests that awaited this
      // same promise reuse the result without re-sending the cookie.
      return await persistSession(sink, next);
    } catch (e) {
      // Only a definitive rejection retires the session. A timeout or a provider
      // outage leaves a perfectly valid refresh token behind, and clearing the
      // session on those turned a momentary network blip into a full sign-out
      // with no way back except the browser.
      if (isDefinitiveTokenRejection(e)) {
        await removeSessionMirror(session.id);
        clearSessionCookies(sink);
        throw new CantonAuthError("expired", "Your Canton session has expired. Connect the wallet again.");
      }
      // Keep the session so a later request can retry, and say what actually went
      // wrong rather than reporting an expiry that did not happen.
      throw new CantonAuthError(
        "configuration",
        `Could not refresh your Canton session: ${(e as Error).message} Your session is kept; retry in a moment.`,
      );
    }
  })();
  sessionRefreshInFlight.set(session.id, refresh);
  try {
    return await refresh;
  } finally {
    sessionRefreshInFlight.delete(session.id);
  }
};

// ---------------------------------------------------------------------------
// Environment (service) auth, used when no browser session exists
// ---------------------------------------------------------------------------

const persistEnvironmentRefreshToken = async (nextToken: string): Promise<void> => {
  await writeJsonFile(AUTH_STORE_PATH, { refreshToken: nextToken } satisfies AuthStore);
};

const readEnvironmentRefreshToken = async (): Promise<string | undefined> => {
  if (environmentRefreshToken) return environmentRefreshToken;
  const stored = await readJsonFile<Partial<AuthStore>>(AUTH_STORE_PATH);
  if (typeof stored?.refreshToken === "string" && stored.refreshToken.length > 0) {
    environmentRefreshToken = stored.refreshToken;
    return environmentRefreshToken;
  }
  const fromEnvironment = process.env.SHADOWDESK_CANTON_REFRESH_TOKEN;
  if (fromEnvironment) environmentRefreshToken = fromEnvironment;
  return environmentRefreshToken;
};

const refreshEnvironmentAccessToken = async (): Promise<string> => {
  if (environmentRefreshInFlight) return environmentRefreshInFlight;
  environmentRefreshInFlight = (async () => {
    const refreshToken = await readEnvironmentRefreshToken();
    if (!refreshToken) {
      throw new CantonAuthError("missing", "Connect the Canton wallet to continue.");
    }
    try {
      const refreshed = await refreshTokens(getOidcConfig(), refreshToken);
      environmentAccessToken = refreshed.accessToken;
      environmentAccessTokenExpiresAt = Date.now() + refreshed.expiresIn * 1000;
      if (refreshed.refreshToken) {
        environmentRefreshToken = refreshed.refreshToken;
        await persistEnvironmentRefreshToken(refreshed.refreshToken);
      }
      return refreshed.accessToken;
    } catch {
      throw new CantonAuthError("expired", "The configured Canton token has expired. Connect the wallet again.");
    }
  })();
  try {
    return await environmentRefreshInFlight;
  } finally {
    environmentRefreshInFlight = undefined;
  }
};

const getEnvironmentAuth = async (): Promise<CantonAuth> => {
  const configuredToken = process.env.SHADOWDESK_CANTON_ACCESS_TOKEN;
  if (!environmentAccessToken && configuredToken) {
    environmentAccessToken = configuredToken;
    const exp = jwtClaims(configuredToken)?.exp;
    environmentAccessTokenExpiresAt = typeof exp === "number" ? exp * 1000 : Number.POSITIVE_INFINITY;
  }
  if (!environmentAccessToken || environmentAccessTokenExpiresAt <= Date.now() + REFRESH_MARGIN_MS) {
    await refreshEnvironmentAccessToken();
  }
  const accessToken = environmentAccessToken;
  if (!accessToken) throw new CantonAuthError("missing", "Connect the Canton wallet to continue.");
  const claims = jwtClaims(accessToken);
  const subject = typeof claims?.sub === "string" && claims.sub.length > 0 ? claims.sub : undefined;
  const ledgerUserId = process.env.SHADOWDESK_LEDGER_USER_ID || subject;
  if (!ledgerUserId) {
    throw new CantonAuthError("configuration", "The Canton identity is missing a Ledger user ID.");
  }
  return {
    accessToken,
    ledgerUserId,
    user: subject
      ? {
          sub: subject,
          email: typeof claims?.email === "string" ? claims.email : undefined,
          name: typeof claims?.name === "string" ? claims.name : undefined,
          preferredUsername: typeof claims?.preferred_username === "string" ? claims.preferred_username : undefined,
        }
      : undefined,
    authenticated: true,
    source: "environment",
  };
};

// ---------------------------------------------------------------------------
// Public auth surface
// ---------------------------------------------------------------------------

export const getCantonAuth = async (): Promise<CantonAuth> => {
  if (!isDevnet()) return { authenticated: false, source: "localnet" };
  const jars = await requestJars();
  const hasSessionCookie = jars?.source.get(CANTON_SESSION_COOKIE) !== undefined;
  if (jars && hasSessionCookie) {
    const stored = readStoredSession(jars.source);
    if (!stored) throw new CantonAuthError("expired", "Your Canton session has expired. Connect the wallet again.");
    const current = await ensureSessionAccessToken(jars.sink, stored);
    return {
      accessToken: current.accessToken,
      ledgerUserId: process.env.SHADOWDESK_LEDGER_USER_ID || current.user.sub,
      user: current.user,
      authenticated: true,
      source: "wallet",
    };
  }
  return getEnvironmentAuth();
};

export const getCantonAuthStatus = async (): Promise<CantonAuthStatus> => {
  if (!isDevnet()) return { mode: "localnet", authenticated: false, user: null };
  const jars = await requestJars();
  const hasSessionCookie = jars?.source.get(CANTON_SESSION_COOKIE) !== undefined;
  if (jars && hasSessionCookie) {
    if (!readStoredSession(jars.source)) return { mode: "devnet", authenticated: false, user: null, reason: "expired" };
    try {
      const auth = await getCantonAuth();
      return { mode: "devnet", authenticated: auth.authenticated, user: auth.user ?? null, source: auth.source };
    } catch (err) {
      return { mode: "devnet", authenticated: false, user: null, reason: err instanceof CantonAuthError && err.code === "expired" ? "expired" : "configuration" };
    }
  }
  if (!process.env.SHADOWDESK_CANTON_ACCESS_TOKEN && !process.env.SHADOWDESK_CANTON_REFRESH_TOKEN) {
    return { mode: "devnet", authenticated: false, user: null };
  }
  try {
    const auth = await getEnvironmentAuth();
    return { mode: "devnet", authenticated: auth.authenticated, user: auth.user ?? null, source: auth.source };
  } catch {
    return { mode: "devnet", authenticated: false, user: null, reason: "expired" };
  }
};

export const clearCantonSession = async (): Promise<StoredSession | undefined> => {
  const jars = await requestJars();
  const session = jars ? readStoredSession(jars.source) : undefined;
  if (session) await removeSessionMirror(session.id);
  return session;
};

export const revokeCantonSession = async (session: StoredSession): Promise<void> => {
  if (session.refreshToken) await revokeRefreshToken(getOidcConfig(), session.refreshToken);
};
