import { spawn } from "node:child_process";
import { getCantonAuth } from "@/lib/canton-auth";
import { loadDashboardState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let running = false;
const ASSET_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

const DEVNET_PARTY_VARIABLES = [
  "SHADOWDESK_BUYER_PARTY",
  "SHADOWDESK_RISK_OFFICER_PARTY",
  "SHADOWDESK_DEALER_A_PARTY",
  "SHADOWDESK_DEALER_B_PARTY",
];

export async function POST(request: Request) {
  let cantonAccessToken: string | undefined;
  if (process.env.SHADOWDESK_NETWORK === "devnet") {
    const missing = DEVNET_PARTY_VARIABLES.filter((name) => !process.env[name]);
    if (missing.length > 0) {
      return Response.json({
        ok: false,
        reason: `DevNet needs a party for each role. Missing: ${missing.join(", ")}.`,
      }, { status: 400 });
    }
    const auth = await getCantonAuth();
    if (!auth.accessToken) {
      return Response.json({ ok: false, reason: "Sign in before running a round." }, { status: 401 });
    }
    cantonAccessToken = auth.accessToken;
  }

  if (running) {
    return new Response(JSON.stringify({ ok: false, reason: "A round is already running." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = Number(body.amount ?? 1_000_000);
  const maxPrice = Number(body.maxPrice ?? 101);
  const assetToBuy = String(body.assetToBuy ?? "cTBILL");
  const settlementAsset = String(body.settlementAsset ?? "cUSDC");
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(maxPrice) || maxPrice <= 0) {
    return Response.json({ ok: false, reason: "Enter positive values for amount and maximum price." }, { status: 400 });
  }
  if (!ASSET_SYMBOL.test(assetToBuy) || !ASSET_SYMBOL.test(settlementAsset)) {
    return Response.json({ ok: false, reason: "Use asset symbols with 1-32 letters, numbers, dots, dashes, or underscores." }, { status: 400 });
  }
  if (assetToBuy === settlementAsset) {
    return Response.json({ ok: false, reason: "The security and settlement instrument must be different." }, { status: 400 });
  }

  running = true;
  const agentRoot = process.env.AGENTS_ROOT ?? "/Users/mac/codes/Shadow Desk/agents";
  const child = spawn("npm", ["run", "demo"], {
    cwd: agentRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      ...(cantonAccessToken ? { SHADOWDESK_CANTON_ACCESS_TOKEN: cantonAccessToken } : {}),
      SHADOWDESK_AMOUNT: String(amount),
      SHADOWDESK_MAX_PRICE: String(maxPrice),
      SHADOWDESK_ASSET_TO_BUY: assetToBuy,
      SHADOWDESK_SETTLEMENT_ASSET: settlementAsset,
    },
  });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (obj: unknown) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
        } catch {
          /* client gone */
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) emit({ line });
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) emit({ line });
        }
      });

      const close = async (ok: boolean) => {
        try {
          const state = await loadDashboardState();
          emit({ snapshot: state });
          emit({ done: ok });
        } catch (err) {
          emit({ snapshotError: (err as Error).message, done: false });
        } finally {
          running = false;
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };

      child.on("close", (code) => {
        void close(code === 0);
      });
      child.on("error", () => {
        void close(false);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
