"use client";

import { motion } from "motion/react";
import { Gavel, TrendingDown } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import { partyHint } from "@/lib/format";
import type { DashboardState } from "@/lib/types";

/**
 * Best-execution evidence, derived from the bids on the ledger.
 *
 * The ledger cannot enumerate proposals, so it cannot verify that the buyer took
 * the cheapest bid. What it does do is record every bid immutably before the
 * award, which makes the choice auditable afterwards: the sealed price can be
 * compared against every published bid and against the mandate cap. That
 * comparison is reconstructed here from ledger data alone, so a reviewer can
 * re-derive it rather than take the venue's word for it.
 */
export function BestExecutionPanel({ state }: { state: DashboardState }) {
  const { rfqs, proposals, sealedQuotes, receipts, mandates } = state.institutional;
  const rfq = rfqs.at(-1) ?? null;
  if (!rfq || rfqs.length === 0) return null;

  const bids = proposals.filter((p) => p.rfqRef === rfq.reference);
  const sealed = sealedQuotes.find((s) => s.bidId === sealedQuotes.at(-1)?.bidId) ?? sealedQuotes.at(-1) ?? null;
  if (!sealed || bids.length === 0) return null;

  const ranked = [...bids].sort(
    (a, b) => Number(a.offeredPrice) - Number(b.offeredPrice) || a.bidId.localeCompare(b.bidId),
  );
  const awarded = ranked.find((b) => b.bidId === sealed.bidId);
  const runnerUp = ranked.find((b) => b.bidId !== sealed.bidId);
  const saving = awarded && runnerUp ? Number(runnerUp.offeredPrice) - Number(awarded.offeredPrice) : 0;
  const isCheapest = ranked[0]?.bidId === sealed.bidId;

  const mandate = mandates.find((m) => m.reference === rfq.mandateRef) ?? null;
  const cap = mandate ? Number(mandate.maxPrice) : Number(rfq.maxPrice);
  const withinCap = Number(sealed.offeredPrice) <= cap;

  const fmt = (n: number): string =>
    n.toLocaleString("en-US", { maximumFractionDigits: 10 });

  return (
    <HudPanel
      label="Best execution"
      icon={Gavel}
      badge={
        <StatusPill
          tone={isCheapest && withinCap ? "ok" : "failed"}
          label={isCheapest ? "CHEAPEST BID" : "NOT CHEAPEST"}
          pulse={isCheapest}
        />
      }
    >
      <p className="mb-5 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
        Every bid below was committed to the ledger before the award. The sealed price is compared against all of
        them and against the mandate cap, so the buyer&rsquo;s selection can be re-derived rather than trusted.
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="bids published" value={String(ranked.length)} />
        <Metric label="sealed price" value={fmt(Number(sealed.offeredPrice))} accent={isCheapest} />
        <Metric label="best alternative" value={runnerUp ? fmt(Number(runnerUp.offeredPrice)) : "n/a"} />
        <Metric label="saving" value={fmt(saving)} accent={saving > 0} />
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-border">
        {ranked.map((bid, i) => {
          const won = bid.bidId === sealed.bidId;
          return (
            <motion.div
              key={bid.bidId}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.22, delay: i * 0.04, ease: [0.16, 1, 0.3, 1] }}
              className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 last:border-b-0 ${
                won ? "bg-primary/[0.07]" : "bg-[#030206]/30"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-4 font-mono text-[10px] text-zinc-600">{i + 1}</span>
                <span className="font-mono text-[11px] text-foreground">{partyHint(bid.dealer)}</span>
                {won && (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-primary">
                    awarded
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 font-mono text-[11px]">
                <span className="text-muted-foreground">{bid.bidId}</span>
                <span className={won ? "font-semibold text-primary" : "text-foreground"}>
                  {fmt(Number(bid.offeredPrice))}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.14em]">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <TrendingDown className="size-3 text-primary" />
          policy {rfq.awarded ? "LowestPriceThenBidId" : "open"}
        </span>
        <span className={withinCap ? "text-muted-foreground" : "text-red-400"}>
          mandate cap {fmt(cap)} {withinCap ? "respected" : "BREACHED"}
        </span>
        {receipts.at(-1) && (
          <span className="text-zinc-600">
            settled at {fmt(Number(receipts.at(-1)!.unitPrice))} on receipt {receipts.at(-1)!.cid}
          </span>
        )}
      </div>

      {!isCheapest && (
        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-400/5 px-3 py-2 text-[11px] leading-relaxed text-red-300">
          The awarded bid was not the cheapest published bid. The ledger records the award but does not forbid it, so
          this is a venue-side obligation rather than a runtime-enforced one.
        </p>
      )}
    </HudPanel>
  );
}