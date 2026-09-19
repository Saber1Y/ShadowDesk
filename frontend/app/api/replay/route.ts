import { spawn } from "node:child_process";
import { loadDashboardState } from "@/lib/state";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

let running = false;

export async function POST() {
  if (running) {
    return new Response(JSON.stringify({ ok: false, reason: "A round is already running." }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

  running = true;
  const agentRoot = process.env.AGENTS_ROOT ?? "/Users/mac/codes/Shadow Desk/agents";
  const child = spawn("npm", ["run", "demo"], {
    cwd: agentRoot,
    env: { ...process.env, NODE_ENV: "production" },
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