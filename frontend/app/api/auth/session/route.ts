import { NextResponse } from "next/server";
import { getCantonAuthStatus } from "@/lib/canton-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json(await getCantonAuthStatus(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ mode: "devnet", authenticated: false, user: null, reason: "configuration" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
