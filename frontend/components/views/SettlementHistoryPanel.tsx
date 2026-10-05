"use client";

import { motion } from "motion/react";
import { History } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import { fmtAmount, fmtPrice } from "@/lib/format";
import type { DashboardState } from "@/lib/types";

/**
 * Every settlement on the ledger, newest first.
 *
 * The receipts are the durable record, and they outlive any single run, so this
 * is reconstructed from the ledger rather than from what the current server
 * process happens to remember. Each row is labelled with whether the trade
 * settled real registry tokens or the workflow's own synthetic assets, because
 * those are very different claims and reading them off one undifferentiated list
 * would be misleading.
 */
export function SettlementHistoryPanel({ state }: { state: DashboardState }) {
  const { receipts, realHoldings } = state.institutional;
  if (receipts.length === 0) return null;

  // The registry instruments actually observed on the ledger, so a receipt can be
  // classified from evidence rather than from the shape of its issuer string.
  const registryInstruments = new Set(realHoldings.map((h) => h.instrument));
  const rows = [...receipts].reverse();
  const settled = rows.filter((r) => registryInstruments.has(String(r.security)));
  const volume = settled.reduce((sum, r) => sum + Number(r.totalValue), 0);

  return (
    <HudPanel
      label="Settlement history"
      icon={History}
      badge={
        <StatusPill
          tone={settled.length > 0 ? "live" : "muted"}
          label={`${settled.length} REAL · ${rows.length - settled.length} SYNTHETIC`}
          pulse={settled.length > 0}
        />
      }
    >
      <p className="mb-5 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
        Read from the on-chain receipts, so this survives a restart and covers every round this ledger has run, not
        only the most recent. Trades labelled <span className="text-foreground">REAL</span> moved registry tokens in
        the same update as their receipt.
      </p>

      {settled.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="settlements" value={String(rows.length)} />
          <Metric label="real token trades" value={String(settled.length)} accent />
          <Metric label="instruments" value={[...registryInstruments].sort().join(" / ") || "-"} />
          <Metric label="oldest" value={rows[rows.length - 1].settledAt ? fmtDate(rows[rows.length - 1].settledAt) : "-"} />
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        {rows.map((r, i) => {
          const isReal = registryInstruments.has(String(r.security));
          return (
            <motion.div
              key={`${r.reference}-${r.cid}`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3), ease: [0.16, 1, 0.3, 1] }}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-border px-4 py-2.5 last:border-b-0 odd:bg-[#030206]/30"
            >
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full border px-1.5 py-0.5 font-mono text-[8.5px] uppercase tracking-[0.14em] ${
                      isReal
                        ? "border-primary/30 bg-primary/10 text-primary"
                        : "border-border bg-card/60 text-zinc-500"
                    }`}
                  >
                    {isReal ? "real" : "synthetic"}
                  </span>
                  <span className="truncate font-mono text-[11px] text-foreground">{r.reference}</span>
                </div>
                <span className="font-mono text-[9.5px] text-zinc-600">
                  {r.settledAt ? fmtDate(r.settledAt) : "unsettled"}
                  {r.mandateRef ? ` · mandate ${r.mandateRef}` : " · no mandate"}
                </span>
              </div>

              <div className="flex items-center gap-4 font-mono text-[11px]">
                <span className="text-foreground">{r.security}</span>
                <span className="text-muted-foreground">
                  {fmtAmount(r.quantity)} @ {fmtPrice(r.unitPrice)}
                </span>
                <span className={isReal ? "font-semibold text-primary" : "text-foreground"}>
                  {fmtAmount(r.totalValue)}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {settled.length > 0 && (
        <p className="mt-3 font-mono text-[9.5px] uppercase tracking-[0.14em] text-zinc-600">
          real-token notional across {settled.length} settlement{settled.length === 1 ? "" : "s"}: {fmtAmount(String(volume))}
        </p>
      )}
    </HudPanel>
  );
}

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toISOString().slice(0, 16).replace("T", " ");
};
