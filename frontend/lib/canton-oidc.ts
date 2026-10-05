import "server-only";
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_ISSUER = "https://keycloak.naas.noders.services/realms/noders-appsfactory";
const DEFAULT_CLIENT_ID = "web-app-ui-hackcanton-01-devnet";
const DEFAULT_SCOPES = "openid profile email offline_access daml_ledger_api";

export interface OidcConfig {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
  endSessionEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
  redirectUri: string;
  postLogoutRedirectUri: string;
  scopes: string[];
}

export interface OidcTokenSet {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresIn: number;
  scope?: string;
}

export interface OidcUser {
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
}

export interface AuthorizationRequest {
  state: string;
  nonce: string;
  codeVerifier: string;
  codeChallenge: string;
  returnTo: string;
}

export class OidcError extends Error {
  constructor(
    public readonly code: "provider" | "token" | "userinfo" | "security",
    message: string,
    /**
     * The OAuth error code, when the provider supplied one.
     *
     * This is what separates "the provider could not be reached" from "this
     * refresh token is no longer valid". Only the second justifies discarding a
     * stored session, and treating a transient network failure as a dead session
     * signs the user out for no reason.
     */
    public readonly oauthError?: string,
  ) {
    super(message);
    this.name = "OidcError";
  }
}

/**
 * True when the provider definitively rejected the grant.
 *
 * `invalid_grant` is the provider saying the refresh token is expired, revoked or
 * already used, and no retry will change that. Anything else - a timeout, a 5xx,
 * a rate limit - may succeed on a second attempt.
 */
export const isDefinitiveTokenRejection = (e: unknown): boolean =>
  e instanceof OidcError && e.oauthError === "invalid_grant";

const valueOr = (value: string | undefined, fallback: string): string => value?.trim() || fallback;

export const getOidcConfig = (): OidcConfig => {
  const issuer = valueOr(process.env.SHADOWDESK_OIDC_ISSUER, DEFAULT_ISSUER).replace(/\/+$/, "");
  return {
    issuer,
    authorizationEndpoint: valueOr(process.env.SHADOWDESK_OIDC_AUTHORIZATION_URL, `${issuer}/protocol/openid-connect/auth`),
    tokenEndpoint: valueOr(process.env.SHADOWDESK_OIDC_TOKEN_URL, `${issuer}/protocol/openid-connect/token`),
    userinfoEndpoint: valueOr(process.env.SHADOWDESK_OIDC_USERINFO_URL, `${issuer}/protocol/openid-connect/userinfo`),
    endSessionEndpoint: valueOr(process.env.SHADOWDESK_OIDC_END_SESSION_URL, `${issuer}/protocol/openid-connect/logout`),
    revocationEndpoint: valueOr(process.env.SHADOWDESK_OIDC_REVOCATION_URL, `${issuer}/protocol/openid-connect/revoke`),
    clientId: valueOr(process.env.SHADOWDESK_OIDC_CLIENT_ID, DEFAULT_CLIENT_ID),
    redirectUri: valueOr(process.env.SHADOWDESK_OIDC_REDIRECT_URI, "http://localhost:3001/api/auth/callback"),
    postLogoutRedirectUri: valueOr(process.env.SHADOWDESK_OIDC_POST_LOGOUT_REDIRECT_URI, "http://localhost:3001/"),
    scopes: valueOr(process.env.SHADOWDESK_OIDC_SCOPES, DEFAULT_SCOPES).split(/\s+/).filter(Boolean),
  };
};

const base64Url = (value: Buffer): string => value.toString("base64url");

const challengeFor = (verifier: string): string => base64Url(createHash("sha256").update(verifier).digest());

export const createAuthorizationRequest = (returnTo: string): AuthorizationRequest => {
  const codeVerifier = base64Url(randomBytes(48));
  const state = base64Url(randomBytes(32));
  const nonce = base64Url(randomBytes(32));
  return {
    state,
    nonce,
    codeVerifier,
    codeChallenge: challengeFor(codeVerifier),
    returnTo: safeReturnTo(returnTo),
  };
};

