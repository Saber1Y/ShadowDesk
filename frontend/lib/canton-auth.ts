import "server-only";
import { cookies } from "next/headers";
import { chmod, mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  getOidcConfig,
  jwtClaims,
  refreshTokens,
  revokeRefreshToken,
  type AuthorizationRequest,
  type OidcTokenSet,
  type OidcUser,
} from "@/lib/canton-oidc";

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
export const CANTON_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SESSION_DIR = process.env.SHADOWDESK_AUTH_SESSION_DIR || join(homedir(), ".config", "shadowdesk", "sessions");
const PENDING_DIR = join(SESSION_DIR, "pending");
const AUTH_STORE_PATH = process.env.SHADOWDESK_AUTH_STORE_PATH || join(homedir(), ".config", "shadowdesk", "hackcanton-auth.json");
const REFRESH_MARGIN_MS = 60_000;
const SESSION_TTL_MS = CANTON_SESSION_MAX_AGE_SECONDS * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;

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

export const getCantonSessionCookieOptions = (maxAge = CANTON_SESSION_MAX_AGE_SECONDS) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: cookieIsSecure(),
  path: "/",
  maxAge,
});

const isSessionId = (value: string): boolean => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

const readCookieSessionId = async (): Promise<string | undefined> => {
  try {
    return (await cookies()).get(CANTON_SESSION_COOKIE)?.value;
  } catch {
    return undefined;
  }
};

const sessionPath = (id: string): string => join(SESSION_DIR, `${id}.json`);
const authorizationPath = (state: string): string => join(PENDING_DIR, `${state}.json`);

export const storeAuthorizationRequest = async (request: AuthorizationRequest): Promise<void> => {
  await writeJsonFile(authorizationPath(request.state), { ...request, createdAt: Date.now() });
  await pruneExpiredFiles(PENDING_DIR, PENDING_TTL_MS);
};

export const consumeAuthorizationRequest = async (state: string): Promise<AuthorizationRequest> => {
  if (!isAuthorizationState(state)) {
    throw new CantonAuthError("expired", "The Canton login request is no longer valid.");
  }
  const path = authorizationPath(state);
  const pending = await readJsonFile<StoredAuthorization>(path);
  await removeFile(path);
  if (!pending || !pending.codeVerifier || !pending.nonce || Date.now() - pending.createdAt > PENDING_TTL_MS) {
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
  await writeJsonFile(sessionPath(session.id), session);
  await pruneExpiredFiles(SESSION_DIR, SESSION_TTL_MS);
  return session;
};

const getStoredSession = async (id: string): Promise<StoredSession | undefined> => {
  if (!isSessionId(id)) return undefined;
  const path = sessionPath(id);
  const session = await readJsonFile<StoredSession>(path);
  if (!session || session.id !== id || typeof session.accessToken !== "string" || !session.user?.sub) {
    await removeFile(path);
    return undefined;
  }
  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
    await removeFile(path);
    return undefined;
  }
  return session;
};

const saveSession = async (session: StoredSession): Promise<StoredSession> => {
  await writeJsonFile(sessionPath(session.id), session);
  return session;
};

const ensureSessionAccessToken = async (session: StoredSession): Promise<StoredSession> => {
  if (session.accessTokenExpiresAt > Date.now() + REFRESH_MARGIN_MS) return session;
  if (!session.refreshToken) {
    await removeFile(sessionPath(session.id));
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
      return await saveSession(next);
    } catch {
      await removeFile(sessionPath(session.id));
      throw new CantonAuthError("expired", "Your Canton session has expired. Connect the wallet again.");
    }
  })();
  sessionRefreshInFlight.set(session.id, refresh);
  try {
    return await refresh;
  } finally {
    sessionRefreshInFlight.delete(session.id);
  }
};

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

export const getCantonAuth = async (): Promise<CantonAuth> => {
  if (!isDevnet()) return { authenticated: false, source: "localnet" };
  const sessionId = await readCookieSessionId();
  if (sessionId) {
    const stored = await getStoredSession(sessionId);
    if (!stored) throw new CantonAuthError("expired", "Your Canton session has expired. Connect the wallet again.");
    const current = await ensureSessionAccessToken(stored);
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
  const sessionId = await readCookieSessionId();
  if (sessionId) {
    const stored = await getStoredSession(sessionId);
    if (!stored) return { mode: "devnet", authenticated: false, user: null, reason: "expired" };
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
  const sessionId = await readCookieSessionId();
  if (!sessionId || !isSessionId(sessionId)) return undefined;
  const session = await getStoredSession(sessionId);
  await removeFile(sessionPath(sessionId));
  return session;
};

export const revokeCantonSession = async (session: StoredSession): Promise<void> => {
  if (session.refreshToken) await revokeRefreshToken(getOidcConfig(), session.refreshToken);
};
