"use client";

import { motion } from "motion/react";
import { BadgeCheck, Check, CircleDot, Landmark, ReceiptText, Send, WalletCards, X } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import type { DashboardState } from "@/lib/types";

export function InstitutionalView({ state }: { state: DashboardState }) {
  const { institutional: inst, parties } = state;
  const buyerParty = inst.buyerParty;
  const latestRfq = inst.rfqs[inst.rfqs.length - 1] ?? null;
  const sealed = inst.sealedQuotes[inst.sealedQuotes.length - 1] ?? null;
  const receipt = inst.receipts[inst.receipts.length - 1] ?? null;
  const deal = inst.deals[inst.deals.length - 1] ?? null;
  const buyerBonds = inst.assets.filter((a) => a.symbol === "cTBILL").at(-1);
  const buyerCash = inst.assets.filter((a) => a.symbol === "cUSDC").at(-1);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <HudPanel
          label="Buyer participant view"
          icon={Landmark}
          badge={
            <StatusPill tone={buyerParty ? "live" : "muted"} label={buyerParty ? "AUTHORIZED" : "PROVISIONED"} pulse={!!buyerParty} />
          }
          className="lg:col-span-4"
        >
          <p className="mb-5 max-w-[60ch] text-[13px] leading-relaxed text-muted-foreground">
            Authorized view served from the buyer's participant node. Prices, block size, and settlement amounts are
            visible only on this projection.
          </p>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-[#09090b]/40 px-4 py-3">
            <WalletCards className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">buyer party</p>
              <p className="mt-1 break-all font-mono text-[10.5px] text-foreground">{buyerParty ?? "not provisioned"}</p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <Metric label="cTBILL block" value={buyerBonds ? fmtQty(buyerBonds.quantity) : "0"} accent={!!buyerBonds} />
            <Metric label="cUSDC spent" value={buyerCash ? fmtQty(buyerCash.quantity) : "0"} />
          </div>
        </HudPanel>

        <HudPanel label="Live RFQ" icon={Send} className="lg:col-span-4">
          {latestRfq ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-mono text-[14px] font-semibold text-foreground">{latestRfq.reference}</p>
                <StatusPill tone="live" label="OPEN" pulse />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-5">
                <Metric label="Size" value={`${fmtQty(latestRfq.amount)} ${latestRfq.assetToBuy}`} accent />
                <Metric label="Max price" value={fmtPrice(latestRfq.maxPrice)} />
                <Metric label="Settle in" value={latestRfq.settlementAsset} />
                <Metric label="Invited" value={latestRfq.dealers.length} />
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                {latestRfq.dealers.map((d) => (
                  <span key={d} className="rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {d}
                  </span>
                ))}
              </div>
            </>
          ) : (
            <NoData label="No RFQ yet. Run a round to fund the venue." />
          )}
        </HudPanel>

        <HudPanel label="Execution computers" icon={CircleDot} className="lg:col-span-4">
          {state.parties.dealerA && state.parties.dealerB ? (
            <div className="space-y-3">
              <DealerRow hint="dealerA" party={state.parties.dealerA} note="participant1" win={sealed?.dealer === "dealerA"} />
              <DealerRow hint="dealerB" party={state.parties.dealerB} note="participant2" win={sealed?.dealer === "dealerB"} />
            </div>
          ) : (
            <NoData label="Dealers are provisioned and online." />
          )}
        </HudPanel>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <HudPanel label="Quote proposals" icon={ReceiptText} className="lg:col-span-6">
          {inst.proposals.length === 0 ? (
            <NoData label="Dealers quote independently. Their prices are sealed until the buyer accepts." />
          ) : (
            <div className="space-y-3">
              {inst.proposals
                .slice()
                .reverse()
                .map((p) => {
                  const win = sealed?.dealer === p.dealer;
                  return (
                    <div
                      key={`${p.cid}-${p.at}`}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 transition-colors ${
                        win ? "border-primary/40 bg-primary/5" : "border-border bg-[#09090b]/40"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className={`font-mono text-[12px] font-semibold ${win ? "text-primary" : "text-foreground"}`}>
                          {p.dealer}
                        </span>
                        <span className="hidden font-mono text-[10px] text-muted-foreground sm:block">{p.bidId}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[13px] font-medium text-foreground">{fmtPrice(p.offeredPrice)}</span>
                        {win ? (
                          <span className="flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 font-mono text-[9px] font-semibold text-primary-foreground">
                            <Check className="size-3" /> SEALED
                          </span>
                        ) : sealed ? (
                          <span className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[9px] text-zinc-500">
                            <X className="size-3" /> LOST
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </HudPanel>

        <HudPanel label="Settlement" icon={BadgeCheck} className="lg:col-span-6">
          {receipt ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="font-mono text-[14px] font-semibold text-foreground">{receipt.reference}</p>
                <StatusPill tone="ok" label="DvP VERIFIED" pulse />
              </div>
              <div className="mt-5 grid grid-cols-3 gap-4">
                <Metric label="Quantity" value={fmtQty(receipt.quantity)} accent />
                <Metric label="Unit price" value={fmtPrice(receipt.unitPrice)} />
                <Metric label="Total value" value={fmtQty(receipt.totalValue)} accent />
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-[#09090b]/40 px-4 py-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">security</p>
                  <p className="mt-1 font-mono text-[12px] text-foreground">{receipt.security ?? "-"}</p>
                </div>
                <div className="rounded-xl border border-border bg-[#09090b]/40 px-4 py-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">settled at</p>
                  <p className="mt-1 font-mono text-[12px] text-foreground">{receipt.settledAt ? tsFull(receipt.settledAt) : "-"}</p>
                </div>
              </div>
              {deal && (
                <p className="mt-5 font-mono text-[10px] text-zinc-500">
                  deal <span className="text-foreground">{deal.cid}</span> → receipt{" "}
                  <span className="text-foreground">{receipt.cid}</span>
                </p>
              )}
            </>
          ) : (
            <NoData label="Nothing settled yet. Run a round to see atomic delivery-versus-payment." />
          )}
        </HudPanel>
      </div>
    </div>
  );
}

function DealerRow({ hint, party, note, win }: { hint: string; party: string; note: string; win: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${win ? "border-primary/40 bg-primary/5" : "border-border bg-[#09090b]/40"}`}>
      <div className="flex items-center gap-3">
        <span className={`size-1.5 rounded-full ${win ? "bg-primary animate-pulse" : "bg-emerald-400"}`} />
        <div>
          <p className="font-mono text-[12px] font-semibold text-foreground">{hint}</p>
          <p className="font-mono text-[9px] text-zinc-500">{note}</p>
        </div>
      </div>
      <p className="max-w-[45%] truncate font-mono text-[9px] text-zinc-500" title={party}>
        {party}
      </p>
    </div>
  );
}

function NoData({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-[120px] flex-col items-center justify-center text-center">
      <CircleDot className="mb-2 size-5 text-zinc-600" />
      <p className="mx-auto max-w-[34ch] font-mono text-[11px] leading-relaxed text-muted-foreground">{label}</p>
    </div>
  );
}

const fmtQty = (n: string): string => Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });
const fmtPrice = (n: string): string => Number(n).toFixed(2);
const tsFull = (iso: string): string => new Date(iso).toLocaleTimeString("en-US", { hour12: false });