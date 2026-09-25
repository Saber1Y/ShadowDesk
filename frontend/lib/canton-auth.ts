import "server-only";
import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface AuthStore {
  refreshToken: string;
}

export interface CantonAuth {
  accessToken?: string;
  ledgerUserId?: string;
}

const DEVNET_TOKEN_URL =
  "https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token";
const DEVNET_CLIENT_ID = "web-app-ui-hackcanton-01-devnet";
const AUTH_STORE_PATH = process.env.SHADOWDESK_AUTH_STORE_PATH || join(homedir(), ".config", "shadowdesk", "hackcanton-auth.json");
const REFRESH_MARGIN_MS = 60_000;

let accessToken: string | undefined;
let accessTokenExpiresAt = 0;
let refreshToken: string | undefined;
let refreshInFlight: Promise<string> | undefined;

const jwtClaims = (token: string): Record<string, unknown> | undefined => {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const readRefreshToken = async (): Promise<string | undefined> => {
  if (refreshToken) return refreshToken;
  try {
    const store = JSON.parse(await readFile(AUTH_STORE_PATH, "utf8")) as Partial<AuthStore>;
    if (typeof store.refreshToken === "string" && store.refreshToken.length > 0) {
      refreshToken = store.refreshToken;
      return refreshToken;
    }
  } catch {
    // A missing or unreadable local store falls back to the environment value.
  }
  const fromEnv = process.env.SHADOWDESK_CANTON_REFRESH_TOKEN;
  if (fromEnv) refreshToken = fromEnv;
  return refreshToken;
};

const persistRefreshToken = async (nextToken: string): Promise<void> => {
  const directory = dirname(AUTH_STORE_PATH);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const temporaryPath = `${AUTH_STORE_PATH}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ refreshToken: nextToken }), { mode: 0o600 });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, AUTH_STORE_PATH);
  await chmod(AUTH_STORE_PATH, 0o600);
};

const refreshAccessToken = async (): Promise<string> => {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const token = await readRefreshToken();
    if (!token) {
      throw new Error("DevNet authentication is missing. Set SHADOWDESK_CANTON_REFRESH_TOKEN locally.");
    }
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.SHADOWDESK_OIDC_CLIENT_ID ?? DEVNET_CLIENT_ID,
      refresh_token: token,
    });
    const response = await fetch(process.env.SHADOWDESK_OIDC_TOKEN_URL ?? DEVNET_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`DevNet token refresh failed (${response.status}). Re-authenticate through the HackCanton Wallet.`);
    }
    const data = (await response.json()) as TokenResponse;
    if (!data.access_token || !data.expires_in) {
      throw new Error("DevNet token refresh returned an incomplete response.");
    }
    accessToken = data.access_token;
    accessTokenExpiresAt = Date.now() + data.expires_in * 1000;
    if (data.refresh_token) {
      refreshToken = data.refresh_token;
      await persistRefreshToken(data.refresh_token);
    }
    return data.access_token;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = undefined;
  }
};

export const getCantonAuth = async (): Promise<CantonAuth> => {
  if (process.env.SHADOWDESK_NETWORK !== "devnet") return {};

  const staticToken = process.env.SHADOWDESK_CANTON_ACCESS_TOKEN;
  if (!accessToken && staticToken) {
    accessToken = staticToken;
    const exp = jwtClaims(staticToken)?.exp;
    accessTokenExpiresAt = typeof exp === "number" ? exp * 1000 : Number.POSITIVE_INFINITY;
  }
  if (!accessToken || accessTokenExpiresAt <= Date.now() + REFRESH_MARGIN_MS) {
    await refreshAccessToken();
  }
  const claims = jwtClaims(accessToken!);
  const configuredUserId = process.env.SHADOWDESK_LEDGER_USER_ID;
  const subject = claims?.sub;
  const ledgerUserId = configuredUserId ?? (typeof subject === "string" ? subject : undefined);
  if (!ledgerUserId) {
    throw new Error("DevNet JWT has no subject. Set SHADOWDESK_LEDGER_USER_ID to the Ledger user ID from the Console.");
  }
  return { accessToken, ledgerUserId };
};
