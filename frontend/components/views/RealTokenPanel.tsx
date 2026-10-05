"use client";

import { motion } from "motion/react";
import { Coins, Lock, RefreshCw } from "lucide-react";
import { HudPanel, Metric, StatusPill } from "../hud";
import { partyHint } from "@/lib/format";
import type { DashboardState, RealHoldingView, RealLegView, RealSettlementRecord } from "@/lib/types";

/**
 * Real registry balances and the allocation legs that move them.
 *
 * The rest of the institutional view describes the workflow in ShadowDesk's own
 * asset contracts. This panel shows the tokens the registry actually holds, so a
 * settled receipt can be read against the balances it moved rather than taken on
 * trust. A reserved holding is shown separately because it cannot be spent: the
 * registry rejects it, so a raw total alone would overstate what is tradeable.
 */

interface Balance {
  instrument: string;
  total: number;
  free: number;
  reserved: number;
  count: number;
}

const sum = (rows: RealHoldingView[], pick: (h: RealHoldingView) => boolean): number =>
  rows.filter(pick).reduce((acc, h) => acc + Number(h.amount), 0);

const balancesFor = (holdings: RealHoldingView[], role: string): Balance[] => {
  const rows = holdings.filter((h) => h.role === role);
  const instruments = [...new Set(rows.map((h) => h.instrument))].sort();
  return instruments.map((instrument) => {
    const mine = rows.filter((h) => h.instrument === instrument);
    const reserved = sum(mine, (h) => h.locked);
    return {
      instrument,
      total: sum(mine, () => true),
      free: sum(mine, (h) => !h.locked),
      reserved,
      count: mine.length,
    };
  });
};

const fmt = (n: number): string =>
  Number.isInteger(n) ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { maximumFractionDigits: 10 });

