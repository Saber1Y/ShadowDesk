"use client";

import { AnimatePresence, motion } from "motion/react";
import { FileLock2, Network, Server, ShieldCheck, Terminal, CircleDot } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import type { DashboardState } from "@/lib/types";

const KIND_COLOR: Record<string, string> = {
  RFQ_CREATED: "text-blue-400",
  QUOTE_PROPOSAL: "text-purple-400",
  QUOTE_SEALED: "text-purple-400",
  DEAL_CREATED: "text-amber-400",
  DVP_SETTLED: "text-emerald-400",
  ASSET_MOVED: "text-zinc-400",
};

const PAYLOAD_LABEL: Record<string, string> = {
  METADATA_ONLY: "PUBLIC METADATA",
  ENC_QUOTE: "ENC QUOTE / SIGNATORIES ONLY",
  ENC_DVP: "ENC DVP / BUYER+DEALER",
};

export function PublicView({ state }: { state: DashboardState }) {
  const { public: pub, participants, privacy } = state;
  const eventCount = pub.events.length;
  const allReachable = participants.every((p) => p.reachable);

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
      <motion.div
        layout
        className="lg:col-span-5"
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel label="Participant fabric" icon={Network} className="h-full">
          <div className="space-y-3">
            {participants.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-xl border border-border bg-[#09090b]/40 px-4 py-3">
                <div className="flex items-center gap-3">
                  <Server className="size-4 text-muted-foreground" />
                  <div>
                    <p className="font-mono text-[12px] font-medium text-foreground">{p.name}</p>
                    <p className="font-mono text-[9px] text-muted-foreground">{p.jsonApi.replace("http://", "")}</p>
                  </div>
                </div>
                <div className="text-right">
                  <StatusPill tone={p.reachable ? (p.name === "participant1" ? "live" : "ok") : "failed"} label={p.reachable ? (p.name === "participant1" ? "LIVE" : "SYNCED") : "DOWN"} pulse={p.reachable} />
                  <p className="mt-1.5 font-mono text-[9px] text-muted-foreground">end={p.ledgerEnd ?? "-"}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Metric label="RFQs" value={pub.counts.rfqs} />
            <Metric label="Proposals" value={pub.counts.proposals} accent />
            <Metric label="Quotes sealed" value={pub.counts.sealed} accent />
            <Metric label="Trades settled" value={pub.counts.receipts} accent />
            <Metric label="Asset moves" value={pub.counts.assets} />
          </div>
        </HudPanel>
      </motion.div>

      <motion.div
        layout
        className="lg:col-span-7"
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <HudPanel
          label="Public metadata projection"
          icon={FileLock2}
          badge={<StatusPill tone={allReachable && eventCount > 0 ? "live" : "muted"} label={allReachable ? "SYNCED" : "WAITING"} pulse={allReachable} />}
          className="h-full"
        >
          <p className="mb-5 max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
            This panel is the venue's <span className="text-foreground">sanitized public projection</span>. It shows only
            application metadata: event type, reference, timestamp, and encrypted-payload indicators. Quote prices,
            block size, and payloads never appear here - they remain encrypted to their party signatories on the
            synchronizer.
          </p>

          <TerminalLog events={pub.events} />

          {privacy.checked && (
            <div className="mt-5 flex items-center gap-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3">
              <ShieldCheck className="size-4 shrink-0 text-primary" />
              <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                <span className="text-primary">CROSS-PARTICIPANT PRIVACY</span> - losing dealer{" "}
                <span className="text-foreground">{privacy.losingDealer}</span> observes{" "}
                <span className="text-foreground">{privacy.losingSeesWinnerQuotes ?? "-"}</span> of the winning
                dealer's quotes (expect 0).
              </p>
            </div>
          )}
        </HudPanel>
      </motion.div>
    </div>
  );
}

function TerminalLog({ events }: { events: DashboardState["public"]["events"] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-[#09090b] shadow-2xl">
      <div className="flex items-center gap-2 border-b border-border/50 bg-[#121214] px-4 py-3">
        <span className="size-2.5 rounded-full bg-red-500/80" />
        <span className="size-2.5 rounded-full bg-yellow-500/80" />
        <span className="size-2.5 rounded-full bg-green-500/80" />
        <span className="ml-2 font-mono text-[10px] text-muted-foreground">execution_ledger.log</span>
      </div>
      <div className="h-[340px] overflow-y-auto p-5 font-mono text-[12px] leading-relaxed">
        {events.length === 0 ? (
          <EmptyTerminal />
        ) : (
          <AnimatePresence initial={false}>
            {events.map((ev, i) => (
              <motion.div
                key={`${ev.cid}-${i}`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, delay: i * 0.05 }}
                className="flex items-baseline gap-3 border-b border-border/40 py-2 last:border-0"
              >
                <span className="w-[88px] shrink-0 font-mono text-[9px] text-zinc-600">{ts(ev.at)}</span>
                <span className={`w-[130px] shrink-0 font-mono text-[10.5px] font-semibold ${KIND_COLOR[ev.kind] ?? "text-zinc-300"}`}>
                  {ev.kind}
                </span>
                <span className="w-[90px] shrink-0 font-mono text-[10px] text-zinc-500">{ev.cid}</span>
                <span className="truncate text-zinc-300">{ev.ref}</span>
                <span className="ml-auto shrink-0 rounded border border-border/60 bg-card/50 px-1.5 py-0.5 font-mono text-[8px] tracking-[0.1em] text-zinc-500">
                  {PAYLOAD_LABEL[ev.payload] ?? ev.payload}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}

function EmptyTerminal() {
  return (
    <div className="flex h-full flex-col items-center justify-center py-16 text-center">
      <CircleDot className="mb-3 size-6 text-primary" />
      <p className="font-mono text-[13px] text-foreground">no rounds yet</p>
      <p className="mt-1.5 mx-auto max-w-[38ch] font-mono text-[10.5px] leading-relaxed text-muted-foreground">
        Run a round to create an RFQ, invite two dealers, seal the winning quote, and settle delivery-versus-payment.
      </p>
    </div>
  );
}

function ts(iso: string): string {
  if (!iso) return "--:--:--";
  return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
}