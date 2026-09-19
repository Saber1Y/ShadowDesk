import { NextResponse } from "next/server";
import { loadDashboardState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  try {
    const state = await loadDashboardState();
    return NextResponse.json(state);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 },
    );
  }
}