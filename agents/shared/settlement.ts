import { CantonClient } from "../shared/client.js";
import { TPL } from "../shared/types.js";
import type { AssetIdSpec } from "../shared/config.js";

export interface SettlementIntent {
  dealerParty: string;
  securitySymbol: string;
  securityCid: string;
  quantity: number;
  participant: string;
}

const store = new Map<string, SettlementIntent>();

export const registerSettlementIntent = (intent: SettlementIntent): void => {
  store.set(intent.dealerParty, intent);
};

export const resolveSettlementIntent = (dealerParty: string): SettlementIntent => {
  const intent = store.get(dealerParty);
  if (!intent) throw new Error(`No settlement intent disclosed for dealer ${dealerParty}`);
  return intent;
};

export interface DealSpec {
  reference: string;
  buyer: string;
  dealer: string;
  securitySymbol: string;
  quantity: number;
  unitPrice: number;
  paymentCid: string;
  securityCid: string;
  settlementAsset: AssetIdSpec;
  expiry: string;
}

export const settleDeal = async (
  client: CantonClient,
  spec: DealSpec,
): Promise<{ dealCid: string; receiptCid: string; receipt: Record<string, unknown> }> => {
  const dealTx = await client.create(
    "Deal",
    {
      reference: spec.reference,
      buyer: spec.buyer,
      dealer: spec.dealer,
      security: { issuer: "ShadowDesk", symbol: spec.securitySymbol },
      quantity: String(spec.quantity),
      unitPrice: spec.unitPrice.toFixed(2),
      settlementAsset: spec.settlementAsset,
      paymentCid: spec.paymentCid,
      securityCid: spec.securityCid,
      expiry: spec.expiry,
    },
    [spec.buyer, spec.dealer],
    `cmd-deal-${spec.reference}`,
  );
  let dealCid: string | null = null;
  for (const e of dealTx.transaction.events) {
    const created = (e as any).CreatedEvent;
    if (created && created.templateId.endsWith(":ShadowDesk.Settlement:Deal")) dealCid = created.contractId;
  }
  if (!dealCid) throw new Error("Deal create produced no contract");

  const settleTx = await client.exercise(
    "Deal",
    dealCid,
    "Settle",
    {},
    [spec.buyer, spec.dealer],
    `cmd-settle-${spec.reference}`,
  );
  let receiptCid: string | null = null;
  let receipt: Record<string, unknown> | null = null;
  for (const e of settleTx.transaction.events) {
    const created = (e as any).CreatedEvent;
    if (created && created.templateId.endsWith(":ShadowDesk.Settlement:SettlementReceipt")) {
      receiptCid = created.contractId;
      receipt = created.createArgument as Record<string, unknown>;
    }
  }
  if (!dealCid || !receiptCid || !receipt) throw new Error("Settle produced no receipt");
  return { dealCid, receiptCid, receipt };
};