export function RealTokenPanel({ state }: { state: DashboardState }) {
  const holdings = state.institutional.realHoldings ?? [];
  const legs = state.institutional.realLegs ?? [];
  const settled = state.realSettlements ?? [];
  const { buyer, dealerA, dealerB } = state.parties;

  const roles: Array<[string, string | null]> = [
    ["buyer", buyer],
    ["dealerA", dealerA],
    ["dealerB", dealerB],
  ];

  if (holdings.length === 0 && settled.length === 0) {
    return (
      <HudPanel
        label="Registry balances"
        icon={Coins}
        badge={<StatusPill tone="muted" label="NO REGISTRY STATE" />}
      >
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          No Token Standard holdings are visible for the configured parties. The local sandbox has no token registry,
          so this panel stays empty there and fills in on DevNet.
        </p>
      </HudPanel>
    );
  }

  return (
    <HudPanel
      label="Registry balances"
      icon={Coins}
      badge={
        <StatusPill
          tone={legs.length > 0 ? "live" : "ok"}
          label={legs.length > 0 ? `${legs.length} OPEN LEG${legs.length === 1 ? "" : "S"}` : "SETTLED"}
          pulse={legs.length > 0}
        />
      }
    >
      <p className="mb-5 max-w-[72ch] text-[13px] leading-relaxed text-muted-foreground">
        Token Standard holdings read from each party&rsquo;s own participant node. These are the balances a settlement
        draws on; a settled receipt below is backed by these numbers moving, not by the workflow&rsquo;s own asset
        contracts.
      </p>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {roles.map(([role, party]) => {
          const balances = balancesFor(holdings, role);
          return (
            <div
              key={role}
              className="rounded-xl border border-border bg-[#030206]/40 px-4 py-3"
            >
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                {role} {partyHint(party ?? "")}
              </p>
              {balances.length === 0 ? (
                <p className="mt-2 font-mono text-[11px] text-zinc-600">no registry holdings</p>
              ) : (
                <div className="mt-3 space-y-3">
                  {balances.map((b) => (
                    <div key={b.instrument}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[12px] font-semibold text-foreground">{b.instrument}</span>
                        <span className="font-mono text-[12px] text-primary">{fmt(b.total)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                        <span>{fmt(b.free)} free</span>
                        <span className="text-zinc-600">
                          {b.count} holding{b.count === 1 ? "" : "s"}
                        </span>
                        {b.reserved > 0 && (
                          <span className="inline-flex items-center gap-1 text-amber-300/90">
                            <Lock className="size-2.5" /> {fmt(b.reserved)} reserved
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {settled.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            settled registry legs
          </p>
          <p className="mb-3 text-[11px] leading-relaxed text-zinc-600">
            An allocation is consumed by its own execution, so it leaves the active contract set and cannot be read
            back afterwards. These are the ids and amounts the settle itself returned, together with the update that
            carried the receipt and both transfers in one transaction.
          </p>
          <div className="space-y-3">
            {settled.map((r) => (
              <SettledRecord key={r.updateId + r.receiptCid} record={r} />
            ))}
          </div>
        </div>
      )}

      {legs.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            open allocation legs
          </p>
          <div className="space-y-2">
            {legs.map((leg) => (
              <LegRow key={leg.cid + leg.legId} leg={leg} />
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
            An allocation reserves its input holdings until it settles or is cancelled. Reserved balance above is the
            amount those legs are holding.
          </p>
        </div>
      )}
    </HudPanel>
  );
}

function SettledRecord({ record }: { record: RealSettlementRecord }) {
  const fmt = (n: number): string => n.toLocaleString("en-US", { maximumFractionDigits: 10 });
  return (
    <div className="rounded-lg border border-border bg-[#030206]/30 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <span className="truncate font-mono text-[10px] text-muted-foreground">{record.settlementRef}</span>
        <span className="font-mono text-[10px] text-zinc-600">update {record.updateId.slice(0, 16)}</span>
      </div>
      <div className="mt-1.5 space-y-1">
        {record.legs.map((leg) => (
          <div key={leg.cid + leg.legId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-0.5">
            <div className="flex items-center gap-2 font-mono text-[10.5px]">
              <span className="uppercase tracking-[0.14em] text-zinc-500">{leg.legId}</span>
              <span className="text-foreground">
                {partyHint(leg.sender)} <span className="text-zinc-600">&rarr;</span> {partyHint(leg.receiver)}
              </span>
            </div>
            <span className="font-mono text-[10.5px] font-semibold text-primary">
              {fmt(Number(leg.amount))} {leg.instrument}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-1.5 font-mono text-[9.5px] text-zinc-600">
        receipt {record.receiptCid.slice(0, 16)} &middot; {record.delivered} for {record.payment}
      </p>
    </div>
  );
}

function LegRow({ leg }: { leg: RealLegView }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-[#030206]/30 px-3 py-2"
    >
      <div className="flex min-w-0 items-center gap-2">
        <RefreshCw className="size-3 shrink-0 text-primary" />
        <span className="truncate font-mono text-[10px] text-muted-foreground">{leg.settlementRef}</span>
      </div>
      <div className="flex items-center gap-3 font-mono text-[10.5px]">
        <span className="uppercase tracking-[0.14em] text-zinc-500">{leg.legId}</span>
        <span className="text-foreground">
          {partyHint(leg.sender)} <span className="text-zinc-600">&rarr;</span> {partyHint(leg.receiver)}
        </span>
        <span className="font-semibold text-primary">
          {fmt(Number(leg.amount))} {leg.instrument}
        </span>
      </div>
    </motion.div>
  );
}

/**
 * The net effect of a settlement, derived rather than restated.
 *
 * Shown next to the receipt so the two can be compared: the receipt is the
 * workflow's claim, this is the registry's.
 */
export function SettlementEffect({ state }: { state: DashboardState }) {
  const receipt = state.institutional.receipts.at(-1);
  if (!receipt) return null;

  const issuer = String(receipt.security ?? "");
  const instrument = issuer.includes("::") ? (state.institutional.realHoldings.find((h) => h.instrument)?.instrument ?? "") : "";
  if (!instrument) return null;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <Metric label="receipt security" value={instrument || "-"} accent />
      <Metric label="quantity" value={fmt(Number(receipt.quantity))} />
      <Metric label="unit price" value={fmt(Number(receipt.unitPrice))} />
      <Metric label="total value" value={fmt(Number(receipt.totalValue))} />
    </div>
  );
}