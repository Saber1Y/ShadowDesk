import { NextResponse } from "next/server";
import { CantonAuthError } from "@/lib/canton-auth";
import { loadDashboardState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const state = await loadDashboardState();
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof CantonAuthError) {
      const authRequired = err.code === "missing" || err.code === "expired";
      return NextResponse.json(
        { error: err.message, authRequired },
        { status: authRequired ? 401 : 503, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
