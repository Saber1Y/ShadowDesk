"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUpRight, Play, RefreshCw, ShieldCheck, Terminal, TriangleAlert } from "lucide-react";
import type { AuthStatus, DashboardState, MandateView, StreamLine } from "@/lib/types";
import { PublicView } from "@/components/views/PublicView";
import { InstitutionalView } from "@/components/views/InstitutionalView";
import { ShadowDeskMark } from "@/components/shadowdesk-mark";
import { FailureNotice } from "@/components/failure-notice";
import { describeFailure, type FriendlyFailure } from "@/lib/messages";
import { WalletAuth, WalletAuthGate } from "@/components/wallet-auth";

type Tab = "public" | "institutional";

const DEFAULT_STATE: DashboardState = {
  updatedAt: "",
  participants: [
    { name: "participant1", jsonApi: "http://127.0.0.1:6864", reachable: false, ledgerEnd: null },
    { name: "participant2", jsonApi: "http://127.0.0.1:18003", reachable: false, ledgerEnd: null },
  ],
  parties: { buyer: null, dealerA: null, dealerB: null },
  public: { events: [], counts: { rfqs: 0, proposals: 0, sealed: 0, deals: 0, receipts: 0, assets: 0 } },
  institutional: {
    buyerParty: null, assets: [], rfqs: [], proposals: [], sealedQuotes: [], deals: [], receipts: [], mandates: [],
    realHoldings: [], realLegs: [],
  },
  privacy: { checked: false, winnerDealer: null, losingDealer: null, losingSeesWinnerQuotes: null },
};

