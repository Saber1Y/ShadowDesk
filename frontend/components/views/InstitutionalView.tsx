"use client";

import { motion } from "motion/react";
import { BadgeCheck, Check, CircleDot, Landmark, ReceiptText, Send, ShieldCheck, WalletCards, X } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import { RealTokenPanel } from "./RealTokenPanel";
import { BestExecutionPanel } from "./BestExecutionPanel";
import { SettlementHistoryPanel } from "./SettlementHistoryPanel";
import { PreTradeFundingPanel } from "./PreTradeFundingPanel";
import { TradeRequestPanel } from "./TradeRequestPanel";
import type { DashboardState, MandateView } from "@/lib/types";

export function InstitutionalView({
  state,
  tradeRequest,
}: {
  state: DashboardState;
  tradeRequest: {
    devnet: boolean;
    amount: string;
    maxPrice: string;
    assetToBuy: string;
    settlementAsset: string;
    realDelivered: string;
    realPayment: string;
    envelope: { mandate: MandateView; breaches: string[]; within: boolean } | null;
    running: boolean;
    disabled: boolean;
    onAmountChange: (value: string) => void;
    onMaxPriceChange: (value: string) => void;
    onAssetToBuyChange: (value: string) => void;
    onSettlementAssetChange: (value: string) => void;
    onRealDeliveredChange: (value: string) => void;
    onRealPaymentChange: (value: string) => void;
    onMatchMandate: () => void;
    onRun: () => void;
  };
}) {
  const { institutional: inst, parties } = state;
  const buyerParty = inst.buyerParty;
  const latestRfq = inst.rfqs[inst.rfqs.length - 1] ?? null;
  const sealed = inst.sealedQuotes[inst.sealedQuotes.length - 1] ?? null;
  const receipt = inst.receipts[inst.receipts.length - 1] ?? null;
  const deal = inst.deals[inst.deals.length - 1] ?? null;
  const buyerBonds = inst.assets.filter((a) => a.symbol === "cTBILL").at(-1);
  const buyerCash = inst.assets.filter((a) => a.symbol === "cUSDC").at(-1);
  // Prefer an approved envelope; fall back to one still awaiting its second
  // signature so the panel reports the current authorisation state honestly.
  const mandate = (inst.mandates ?? []).filter((m) => m.status === "ACTIVE").at(-1)
    ?? (inst.mandates ?? []).at(-1)
    ?? null;

  return (
    <div className="space-y-5">
      <MandatePanel mandate={mandate} mandateCount={inst.mandates?.length ?? 0} />
      {tradeRequest.devnet && <PreTradeFundingPanel state={state} amount={tradeRequest.amount} maxPrice={tradeRequest.maxPrice} delivered={tradeRequest.realDelivered} payment={tradeRequest.realPayment} />}
      <TradeRequestPanel {...tradeRequest} />
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
          <div className="flex items-start gap-3 rounded-xl border border-border bg-[#030206]/40 px-4 py-3">
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

        <HudPanel label={latestRfq?.awarded ? "Awarded RFQ" : "Live RFQ"} icon={Send} className="lg:col-span-4">
          {latestRfq ? (
            <>
              <div className="flex items-center justify-between gap-2">
                <p className="truncate font-mono text-[14px] font-semibold text-foreground">{latestRfq.reference}</p>
                <div className="flex items-center gap-2">
                  {latestRfq.mandated && (
                    <span
                      className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-primary"
                      title={latestRfq.mandateRef ? `Mandate ${latestRfq.mandateRef}` : "Executed under a treasury mandate"}
                    >
                      <ShieldCheck className="size-3" /> Mandated
                    </span>
                  )}
                  {latestRfq.awarded ? (
                    <StatusPill tone="ok" label="AWARDED" />
                  ) : (
                    <StatusPill tone="live" label="OPEN" pulse />
                  )}
                </div>
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
                        win ? "border-primary/40 bg-primary/5" : "border-border bg-[#030206]/40"
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
                <div className="rounded-xl border border-border bg-[#030206]/40 px-4 py-3">
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">security</p>
                  <p className="mt-1 font-mono text-[12px] text-foreground">{receipt.security ?? "-"}</p>
                </div>
                <div className="rounded-xl border border-border bg-[#030206]/40 px-4 py-3">
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
              {receipt.mandateRef && (
                <p className="mt-2 flex items-center gap-2 font-mono text-[10px] text-primary">
                  <ShieldCheck className="size-3 shrink-0" />
                  settled under mandate{" "}
                  <span className="text-foreground">{receipt.mandateRef}</span>
                </p>
              )}
            </>
          ) : (
            <NoData label="Nothing settled yet. Run a round to see atomic delivery-versus-payment." />
          )}
        </HudPanel>
      </div>
      <BestExecutionPanel state={state} />
      <RealTokenPanel state={state} />
      <SettlementHistoryPanel state={state} />
    </div>
  );
}

