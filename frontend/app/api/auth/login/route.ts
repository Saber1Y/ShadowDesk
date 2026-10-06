import { NextRequest, NextResponse } from "next/server";
import { buildAuthorizationUrl, createAuthorizationRequest, getOidcConfig } from "@/lib/canton-oidc";
import { storeAuthorizationRequest } from "@/lib/canton-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (process.env.SHADOWDESK_NETWORK !== "devnet") {
    return NextResponse.redirect(new URL("/?auth=localnet", request.url));
  }
  try {
    const requestForAuthorization = createAuthorizationRequest(request.nextUrl.searchParams.get("returnTo") ?? "/");
    const response = NextResponse.redirect(buildAuthorizationUrl(getOidcConfig(), requestForAuthorization));
    storeAuthorizationRequest(response.cookies, requestForAuthorization);
    return response;
  } catch {
    return NextResponse.redirect(new URL("/?authError=configuration", request.url));
  }
}
