import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode, getOidcConfig, resolveOidcUser, safeReturnTo } from "@/lib/canton-oidc";
import {
  CantonAuthError,
  clearAuthorizationCookie,
  consumeAuthorizationRequest,
  createCantonSession,
  writeSessionCookie,
} from "@/lib/canton-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorRedirect = (request: NextRequest, code: string) => {
  const response = NextResponse.redirect(new URL(`/?authError=${encodeURIComponent(code)}`, request.url));
  clearAuthorizationCookie(response.cookies);
  return response;
};

export async function GET(request: NextRequest) {
  if (process.env.SHADOWDESK_NETWORK !== "devnet") return NextResponse.redirect(new URL("/?auth=localnet", request.url));
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) return errorRedirect(request, "provider");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return errorRedirect(request, "missing_code");
  try {
    const pending = consumeAuthorizationRequest(request.cookies, state);
    const config = getOidcConfig();
    const tokens = await exchangeAuthorizationCode(config, code, pending.codeVerifier);
    const user = await resolveOidcUser(config, tokens, pending.nonce);
    const session = await createCantonSession(tokens, user);
    const response = NextResponse.redirect(new URL(safeReturnTo(pending.returnTo), request.url));
    writeSessionCookie(response.cookies, session);
    clearAuthorizationCookie(response.cookies);
    return response;
  } catch (err) {
    // A broken session secret is a deployment problem, not a failed handshake;
    // say so instead of blaming the callback.
    const code = err instanceof CantonAuthError && err.code === "configuration" ? "configuration" : "callback";
    return errorRedirect(request, code);
  }
}
