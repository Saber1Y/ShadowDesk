import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { getCantonAuth } from "@/lib/canton-auth";
import { loadDashboardState } from "@/lib/state";
import type { RealSettlementRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let running = false;
const ASSET_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** Registry instruments the DevNet profile knows how to settle. */
const REGISTRY_INSTRUMENTS = new Set(["CBTC", "BETH"]);

const DEVNET_PARTY_VARIABLES = [
  "SHADOWDESK_BUYER_PARTY",
  "SHADOWDESK_RISK_OFFICER_PARTY",
  "SHADOWDESK_DEALER_A_PARTY",
  "SHADOWDESK_DEALER_B_PARTY",
];

const RESULT_PATH = "/tmp/shadowdesk-real-settlements.json";

/** What the last real-token run recorded, if it ran in this process's lifetime. */
const readSettlementRecords = (): RealSettlementRecord[] => {
  try {
    const raw = readFileSync(RESULT_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RealSettlementRecord[]) : [];
  } catch {
    return [];
  }
};

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
  // Only meaningful for the DevNet real-token flow; ignored by the localnet demo,
  // which settles ShadowDesk's own synthetic symbols.
  const realDelivered = String(body.realDelivered ?? "").toUpperCase();
  const realPayment = String(body.realPayment ?? "").toUpperCase();
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
  // A stale record from an earlier round would otherwise be presented as this
  // run's settlement evidence.
  try {
    rmSync(RESULT_PATH, { force: true });
  } catch {
    /* nothing to clear */
  }
  const agentRoot = process.env.AGENTS_ROOT ?? "/Users/mac/codes/Shadow Desk/agents";

  // On DevNet the real-token flow is the one that matters: it settles in registry
  // instruments and writes the receipt in the same update. It reads its own
  // instrument pair and quantity from the environment rather than the synthetic
  // symbols the localnet demo takes, so the two are dispatched separately.
  const realFlow = body.real === true || process.env.SHADOWDESK_NETWORK === "devnet";
  const spawnPlan: { command: string; args: string[]; cwd: string } = realFlow
    ? { command: "npm", args: ["run", "e2e:real-flow"], cwd: agentRoot }
    : { command: "npm", args: ["run", "demo"], cwd: agentRoot };

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "production",
    ...(cantonAccessToken ? { SHADOWDESK_CANTON_ACCESS_TOKEN: cantonAccessToken } : {}),
  };

  if (realFlow) {
    childEnv.SHADOWDESK_E2E_QUANTITY = String(amount);
    childEnv.SHADOWDESK_E2E_UNIT_PRICE = String(maxPrice);
    // The registry legs take their instruments from this pair. It comes from the
    // request when the operator chose one, so the pair is a decision rather than a
    // deployment default, and falls back to the intended product direction:
    // delivering CBTC against BETH.
    const delivered = REGISTRY_INSTRUMENTS.has(realDelivered) ? realDelivered : "CBTC";
    const paid = REGISTRY_INSTRUMENTS.has(realPayment) ? realPayment : "BETH";
    if (delivered === paid) {
      return Response.json(
        { ok: false, reason: "The delivered and settlement instruments must be different." },
        { status: 400 },
      );
    }
    childEnv.SHADOWDESK_REAL_DELIVERED_INSTRUMENT = delivered;
    childEnv.SHADOWDESK_REAL_PAYMENT_INSTRUMENT = paid;
    childEnv.SHADOWDESK_E2E_INSTRUMENTS = `${delivered},${paid}`;
    childEnv.SHADOWDESK_E2E_RESULT_PATH = RESULT_PATH;
  } else {
    childEnv.SHADOWDESK_AMOUNT = String(amount);
    childEnv.SHADOWDESK_MAX_PRICE = String(maxPrice);
    childEnv.SHADOWDESK_ASSET_TO_BUY = assetToBuy;
    childEnv.SHADOWDESK_SETTLEMENT_ASSET = settlementAsset;
  }

  const child = spawn(spawnPlan.command, spawnPlan.args, { cwd: spawnPlan.cwd, env: childEnv });

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
          // The registry legs are consumed by their own execution, so the state
          // projection cannot see them. The run records what the settle actually
          // returned, which is the real allocation ids and the update id they
          // committed with.
          const settlements = readSettlementRecords();
          emit({ snapshot: { ...state, realSettlements: settlements } });
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