export default function Page() {
  const [tab, setTab] = useState<Tab>("public");
  const [state, setState] = useState<DashboardState>(DEFAULT_STATE);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<FriendlyFailure | null>(null);
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [amount, setAmount] = useState("1000000");
  const [maxPrice, setMaxPrice] = useState("101");
  const [assetToBuy, setAssetToBuy] = useState("cTBILL");
  const [settlementAsset, setSettlementAsset] = useState("cUSDC");
  // The registry pair actually settled on DevNet, chosen in the UI rather than
  // taken from a deployment default.
  const [realDelivered, setRealDelivered] = useState("CBTC");
  const [realPayment, setRealPayment] = useState("BETH");
  const abortRef = useRef<AbortController | null>(null);

  const refreshAuth = useCallback(async () => {
    try {
      const resp = await fetch("/api/auth/session", { cache: "no-store" });
      if (!resp.ok) throw new Error(`status ${resp.status}`);
      setAuth((await resp.json()) as AuthStatus);
    } catch {
      setAuth((previous) => previous ?? {
        mode: "devnet",
        authenticated: false,
        user: null,
        reason: "configuration",
      });
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const resp = await fetch("/api/state", { cache: "no-store" });
      const body = resp.ok ? null : await resp.json().catch(() => null) as { error?: string; authRequired?: boolean } | null;
      if (resp.status === 401 && body?.authRequired) {
        setAuth((previous) => previous?.mode === "devnet"
          ? { ...previous, authenticated: false, user: null, reason: "expired" }
          : { mode: "devnet", authenticated: false, user: null, reason: "expired" });
        setState(DEFAULT_STATE);
        setFailure(null);
        return;
      }
      if (!resp.ok) {
        throw new Error(body?.error ?? `status ${resp.status}`);
      }
      const j = (await resp.json()) as DashboardState;
      setState(j);
      setFailure((previous) => previous?.title === "The trading venue is offline" ? null : previous);
    } catch (err) {
      const detail = (err as Error).message;
      setFailure(describeFailure(detail));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAuth();
    const errorCode = new URLSearchParams(window.location.search).get("authError") ?? undefined;
    if (errorCode) setAuthError(errorCode);
  }, [refreshAuth]);

  useEffect(() => {
    if (!auth) return;
    if (auth.mode === "devnet" && !auth.authenticated) {
      setLoading(false);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => window.clearInterval(timer);
  }, [auth?.mode, auth?.authenticated, refresh]);

  const runRound = async () => {
    if (running) return;
    if (auth?.mode === "devnet" && !auth.authenticated) {
      setFailure(describeFailure("Connect the Canton wallet before running a round.", "round"));
      return;
    }
    const parsedAmount = Number(amount);
    const parsedMaxPrice = Number(maxPrice);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0 || !Number.isFinite(parsedMaxPrice) || parsedMaxPrice <= 0) {
      const nextFailure = describeFailure("Enter positive values for amount and maximum price.", "round");
      setFailure(nextFailure);
      setLines(["ROUND REJECTED: invalid trade details"]);
      return;
    }
    if (auth?.mode === "devnet" && realDelivered === realPayment) {
      const nextFailure = describeFailure("The delivered and settlement instruments must be different.", "round");
      setFailure(nextFailure);
      setLines(["ROUND REJECTED: delivered and settlement instruments must differ"]);
      return;
    }
    if (assetToBuy === settlementAsset) {
      const nextFailure = describeFailure("The security and settlement instrument must be different.", "round");
      setFailure(nextFailure);
      setLines(["ROUND REJECTED: security and settlement instruments must differ"]);
      return;
    }
    abortRef.current?.abort();
    const ab = new AbortController();
    abortRef.current = ab;
    setRunning(true);
    setLines([]);
    setConsoleOpen(true);
    try {
      const resp = await fetch("/api/replay", {
        method: "POST",
        signal: ab.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: parsedAmount,
          maxPrice: parsedMaxPrice,
          assetToBuy,
          settlementAsset,
          realDelivered,
          realPayment,
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => null) as { reason?: string } | null;
        const reason = j?.reason ?? `status ${resp.status}`;
        setFailure(describeFailure(reason, "round"));
        setLines([`ROUND REJECTED: ${reason}`]);
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
          if (parsed.snapshot) {
            setState(parsed.snapshot);
            setFailure(null);
          }
          if (parsed.snapshotError) {
            setFailure(describeFailure(parsed.snapshotError, "stream"));
            setLines((prev) => [...prev, `SNAPSHOT ERROR: ${parsed.snapshotError}`]);
          }
          if (parsed.line) {
            const line = parsed.line;
            setLines((prev) => [...prev, line]);
            const lower = line.toLowerCase();
            if (lower.includes("failed") || lower.includes("rejected") || lower.includes("violation")) {
              setFailure(describeFailure(line, "round"));
            }
          }
          if (parsed.done) setRunning(false);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setFailure(describeFailure((err as Error).message, "stream"));
        setLines((prev) => [...prev, `STREAM ERROR: ${(err as Error).message}`]);
      }
    } finally {
      setRunning(false);
      void refresh();
    }
  };

  const allReachable = state.participants.every((p) => p.reachable);
  const needsAuth = auth?.mode === "devnet" && !auth.authenticated;
  const participantCount = new Set(state.participants.map((participant) => participant.jsonApi)).size;

  // The envelope is the product: compare the entered trade against the mandate
  // the ledger actually enforces. This only warns. Rejection stays on-ledger so
  // the runtime assertion is what stops an out-of-policy trade.
  const mandates = state.institutional.mandates;
  const activeMandate = useMemo(() => {
    return (mandates ?? []).filter((m) => m.status === "ACTIVE").at(-1) ?? null;
  }, [mandates]);

  const envelope = useMemo(() => {
    if (!activeMandate) return null;
    const amountNumber = Number(amount);
    const priceNumber = Number(maxPrice);
    const breaches: string[] = [];
    if (Number.isFinite(amountNumber) && amountNumber > Number(activeMandate.maxAmount)) breaches.push("amount");
    if (Number.isFinite(priceNumber) && priceNumber > Number(activeMandate.maxPrice)) breaches.push("price ceiling");
    if (assetToBuy !== activeMandate.assetToBuy) breaches.push("instrument");
    if (settlementAsset !== activeMandate.settlementAsset) breaches.push("settlement asset");
    return { mandate: activeMandate, breaches, within: breaches.length === 0 };
  }, [activeMandate, amount, maxPrice, assetToBuy, settlementAsset]);

  // Seed the request from the approved envelope the first time one appears, so
  // the operator starts inside policy instead of on top of an arbitrary default.
  // Seeding happens once: later mandate changes never overwrite typed input.
  const seededFromMandate = useRef(false);
  useEffect(() => {
    if (!activeMandate || seededFromMandate.current) return;
    seededFromMandate.current = true;
    setAssetToBuy(activeMandate.assetToBuy);
    setSettlementAsset(activeMandate.settlementAsset);
    setAmount(String(Number(activeMandate.maxAmount)));
    setMaxPrice(Number(activeMandate.maxPrice).toFixed(2));
  }, [activeMandate]);

  const retryFailure = () => {
    if (failure?.title === "The trade request was not completed" || failure?.title === "The trade did not settle" || failure?.title === "Check the trade details") {
      void runRound();
      return;
    }
    void refresh();
  };

  return (
    <main className="relative min-h-[100dvh] overflow-hidden bg-[#030206] px-5 py-5 text-foreground md:px-10">
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
            <span className="flex size-7 items-center justify-center rounded-md border border-border bg-card/80 p-1 shadow-[0_0_15px_rgba(243,255,151,0.15)]">
              <ShadowDeskMark className="size-6" />
            </span>
            <span className="hidden text-foreground sm:block">SHADOWDESK</span>
            <span className="hidden font-mono text-[9px] tracking-[0.2em] text-muted-foreground lg:block">MANDATE-BOUND TREASURY EXECUTION</span>
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
            {auth && <WalletAuth status={auth} />}
            <StatusDot ok={allReachable} running={running} />
            <button
              onClick={runRound}
              disabled={running || !allReachable || needsAuth}
              className="flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-[0_0_20px_rgba(243,255,151,0.2)] transition-[transform,background-color,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#f7ffb5] active:scale-[0.98] disabled:translate-y-0 disabled:scale-100 disabled:opacity-40"
            >
              {running ? <RefreshCw className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {running ? "Running" : "Run round"}
            </button>
          </div>
        </header>

        <div className="pt-28 md:pt-32">
          {auth === null ? (
            <AuthLoading />
          ) : auth.mode === "devnet" && !auth.authenticated ? (
            <WalletAuthGate status={auth} error={authError ?? auth.reason} />
          ) : (
            <>
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
                    The agent <span className="text-primary">cannot settle outside its mandate.</span>
                  </h1>
                </div>
                <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                  <span className={`size-1.5 rounded-full ${allReachable ? "bg-primary animate-pulse" : "bg-zinc-500"}`} />
                  synced at {state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString("en-US", { hour12: false }) : "-"}
                </div>
              </motion.div>

              {failure && <FailureNotice failure={failure} onRetry={retryFailure} />}

              <section className="mb-6 rounded-2xl border border-border bg-card/55 p-4 shadow-xl shadow-black/10 backdrop-blur-xl md:p-5">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Trade request</p>
                    <p className="mt-1 text-[13px] text-muted-foreground">Choose synthetic asset symbols and trade terms. Symbols do not select registry tokens.</p>
                  </div>
                  <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">Synthetic ShadowDesk.Asset · not CIP-56</span>
                </div>
                {auth?.mode === "devnet" && (
                  <div className="mb-4 rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-3">
                    <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
                        Registry settlement
                      </p>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
                        Token Standard CIP-56 · settled on-ledger
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <InstrumentField
                        label="Delivered"
                        value={realDelivered}
                        onChange={setRealDelivered}
                        exclude={realPayment}
                      />
                      <InstrumentField
                        label="Paid"
                        value={realPayment}
                        onChange={setRealPayment}
                        exclude={realDelivered}
                      />
                      <NumberField label="Amount" value={amount} onChange={setAmount} />
                      <NumberField label="Maximum price" value={maxPrice} onChange={setMaxPrice} step="0.01" />
                    </div>
                  </div>
                )}
                {auth?.mode !== "devnet" && (
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <AssetField label="Security" value={assetToBuy} onChange={setAssetToBuy} listId="security-assets" />
                    <AssetField label="Settlement" value={settlementAsset} onChange={setSettlementAsset} listId="settlement-assets" />
                    <NumberField label="Amount" value={amount} onChange={setAmount} />
                    <NumberField label="Maximum price" value={maxPrice} onChange={setMaxPrice} step="0.01" />
                  </div>
                )}
                <EnvelopeReadout
                  envelope={envelope}
                  onMatch={() => {
                    if (!activeMandate) return;
                    setAssetToBuy(activeMandate.assetToBuy);
                    setSettlementAsset(activeMandate.settlementAsset);
                    setAmount(String(Number(activeMandate.maxAmount)));
                    setMaxPrice(Number(activeMandate.maxPrice).toFixed(2));
                  }}
                />
              </section>

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
                  {loading ? <LoadingSkeleton /> : tab === "public" ? <PublicView state={state} /> : (
                    <InstitutionalView
                      state={state}
                      trade={{
                        amount,
                        maxPrice,
                        delivered: realDelivered,
                        payment: realPayment,
                        registry: auth?.mode === "devnet",
                      }}
                    />
                  )}
                </motion.div>
              </AnimatePresence>

              <footer className="mt-14 flex flex-col items-center justify-between gap-3 border-t border-border pt-6 pb-2 font-mono text-[9px] tracking-[0.14em] text-zinc-600 sm:flex-row">
                <span>SHADOWDESK · CANTON NETWORK 3.5.17 · {participantCount} PARTICIPANT{participantCount === 1 ? "" : "S"} · ONE SYNCHRONIZER</span>
                <span>PUBLIC VIEW = METADATA ONLY · BUYER VIEW = AUTHORIZED PROJECTION</span>
              </footer>
            </>
          )}
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

function EnvelopeReadout({ envelope, onMatch }: { envelope: { mandate: MandateView; breaches: string[]; within: boolean } | null; onMatch?: () => void }) {
  if (!envelope) {
    return (
      <p className="mt-4 border-t border-border pt-4 font-mono text-[10px] leading-relaxed text-zinc-600">
        No approved mandate on the ledger. Running a round will create one, then open the RFQ under it.
      </p>
    );
  }
  const { mandate, breaches, within } = envelope;
  return (
    <div
      className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 ${
        within ? "border-border" : "border-destructive/30"
      }`}
    >
      <p className={`flex items-center gap-2 font-mono text-[10px] ${within ? "text-primary" : "text-destructive"}`}>
        {within ? <ShieldCheck className="size-3 shrink-0" /> : <TriangleAlert className="size-3 shrink-0" />}
        <span className="uppercase tracking-[0.14em]">{within ? "inside envelope" : `outside envelope: ${breaches.join(", ")}`}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">{mandate.reference}</span>
      </p>
      <p className="font-mono text-[10px] text-muted-foreground">
        ceiling {Number(mandate.maxPrice).toFixed(2)} · max {Number(mandate.maxAmount).toLocaleString("en-US", { maximumFractionDigits: 2 })}
        {!within && (
          <button
            type="button"
            onClick={() => onMatch?.()}
            className="ml-3 uppercase tracking-[0.14em] text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
          >
            match mandate
          </button>
        )}
      </p>
    </div>
  );
}

function AssetField({
  label,
  value,
  onChange,
  listId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  listId: string;
}) {
  return (
    <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {label}
      <input
        list={listId}
        type="text"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,31}"
        maxLength={32}
        placeholder="e.g. cTBILL"
        className="mt-2 block w-full rounded-xl border border-border bg-[#030206]/70 px-3 py-2.5 font-mono text-[12px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary/60"
      />
      <datalist id={listId}>
        <option value="cTBILL" />
        <option value="cUSDC" />
      </datalist>
    </label>
  );
}

/** A registry instrument picker. The choice is closed because the profile's instruments are fixed. */
function InstrumentField({
  label,
  value,
  onChange,
  exclude,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  exclude?: string;
}) {
  const options = ["CBTC", "BETH"].filter((o) => o !== exclude);
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-[#030206]/60 px-3 py-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-primary/60"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberField({ label, value, onChange, step = "1" }: { label: string; value: string; onChange: (value: string) => void; step?: string }) {
  return (
    <label className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {label}
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 block w-full rounded-xl border border-border bg-[#030206]/70 px-3 py-2.5 font-mono text-[12px] normal-case tracking-normal text-foreground outline-none transition-colors focus:border-primary/60"
      />
    </label>
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

function AuthLoading() {
  return (
    <div className="rounded-2xl border border-border bg-card/45 p-8 shadow-xl shadow-black/10 backdrop-blur-xl">
      <div className="h-3 w-32 animate-pulse rounded-full bg-primary/20" />
      <div className="mt-5 h-10 w-3/4 animate-pulse rounded-xl bg-card" />
      <div className="mt-4 h-4 w-full max-w-xl animate-pulse rounded-full bg-card" />
      <div className="mt-2 h-4 w-2/3 animate-pulse rounded-full bg-card" />
    </div>
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
          <div className="overflow-hidden rounded-2xl border border-border bg-[#030206]/95 shadow-2xl shadow-black/30 backdrop-blur-xl">
            <div className="flex items-center gap-2 border-b border-border/50 bg-[#0d0e12] px-4 py-3">
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
  let cls = "text-taupe";
  if (lower.startsWith("=== ")) cls = "text-primary font-semibold";
  else if (lower.includes("proposal") || lower.includes("quote") || lower.startsWith("  proposal")) cls = "text-purple";
  else if (lower.startsWith("[dealer ") || lower.includes("sees 0")) cls = "text-purple";
  else if (lower.includes("winner") || lower.includes("sealed") || lower.startsWith("[venue]")) cls = "text-lilac";
  else if (lower.includes("settled") || lower.includes("holds") || lower.includes("complete") || lower.includes("but")) cls = "text-primary";
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