export const buildAuthorizationUrl = (config: OidcConfig, request: AuthorizationRequest): string => {
  const url = new URL(config.authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(" "),
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
};

const decodeJwt = (token: string): Record<string, unknown> | undefined => {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
};

const audienceContains = (audience: unknown, clientId: string): boolean => {
  if (typeof audience === "string") return audience === clientId;
  if (!Array.isArray(audience)) return false;
  return audience.some((value) => value === clientId);
};

const scopesFrom = (accessClaims: Record<string, unknown>, tokenScope: string | undefined): string[] => {
  const claimScope = typeof accessClaims.scope === "string" ? accessClaims.scope : "";
  return `${claimScope} ${tokenScope ?? ""}`.split(/\s+/).filter(Boolean);
};

const requestTokens = async (config: OidcConfig, body: URLSearchParams): Promise<OidcTokenSet> => {
  let response: Response;
  try {
    response = await fetch(config.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OidcError("provider", "The Canton identity provider could not be reached.");
  }
  if (!response.ok) {
    // Read the OAuth error code out of the body; the status alone cannot tell a
    // dead refresh token from a provider having a bad minute.
    let oauthError: string | undefined;
    try {
      const parsed = (await response.json()) as Record<string, unknown>;
      if (typeof parsed.error === "string") oauthError = parsed.error;
    } catch {
      // A non-JSON error body is not itself informative.
    }
    throw new OidcError(
      "token",
      `The Canton identity provider rejected the token request (${response.status}${oauthError ? ` ${oauthError}` : ""}).`,
      oauthError,
    );
  }
  let data: Record<string, unknown>;
  try {
    data = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new OidcError("token", "The Canton identity provider returned an invalid token response.");
  }
  const accessToken = typeof data.access_token === "string" ? data.access_token : undefined;
  const expiresIn = typeof data.expires_in === "number" ? data.expires_in : Number(data.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    throw new OidcError("token", "The Canton identity provider returned an incomplete token response.");
  }
  return {
    accessToken,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    idToken: typeof data.id_token === "string" ? data.id_token : undefined,
    expiresIn,
    scope: typeof data.scope === "string" ? data.scope : undefined,
  };
};

export const exchangeAuthorizationCode = async (
  config: OidcConfig,
  code: string,
  codeVerifier: string,
): Promise<OidcTokenSet> => requestTokens(config, new URLSearchParams({
  client_id: config.clientId,
  grant_type: "authorization_code",
  code,
  code_verifier: codeVerifier,
  redirect_uri: config.redirectUri,
}));

export const refreshTokens = async (
  config: OidcConfig,
  refreshToken: string,
): Promise<OidcTokenSet> => requestTokens(config, new URLSearchParams({
  client_id: config.clientId,
  grant_type: "refresh_token",
  refresh_token: refreshToken,
}));

export const resolveOidcUser = async (
  config: OidcConfig,
  tokenSet: OidcTokenSet,
  nonce: string,
): Promise<OidcUser> => {
  const accessClaims = decodeJwt(tokenSet.accessToken);
  if (!accessClaims) throw new OidcError("security", "The Canton access token is not a readable JWT.");
  if (accessClaims.iss !== config.issuer) throw new OidcError("security", "The Canton access token issuer is invalid.");
  if (typeof accessClaims.exp !== "number" || accessClaims.exp * 1000 <= Date.now()) {
    throw new OidcError("security", "The Canton access token has expired.");
  }
  if (accessClaims.azp !== undefined && accessClaims.azp !== config.clientId) {
    throw new OidcError("security", "The Canton access token was issued to another client.");
  }
  if (!scopesFrom(accessClaims, tokenSet.scope).includes("daml_ledger_api")) {
    throw new OidcError("security", "The Canton identity is missing the Ledger API permission.");
  }
  const accessSubject = typeof accessClaims.sub === "string" ? accessClaims.sub : undefined;
  if (!accessSubject) throw new OidcError("security", "The Canton access token has no subject.");

  if (tokenSet.idToken) {
    const idClaims = decodeJwt(tokenSet.idToken);
    if (!idClaims || idClaims.iss !== config.issuer || !audienceContains(idClaims.aud, config.clientId)) {
      throw new OidcError("security", "The Canton identity token is invalid.");
    }
    if (idClaims.nonce !== nonce || idClaims.sub !== accessSubject) {
      throw new OidcError("security", "The Canton identity token failed nonce validation.");
    }
    if (typeof idClaims.exp !== "number" || idClaims.exp * 1000 <= Date.now()) {
      throw new OidcError("security", "The Canton identity token has expired.");
    }
  }

  let response: Response;
  try {
    response = await fetch(config.userinfoEndpoint, {
      headers: { Authorization: `Bearer ${tokenSet.accessToken}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new OidcError("userinfo", "The Canton identity profile could not be reached.");
  }
  if (!response.ok) throw new OidcError("userinfo", `The Canton identity profile request failed (${response.status}).`);
  let profile: Record<string, unknown>;
  try {
    profile = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new OidcError("userinfo", "The Canton identity profile returned invalid data.");
  }
  if (typeof profile.sub !== "string" || profile.sub !== accessSubject) {
    throw new OidcError("security", "The Canton identity profile does not match the access token.");
  }
  return {
    sub: profile.sub,
    email: typeof profile.email === "string" ? profile.email : undefined,
    name: typeof profile.name === "string" ? profile.name : undefined,
    preferredUsername: typeof profile.preferred_username === "string" ? profile.preferred_username : undefined,
  };
};

export const getLogoutUrl = (config: OidcConfig, idToken?: string): string => {
  const url = new URL(config.endSessionEndpoint);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("post_logout_redirect_uri", config.postLogoutRedirectUri);
  if (idToken) url.searchParams.set("id_token_hint", idToken);
  return url.toString();
};

export const revokeRefreshToken = async (config: OidcConfig, refreshToken: string): Promise<void> => {
  try {
    await fetch(config.revocationEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    return;
  }
};

export const jwtClaims = (token: string): Record<string, unknown> | undefined => decodeJwt(token);

export const safeReturnTo = (value: string | undefined): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "http://shadowdesk.local");
    if (url.origin !== "http://shadowdesk.local") return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
};
