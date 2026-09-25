import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode, getOidcConfig, resolveOidcUser, safeReturnTo } from "@/lib/canton-oidc";
import {
  CANTON_SESSION_COOKIE,
  consumeAuthorizationRequest,
  createCantonSession,
  getCantonSessionCookieOptions,
} from "@/lib/canton-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const errorRedirect = (request: NextRequest, code: string) => NextResponse.redirect(
  new URL(`/?authError=${encodeURIComponent(code)}`, request.url),
);

export async function GET(request: NextRequest) {
  if (process.env.SHADOWDESK_NETWORK !== "devnet") return NextResponse.redirect(new URL("/?auth=localnet", request.url));
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) return errorRedirect(request, "provider");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return errorRedirect(request, "missing_code");
  try {
    const pending = await consumeAuthorizationRequest(state);
    const config = getOidcConfig();
    const tokens = await exchangeAuthorizationCode(config, code, pending.codeVerifier);
    const user = await resolveOidcUser(config, tokens, pending.nonce);
    const session = await createCantonSession(tokens, user);
    const response = NextResponse.redirect(new URL(safeReturnTo(pending.returnTo), request.url));
    response.cookies.set(CANTON_SESSION_COOKIE, session.id, getCantonSessionCookieOptions());
    return response;
  } catch {
    return errorRedirect(request, "callback");
  }
}