function MandatePanel({ mandate, mandateCount }: { mandate: MandateView | null; mandateCount: number }) {
  if (!mandate) {
    return (
      <HudPanel label="Treasury mandate" icon={ShieldCheck}>
        <div className="flex h-full min-h-[110px] flex-col items-center justify-center text-center">
          <ShieldCheck className="mb-2 size-5 text-zinc-600" />
          <p className="mx-auto max-w-[46ch] font-mono text-[11px] leading-relaxed text-muted-foreground">
            No treasury mandate on the ledger yet. Run a round to execute under dual control.
          </p>
        </div>
      </HudPanel>
    );
  }

  const expired = new Date(mandate.expiry).getTime() <= Date.now();
  const tone = expired ? "failed" : mandate.status === "ACTIVE" ? "live" : "muted";
  const label = expired ? "EXPIRED" : mandate.status === "ACTIVE" ? "ACTIVE" : "AWAITING CO-SIGN";

  return (
    <HudPanel
      label="Treasury mandate"
      icon={ShieldCheck}
      className="lg:col-span-12"
      badge={<StatusPill tone={tone} label={label} pulse={!expired && mandate.status === "ACTIVE"} />}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-[15px] font-semibold tracking-[-0.01em] text-foreground">{mandate.reference}</p>
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">
          {mandateCount} on ledger · cid {mandate.cid}
        </p>
      </div>

      <p className="mt-3 max-w-[70ch] text-[13px] leading-relaxed text-muted-foreground">
        The agent cannot settle outside this envelope. Amount, price, instrument pair, dealer list, and expiry are
        asserted by the Canton runtime at RFQ open, award, and settlement.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Buy" value={mandate.assetToBuy} accent />
        <Metric label="Settle in" value={mandate.settlementAsset} />
        <Metric label="Max amount" value={fmtQty(mandate.maxAmount)} accent />
        <Metric label="Price ceiling" value={fmtPrice(mandate.maxPrice)} />
        <Metric label="Expires" value={tsStamp(mandate.expiry)} />
        <Metric label={mandate.status === "ACTIVE" ? "Approved" : "Raised"} value={tsStamp(mandate.approvedAt ?? mandate.at)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-xl border border-border bg-[#030206]/40 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">dual control</p>
          <div className="mt-3 space-y-2">
            <SignatoryRow role="buyer" party={mandate.buyer} />
            <SignatoryRow role="risk officer" party={mandate.riskOfficer} />
          </div>
        </div>
        <div className="rounded-xl border border-border bg-[#030206]/40 px-4 py-3">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">approved dealers</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {mandate.approvedDealers.length === 0 ? (
              <span className="font-mono text-[10px] text-zinc-600">none listed</span>
            ) : (
              mandate.approvedDealers.map((d) => (
                <span
                  key={d}
                  className="rounded-full border border-border bg-card/70 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                >
                  {d}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </HudPanel>
  );
}

function SignatoryRow({ role, party }: { role: string; party: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        <span className="size-1.5 rounded-full bg-primary" />
        {role}
      </span>
      <span className="max-w-[60%] truncate font-mono text-[10.5px] text-foreground" title={party}>
        {party}
      </span>
    </div>
  );
}

function DealerRow({ hint, party, note, win }: { hint: string; party: string; note: string; win: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${win ? "border-primary/40 bg-primary/5" : "border-border bg-[#030206]/40"}`}>
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
const tsStamp = (iso: string): string => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "2-digit" })} ${d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })}`;
};
