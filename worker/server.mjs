import http from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";

const port = Number(process.env.PORT || 8787);
const secret = process.env.SHADOWDESK_WORKER_SECRET;
const agentsRoot = process.env.AGENTS_ROOT || "/opt/shadowdesk/agents";
const statePath = process.env.WORKER_STATE_PATH || "/var/lib/shadowdesk-worker/runs.json";
const maxAmount = Number(process.env.MAX_RUN_AMOUNT || 1_000_000_000_000);
const maxPrice = Number(process.env.MAX_RUN_PRICE || 1_000_000);
const instruments = new Set(["CBTC", "BETH"]);
const runs = new Map();
let activeRun = null;

const json = (status, body) => ({
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  body: JSON.stringify(body),
});

const authorized = (request) => secret && request.headers.authorization === `Bearer ${secret}`;

const persist = async () => {
  await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
  const data = [...runs.values()].map(({ id, status, createdAt, finishedAt, exitCode, lines, result }) => ({
    id, status, createdAt, finishedAt, exitCode, lines: lines.slice(-500), result,
  }));
  await writeFile(statePath, JSON.stringify(data), { mode: 0o600 });
};

const restore = async () => {
  try {
    const data = JSON.parse(await readFile(statePath, "utf8"));
    for (const run of Array.isArray(data) ? data : []) runs.set(run.id, run);
  } catch {
    return;
  }
};

const runProcess = (args, environment, append) => new Promise((resolve) => {
  const child = spawn("npm", args, { cwd: agentsRoot, env: environment });
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  child.on("error", (error) => append(`worker child error: ${error.message}`));
  child.on("close", (code) => resolve(code ?? 1));
});

const executeRun = async (run, input) => {
  const resultPath = join(dirname(statePath), `result-${run.id}.json`);
  const environment = {
    ...process.env,
    SHADOWDESK_CANTON_ACCESS_TOKEN: String(input.cantonAccessToken || ""),
    SHADOWDESK_E2E_QUANTITY: String(input.amount),
    SHADOWDESK_E2E_UNIT_PRICE: String(input.maxPrice),
    SHADOWDESK_REAL_DELIVERED_INSTRUMENT: String(input.realDelivered).toUpperCase(),
    SHADOWDESK_REAL_PAYMENT_INSTRUMENT: String(input.realPayment).toUpperCase(),
    SHADOWDESK_E2E_RESULT_PATH: resultPath,
  };
  const append = (chunk) => {
    for (const line of String(chunk).split("\n")) {
      if (line.trim()) run.lines.push(line.slice(0, 2000));
    }
    run.lines = run.lines.slice(-500);
    void persist();
  };
  try {
    await runProcess(["run", "faucet:fund"], environment, append);
    const code = await runProcess(["run", "e2e:real-flow"], environment, append);
    run.exitCode = code;
    run.status = code === 0 ? "completed" : "failed";
    try {
      run.result = JSON.parse(await readFile(resultPath, "utf8"));
    } catch {
      run.result = undefined;
    }
  } catch (error) {
    append(`worker execution error: ${error instanceof Error ? error.message : String(error)}`);
    run.exitCode = 1;
    run.status = "failed";
  } finally {
    run.finishedAt = new Date().toISOString();
    activeRun = null;
    void persist();
  }
};

const parseBody = async (request) => {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 32_000) throw new Error("request too large");
  }
  return raw ? JSON.parse(raw) : {};
};

const startRun = (input) => {
  const amount = Number(input.amount);
  const price = Number(input.maxPrice);
  const delivered = String(input.realDelivered || "CBTC").toUpperCase();
  const payment = String(input.realPayment || "BETH").toUpperCase();
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > maxAmount) throw new Error("invalid amount");
  if (!Number.isFinite(price) || price <= 0 || price > maxPrice) throw new Error("invalid maxPrice");
  if (!instruments.has(delivered) || !instruments.has(payment) || delivered === payment) throw new Error("invalid instrument pair");
  if (activeRun) return { conflict: true };

  const id = randomUUID();
  const run = { id, status: "running", createdAt: new Date().toISOString(), lines: [] };
  runs.set(id, run);
  activeRun = id;

  void executeRun(run, { ...input, amount, maxPrice: price, realDelivered: delivered, realPayment: payment });
  void persist();
  return { run };
};

const handle = async (request) => {
  if (!authorized(request)) return json(401, { ok: false, error: "unauthorized" });
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === "GET" && url.pathname === "/health") return json(200, { ok: true, service: "shadowdesk-worker" });
  if (request.method === "POST" && url.pathname === "/v1/runs") {
    const input = await parseBody(request);
    const result = startRun(input);
    if (result.conflict) return json(409, { ok: false, error: "a run is already active" });
    return json(202, { ok: true, runId: result.run.id });
  }
  const match = url.pathname.match(/^\/v1\/runs\/([0-9a-f-]+)$/i);
  if (request.method === "GET" && match) {
    const run = runs.get(match[1]);
    return run ? json(200, { ok: true, run }) : json(404, { ok: false, error: "run not found" });
  }
  return json(404, { ok: false, error: "not found" });
};

await restore();
http.createServer(async (request, response) => {
  try {
    const result = await handle(request);
    response.writeHead(result.status, result.headers);
    response.end(result.body);
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "bad request" }));
  }
}).listen(port, "127.0.0.1", () => console.log(`ShadowDesk worker listening on 127.0.0.1:${port}`));
