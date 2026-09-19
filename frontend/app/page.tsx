"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUpRight, CircleDot, Play, RefreshCw, Terminal } from "lucide-react";
import type { DashboardState, StreamLine } from "@/lib/types";
import { PublicView } from "@/components/views/PublicView";
import { InstitutionalView } from "@/components/views/InstitutionalView";

type Tab = "public" | "institutional";

const DEFAULT_STATE: DashboardState = {
  updatedAt: "",
  participants: [
    { name: "participant1", jsonApi: "http://127.0.0.1:6864", reachable: false, ledgerEnd: null },
    { name: "participant2", jsonApi: "http://127.0.0.1:18003", reachable: false, ledgerEnd: null },
  ],
  parties: { buyer: null, dealerA: null, dealerB: null },
  public: { events: [], counts: { rfqs: 0, proposals: 0, sealed: 0, deals: 0, receipts: 0, assets: 0 } },
  institutional: { buyerParty: null, assets: [], rfqs: [], proposals: [], sealedQuotes: [], deals: [], receipts: [] },
  privacy: { checked: false, winnerDealer: null, losingDealer: null, losingSeesWinnerQuotes: null },
};

export default function Page() {
  const [tab, setTab] = useState<Tab>("public");
  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/state", { cache: "no-store" });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      const j = (await resp.json()) as DashboardState;
      setState(j);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const runRound = async () => {
    if (running) return;
    abortRef.current?.abort();
    const ab = new AbortController();
    abortRef.current = ab;
    setRunning(true);
    setLines([]);
    setConsoleOpen(true);
    try {
      const resp = await fetch("/api/replay", { method: "POST", signal: ab.signal });
      if (!resp.ok) {
        const j = await resp.json().catch(() => null);
        setLines([`ROUND REJECTED: ${j?.reason ?? resp.status}`]);
        return;
      }
      const reader = resp.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const raw of chunk.split("\n")) {
          if (!raw.trim()) continue;
          let parsed: StreamLine;
          try {
            parsed = JSON.parse(raw);
          } catch {
            setLines((prev) => [...prev, raw]);
            continue;
          }
          if (parsed.snapshot) setState(parsed.snapshot);
          if (parsed.snapshotError) setLines((prev) => [...prev, `SNAPSHOT ERROR: ${parsed.snapshotError}`]);
          if (parsed.line) setLines((prev) => [...prev, parsed.line!]);
          if (parsed.done) setRunning(false);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setLines((prev) => [...prev, `STREAM ERROR: ${(err as Error).message}`]);
    } finally {
      setRunning(false);
      void refresh();
    }
  };

  const allReachable = state.participants.every((p) => p.reachable);

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#09090b] px-5 py-5 text-foreground md:px-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: "radial-gradient(circle at 2px 2px, rgba(255,255,255,0.15) 1px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1400px]">
        <header className="fixed left-1/2 top-5 z-50 flex w-[min(1120px,calc(100vw-2rem))] -translate-x-1/2 items-center justify-between rounded-full border border-border bg-card/70 px-4 py-3 shadow-xl shadow-black/10 backdrop-blur-xl md:px-5">
          <div className="flex items-center gap-3 font-mono text-sm tracking-[0.16em]">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-[0_0_15px_rgba(200,245,106,0.3)]">
              <CircleDot className="size-4" />
            </span>
            <span className="hidden text-foreground sm:block">SHADOWDESK</span>
            <span className="hidden font-mono text-[9px] tracking-[0.2em] text-muted-foreground lg:block">PRIVATE INSTITUTIONAL RFQ / DVP</span>
          </div>

          <nav className="hidden items-center gap-1 text-sm text-muted-foreground md:flex">
            <TabButton active={tab === "public"} onClick={() => setTab("public")}>
              Public projection
            </TabButton>
            <TabButton active={tab === "institutional"} onClick={() => setTab("institutional")}>
              Institutional
            </TabButton>
          </nav>

          <div className="flex items-center gap-2">
            <StatusDot ok={allReachable} running={running} />
            <button
              onClick={runRound}
              disabled={running || !allReachable}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_20px_rgba(200,245,106,0.2)] transition-all hover:-translate-y-0.5 hover:scale-105 disabled:translate-y-0 disabled:scale-100 disabled:opacity-40"
            >
              {running ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {running ? "Running" : "Run round"}
            </button>
          </div>
        </header>

        <div className="pt-28 md:pt-32">
          <motion.div
            initial={{ y: -12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
          >
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-primary">
                {running ? "round in flight" : allReachable ? "fabric live" : "awaiting fabric"}
              </p>
              <h1 className="mt-2 text-3xl font-semibold leading-[1] tracking-[-0.045em] md:text-5xl">
                A fund places a block. <span className="text-primary">Two dealers price it blind.</span>
              </h1>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
              <span className={`size-1.5 rounded-full ${allReachable ? "bg-primary animate-pulse" : "bg-zinc-500"}`} />
              synced at {state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString("en-US", { hour12: false }) : "-"}
            </div>
          </motion.div>

          {error && (
            <div className="mb-6 rounded-xl border border-red-400/30 bg-red-400/5 px-4 py-3 font-mono text-[11px] text-red-300">
              state error: {error}
            </div>
          )}

          <div className="md:hidden mb-5 grid grid-cols-2 gap-2">
            <TabButton active={tab === "public"} onClick={() => setTab("public")} mobile>
              Public
            </TabButton>
            <TabButton active={tab === "institutional"} onClick={() => setTab("institutional")} mobile>
              Institutional
            </TabButton>
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={tab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {loading ? <LoadingSkeleton /> : tab === "public" ? <PublicView state={state} /> : <InstitutionalView state={state} />}
            </motion.div>
          </AnimatePresence>

          <footer className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 pb-2 font-mono text-[9px] tracking-[0.14em] text-zinc-600 sm:flex-row">
            <span>SHADOWDESK · CANTON NETWORK 3.5.17 · TWO PARTICIPANTS · ONE SYNCHRONIZER</span>
            <span>PUBLIC VIEW = METADATA ONLY · BUYER VIEW = AUTHORIZED PROJECTION</span>
          </footer>
        </div>
      </div>

      <ConsoleDock
        open={consoleOpen}
        onToggle={() => setConsoleOpen((v) => !v)}
        running={running}
        lines={lines}
      />
    </main>
  );
}

function TabButton({ active, onClick, children, mobile }: { active: boolean; onClick: () => void; children: React.ReactNode; mobile?: boolean }) {
  const base = mobile
    ? "rounded-full px-4 py-2 text-sm"
    : "rounded-full px-4 py-2 transition-colors hover:text-foreground";
  return (
    <button
      onClick={onClick}
      className={`${base} ${active ? "bg-foreground text-background" : "text-muted-foreground"}`}
    >
      {children}
    </button>
  );
}

function StatusDot({ ok, running }: { ok: boolean; running: boolean }) {
  return (
    <span className="hidden items-center gap-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground lg:flex">
      <span className={`size-1.5 rounded-full ${running ? "bg-amber-400 animate-pulse" : ok ? "bg-primary animate-pulse" : "bg-red-400"}`} />
      {running ? "executing" : ok ? "live" : "offline"}
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <div className="h-[320px] animate-pulse rounded-2xl border border-border bg-card/40 lg:col-span-4" />
      <div className="h-[320px] animate-pulse rounded-2xl border border-border bg-card/40 lg:col-span-4" />
      <div className="h-[320px] animate-pulse rounded-2xl border border-border bg-card/40 lg:col-span-4" />
    </div>
  );
}

function ConsoleDock({ open, onToggle, running, lines }: { open: boolean; onToggle: () => void; running: boolean; lines: string[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: 110, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 110, opacity: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-4 left-1/2 z-40 w-[min(900px,calc(100vw-2rem))] -translate-x-1/2"
        >
          <div className="overflow-hidden rounded-2xl border border-border bg-[#09090b]/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="flex items-center gap-2 border-b border-border/50 bg-[#121214] px-4 py-3">
              <span className="size-2.5 rounded-full bg-red-500/80" />
              <span className="size-2.5 rounded-full bg-yellow-500/80" />
              <span className="size-2.5 rounded-full bg-green-500/80" />
              <Terminal className="ml-2 size-3.5 text-primary" />
              <span className="font-mono text-[10px] text-muted-foreground">agent_console · two participants</span>
              <button onClick={onToggle} className="ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground hover:text-foreground">
                {running ? "minimize" : "close"}
              </button>
            </div>
            <div ref={scrollRef} className="h-[260px] overflow-y-auto p-5 font-mono text-[12px] leading-relaxed">
              {lines.map((l, i) => (
                <ConsoleLine key={i} text={l} />
              ))}
              {running && (
                <p className="mt-1 flex items-center gap-2 text-zinc-400">
                  <ArrowUpRight className="size-3 animate-pulse text-primary" />
                  executing on the live ledger…
                </p>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ConsoleLine({ text }: { text: string }) {
  const lower = text.toLowerCase();
  let cls = "text-zinc-400";
  if (lower.startsWith("=== ")) cls = "text-primary font-semibold";
  else if (lower.includes("proposal") || lower.includes("quote") || lower.startsWith("  proposal")) cls = "text-purple-400";
  else if (lower.startsWith("[dealer ") || lower.includes("sees 0")) cls = "text-purple-300";
  else if (lower.includes("winner") || lower.includes("sealed") || lower.startsWith("[venue]")) cls = "text-amber-300";
  else if (lower.includes("settled") || lower.includes("holds") || lower.includes("complete") || lower.includes("but")) cls = "text-emerald-300";
  else if (lower.includes("error") || lower.includes("failed") || lower.includes("violation") || lower.includes("rejected")) cls = "text-red-400";

  if (lower.startsWith("[") || lower.startsWith("  ")) {
    return (
      <p className={`whitespace-pre-wrap break-words ${cls}`}>
        <span className="font-mono text-[10px] text-zinc-600">{"> "}</span>
        {text}
      </p>
    );
  }
  return <p className={`whitespace-pre-wrap break-words ${cls}`}>{text}</p>;
}