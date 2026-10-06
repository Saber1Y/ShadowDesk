import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { getCantonAuth } from "@/lib/canton-auth";
import { loadDashboardState } from "@/lib/state";
import type { RealSettlementRecord } from "@/lib/types";

export const dynamic = "force-dynamic";
// A real DevNet round runs two competitive settlements and the participant ACS
// queries can take several minutes on a long-lived ledger. The previous 120s
// ceiling was shorter than a legitimate round and could terminate the request
// while its child was still working.
export const maxDuration = 900;

/**
 * Single-round guard, held with a deadline rather than a bare boolean.
 *
 * The flag was only cleared in the stream's `finally`, which never runs when the
 * client disconnects mid-round and takes the child process with it. One abandoned
 * request then blocked every later round with a 409 until the server restarted.
 * A deadline bounds how long a round can hold the lock, so an abandoned one
 * cannot wedge the endpoint permanently.
 */
let runningUntil = 0;
const ROUND_LOCK_MS = 15 * 60 * 1000;
const ROUND_COOLDOWN_MS = 15 * 1000;
let lastRoundStartedAt = 0;
const isRunning = (): boolean => Date.now() < runningUntil;
const acquireRound = (): boolean => {
  if (isRunning()) return false;
  runningUntil = Date.now() + ROUND_LOCK_MS;
  return true;
};
const releaseRound = (): void => {
  runningUntil = 0;
};

/** Reject browser requests originating from another site before any side effect. */
const isSameOrigin = (request: Request): boolean => {
  const origin = request.headers.get("origin");
  if (!origin) return true; // CLI and same-origin server requests do not need Origin.
  try {
    const requestUrl = new URL(request.url);
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
};
const ASSET_SYMBOL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/** Registry instruments the DevNet profile knows how to settle. */
const REGISTRY_INSTRUMENTS = new Set(["CBTC", "BETH"]);

const DEVNET_PARTY_VARIABLES = [
  "SHADOWDESK_BUYER_PARTY",
  "SHADOWDESK_RISK_OFFICER_PARTY",
  "SHADOWDESK_DEALER_A_PARTY",
  "SHADOWDESK_DEALER_B_PARTY",
];

/** What the last real-token run recorded, if it ran in this process's lifetime. */
const readSettlementRecords = (path: string): RealSettlementRecord[] => {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RealSettlementRecord[]) : [];
  } catch {
    return [];
  }
};

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return Response.json({ ok: false, reason: "Cross-origin round requests are not allowed." }, { status: 403 });
  }
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

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const amount = Number(body.amount ?? 1_000_000);
  const maxPrice = Number(body.maxPrice ?? 101);
  const assetToBuy = String(body.assetToBuy ?? "cTBILL");
  const settlementAsset = String(body.settlementAsset ?? "cUSDC");
  // Only meaningful for the DevNet real-token flow; ignored by the localnet demo,
  // which settles ShadowDesk's own synthetic symbols.
  const realDelivered = String(body.realDelivered ?? "").toUpperCase();
  const realPayment = String(body.realPayment ?? "").toUpperCase();
  const maxRunAmount = 1_000_000_000_000;
  const maxRunPrice = 1_000_000;
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > maxRunAmount || !Number.isFinite(maxPrice) || maxPrice <= 0 || maxPrice > maxRunPrice) {
    return Response.json({
      ok: false,
      reason: `Amount must be a safe integer from 1 to ${maxRunAmount}, and maximum price must be from 0 to ${maxRunPrice}.`,
    }, { status: 400 });
  }
  if (!ASSET_SYMBOL.test(assetToBuy) || !ASSET_SYMBOL.test(settlementAsset)) {
    return Response.json({ ok: false, reason: "Use asset symbols with 1-32 letters, numbers, dots, dashes, or underscores." }, { status: 400 });
  }
  if (assetToBuy === settlementAsset) {
    return Response.json({ ok: false, reason: "The security and settlement instrument must be different." }, { status: 400 });
  }

  if (!acquireRound()) {
    return new Response(JSON.stringify({ ok: false, reason: "A round is already running." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (Date.now() - lastRoundStartedAt < ROUND_COOLDOWN_MS) {
    releaseRound();
    return new Response(JSON.stringify({ ok: false, reason: "Wait a few seconds before starting another round." }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "15" },
    });
  }
  lastRoundStartedAt = Date.now();

  // A stale record from an earlier round would otherwise be presented as this
  // run's settlement evidence.
  const agentRoot = process.env.AGENTS_ROOT ?? "/Users/mac/codes/Shadow Desk/agents";
  const resultPath = `/tmp/shadowdesk-real-settlements-${randomUUID()}.json`;

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
    childEnv.SHADOWDESK_E2E_RESULT_PATH = resultPath;
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

      // A settled trade consumes the delivering balance, so a second round from
      // the same button has nothing to trade. The faucet is a DevNet test faucet
      // and this is the demo driver rather than a check, so it tops the parties
      // up first. Its output is streamed rather than swallowed, because minting is
      // a visible side effect and should not happen behind the operator's back.
      if (realFlow) {
        await new Promise<void>((resolve) => {
          const fund = spawn("npm", ["run", "faucet:fund"], { cwd: agentRoot, env: childEnv });
          const relay = (chunk: Buffer) => {
            for (const line of chunk.toString().split("\n")) {
              if (line.trim()) emit({ line: `[faucet] ${line}` });
            }
          };
          fund.stdout.on("data", relay);
          fund.stderr.on("data", relay);
          fund.on("close", () => resolve());
          fund.on("error", (e) => {
            emit({ line: `[faucet] could not run: ${e.message}` });
            resolve();
          });
        });
      }

      // If the browser goes away the round should stop rather than run on
      // unattended, holding the lock and consuming the DevNet session.
      const stop = () => {
        try {
          child.kill("SIGTERM");
        } catch {
          /* already gone */
        }
        releaseRound();
      };
      request.signal.addEventListener("abort", stop, { once: true });

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
          const settlements = readSettlementRecords(resultPath);
          emit({ snapshot: { ...state, realSettlements: settlements } });
          emit({ done: ok });
        } catch (err) {
          emit({ snapshotError: (err as Error).message, done: false });
        } finally {
          releaseRound();
          try { rmSync(resultPath, { force: true }); } catch { /* best effort */ }
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
