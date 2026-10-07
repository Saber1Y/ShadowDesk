"use client";

import { Play, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import { HudPanel } from "../hud";
import type { MandateView } from "@/lib/types";

type Envelope = { mandate: MandateView; breaches: string[]; within: boolean } | null;

export function TradeRequestPanel({
  devnet,
  amount,
  maxPrice,
  assetToBuy,
  settlementAsset,
  realDelivered,
  realPayment,
  envelope,
  running,
  disabled,
  onAmountChange,
  onMaxPriceChange,
  onAssetToBuyChange,
  onSettlementAssetChange,
  onRealDeliveredChange,
  onRealPaymentChange,
  onMatchMandate,
  onRun,
}: {
  devnet: boolean;
  amount: string;
  maxPrice: string;
  assetToBuy: string;
  settlementAsset: string;
  realDelivered: string;
  realPayment: string;
  envelope: Envelope;
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
}) {
  return (
    <HudPanel
      label="Private trade request"
      badge={
        <button
          type="button"
          onClick={onRun}
          disabled={disabled || running}
          className="flex items-center gap-2 rounded-full bg-primary px-3.5 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-foreground shadow-[0_0_20px_rgba(243,255,151,0.16)] transition-[transform,background-color,opacity] duration-200 ease-out hover:-translate-y-0.5 hover:bg-[#f7ffb5] active:scale-[0.98] disabled:translate-y-0 disabled:scale-100 disabled:opacity-40"
        >
          {running ? <RefreshCw className="size-3 animate-spin" /> : <Play className="size-3" />}
          {running ? "Running" : "Run round"}
        </button>
      }
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Mandate-bound inputs</p>
          <p className="mt-1 text-[13px] text-muted-foreground">
            Parameterize the next execution inside the private institutional workspace.
          </p>
        </div>
        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">AUTHORIZED ACTION</span>
      </div>

      {devnet ? (
        <div className="rounded-xl border border-primary/25 bg-primary/[0.04] px-4 py-3">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">Registry settlement</p>
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-500">
              Token Standard CIP-56 · settled on-ledger
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <InstrumentField label="Delivered" value={realDelivered} onChange={onRealDeliveredChange} exclude={realPayment} />
            <InstrumentField label="Paid" value={realPayment} onChange={onRealPaymentChange} exclude={realDelivered} />
            <NumberField label="Amount" value={amount} onChange={onAmountChange} />
            <NumberField label="Maximum price" value={maxPrice} onChange={onMaxPriceChange} step="0.01" />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AssetField label="Security" value={assetToBuy} onChange={onAssetToBuyChange} listId="security-assets" />
          <AssetField label="Settlement" value={settlementAsset} onChange={onSettlementAssetChange} listId="settlement-assets" />
          <NumberField label="Amount" value={amount} onChange={onAmountChange} />
          <NumberField label="Maximum price" value={maxPrice} onChange={onMaxPriceChange} step="0.01" />
        </div>
      )}

      <EnvelopeReadout envelope={envelope} onMatch={onMatchMandate} />
    </HudPanel>
  );
}

function EnvelopeReadout({ envelope, onMatch }: { envelope: Envelope; onMatch: () => void }) {
  if (!envelope) {
    return (
      <p className="mt-4 border-t border-border pt-4 font-mono text-[10px] leading-relaxed text-zinc-600">
        No approved mandate on the ledger. Running a round will create one, then open the RFQ under it.
      </p>
    );
  }
  const { mandate, breaches, within } = envelope;
  return (
    <div className={`mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4 ${within ? "border-border" : "border-destructive/30"}`}>
      <p className={`flex items-center gap-2 font-mono text-[10px] ${within ? "text-primary" : "text-destructive"}`}>
        {within ? <ShieldCheck className="size-3 shrink-0" /> : <TriangleAlert className="size-3 shrink-0" />}
        <span className="uppercase tracking-[0.14em]">{within ? "inside envelope" : `outside envelope: ${breaches.join(", ")}`}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">{mandate.reference}</span>
      </p>
      <p className="font-mono text-[10px] text-muted-foreground">
        ceiling {Number(mandate.maxPrice).toFixed(2)} · max {Number(mandate.maxAmount).toLocaleString("en-US", { maximumFractionDigits: 2 })}
        {!within && (
          <button type="button" onClick={onMatch} className="ml-3 uppercase tracking-[0.14em] text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary">
            match mandate
          </button>
        )}
      </p>
    </div>
  );
}

function AssetField({ label, value, onChange, listId }: { label: string; value: string; onChange: (value: string) => void; listId: string }) {
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

function InstrumentField({ label, value, onChange, exclude }: { label: string; value: string; onChange: (value: string) => void; exclude?: string }) {
  const options = ["CBTC", "BETH"].filter((option) => option !== exclude);
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-[#030206]/60 px-3 py-2 font-mono text-[12px] text-foreground outline-none transition-colors focus:border-primary/60"
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
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
