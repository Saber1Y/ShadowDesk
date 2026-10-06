"use client";

import { AlertTriangle, CheckCircle2, WalletCards } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import type { DashboardState, RealHoldingView } from "@/lib/types";

const DECIMALS: Record<string, number> = { CBTC: 10, BETH: 10 };

const tokenAmount = (value: number, instrument: string): string => {
  if (!Number.isFinite(value)) return "-";
  const decimals = DECIMALS[instrument] ?? 10;
  return value.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
};

const freeBalance = (holdings: RealHoldingView[], role: string, instrument: string): number =>
  holdings
    .filter((h) => h.role === role && h.instrument === instrument && !h.locked)
    .reduce((sum, h) => sum + Number(h.amount), 0);

/**
 * Turns the order form into a pre-trade funding decision.
 *
 * This deliberately reports token amounts, not invented USD values. A USD value
 * needs a trusted price source for each instrument; until one is configured,
 * "price unavailable" is safer than presenting a stale or guessed valuation.
 */
export function PreTradeFundingPanel({
  state,
  amount,
  maxPrice,
  delivered,
  payment,
}: {
  state: DashboardState;
  amount: string;
  maxPrice: string;
  delivered: string;
  payment: string;
}) {
  const holdings = state.institutional.realHoldings ?? [];
  const amountBase = Number(amount);
  const price = Number(maxPrice);
  const decimals = DECIMALS[delivered] ?? 10;
  const deliveredAmount = Number.isSafeInteger(amountBase) && amountBase > 0
    ? amountBase / 10 ** decimals
    : NaN;
  const requiredPayment = Number.isFinite(deliveredAmount) && Number.isFinite(price)
    ? deliveredAmount * price
    : NaN;

  const buyerAvailable = freeBalance(holdings, "buyer", payment);
  const dealerRows = ["dealerA", "dealerB"].map((role) => ({
    role,
    available: freeBalance(holdings, role, delivered),
  }));
  const buyerFunded = Number.isFinite(requiredPayment) && buyerAvailable >= requiredPayment;
  const dealersFunded = dealerRows.every((row) => row.available >= deliveredAmount);
  const hasData = holdings.length > 0;
  const funded = hasData && buyerFunded && dealersFunded;

  return (
    <HudPanel
      label="Pre-trade funding"
      icon={WalletCards}
      badge={
        <StatusPill
          tone={!hasData ? "muted" : funded ? "ok" : "failed"}
          label={!hasData ? "NO REGISTRY DATA" : funded ? "FUNDED" : "INSUFFICIENT"}
          pulse={funded}
        />
      }
    >
      <p className="mb-5 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
        Checks free Token Standard holdings before the RFQ. Reserved holdings are excluded because they cannot fund a
        new trade. USD valuation is unavailable until a trusted price source is configured.
      </p>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Metric label="delivering" value={`${tokenAmount(deliveredAmount, delivered) || "-"} ${delivered}`} />
        <Metric label="payment required" value={`${tokenAmount(requiredPayment, payment) || "-"} ${payment}`} accent={buyerFunded} />
        <Metric label="buyer available" value={`${tokenAmount(buyerAvailable, payment)} ${payment}`} accent={buyerFunded} />
        <Metric label="USD valuation" value="unavailable" />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
        {dealerRows.map((dealer) => {
          const enough = Number.isFinite(deliveredAmount) && dealer.available >= deliveredAmount;
          return (
            <div key={dealer.role} className="rounded-xl border border-border bg-[#030206]/40 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {dealer.role} inventory
                </span>
                {enough ? <CheckCircle2 className="size-3.5 text-emerald-400" /> : <AlertTriangle className="size-3.5 text-amber-300" />}
              </div>
              <div className="mt-2 flex items-baseline justify-between gap-3 font-mono">
                <span className="text-[11px] text-muted-foreground">free {delivered}</span>
                <span className={enough ? "text-[12px] text-foreground" : "text-[12px] text-amber-300"}>
                  {tokenAmount(dealer.available, delivered)} / {tokenAmount(deliveredAmount, delivered)} required
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {!hasData && <p className="mt-4 text-[11px] text-zinc-500">Connect to DevNet to read real Token Standard holdings.</p>}
      {hasData && !buyerFunded && <p className="mt-4 text-[11px] text-amber-300">Buyer payment balance is below the required amount.</p>}
      {hasData && buyerFunded && !dealersFunded && <p className="mt-4 text-[11px] text-amber-300">At least one invited dealer cannot deliver the requested amount.</p>}
    </HudPanel>
  );
}
