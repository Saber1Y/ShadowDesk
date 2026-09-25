import { NextRequest, NextResponse } from "next/server";
import { getLogoutUrl, getOidcConfig } from "@/lib/canton-oidc";
import {
  CANTON_SESSION_COOKIE,
  clearCantonSession,
  getCantonSessionCookieOptions,
  revokeCantonSession,
} from "@/lib/canton-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await clearCantonSession();
  let destination = new URL("/?auth=signed-out", request.url);
  if (session) {
    await revokeCantonSession(session);
    destination = new URL(getLogoutUrl(getOidcConfig(), session.idToken));
  }
  const response = NextResponse.redirect(destination, { status: 303 });
  response.cookies.set(CANTON_SESSION_COOKIE, "", getCantonSessionCookieOptions(0));
  return response;
}
