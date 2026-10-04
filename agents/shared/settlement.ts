import { randomUUID } from "node:crypto";
import { CantonClient } from "../shared/client.js";
import { TPL, type SelectionPolicy } from "../shared/types.js";
import type { AssetIdSpec } from "../shared/config.js";
import { buildAllocationTransferCommands, type AllocationLeg } from "./token-allocation.js";

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
  sealedQuoteCid: string;
  expectedBidId: string;
  expectedPolicy: SelectionPolicy;
  expiry: string;
  /**
   * Registry allocations that deliver the real tokens for this deal.
   *
   * `Deal.Settle` settles ShadowDesk's own asset contracts, which is the
   * workflow's record of the trade. When these legs are supplied, their
   * transfers are committed in the *same* update as the receipt, so the receipt
   * cannot exist without the tokens having moved and vice versa. Both packages
   * participate in one update, which is what makes that guarantee hold across
   * the package boundary.
   */
  allocations?: {
    legs: AllocationLeg[];
    executor: string;
  };
  /** Admin party recorded as the `issuer` of the security on the receipt. */
  securityIssuer?: string;
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
      // The issuer is the registry admin when the deal is backed by real tokens,
      // so the receipt identifies the actual instrument rather than the synthetic
      // "ShadowDesk" namespace used by the local workflow.
      security: { issuer: spec.securityIssuer ?? "ShadowDesk", symbol: spec.securitySymbol },
      quantity: String(spec.quantity),
      unitPrice: spec.unitPrice.toFixed(2),
      settlementAsset: spec.settlementAsset,
      paymentCid: spec.paymentCid,
      securityCid: spec.securityCid,
      sealedQuote: spec.sealedQuoteCid,
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

  // The receipt and the real token movement are one update. Either the deal
  // settles and the registry transfers land, or nothing happens at all.
  let settleTx;
  if (spec.allocations && spec.allocations.legs.length > 0) {
    const { commands, disclosedContracts, actAs } = await buildAllocationTransferCommands(
      client,
      spec.allocations.legs,
      { executor: spec.allocations.executor },
    );
    settleTx = await client.submitMany(
      [
        {
          ExerciseCommand: {
            templateId: TPL.Deal,
            contractId: dealCid,
            choice: "Settle",
            choiceArgument: {},
          },
        },
        ...commands,
      ],
      // The deal is controlled by buyer and dealer; the registry additionally
      // needs every leg holder to consent.
      Array.from(new Set([...actAs, spec.buyer, spec.dealer])),
      {
        disclosedContracts,
        // This update spans the ShadowDesk package and the registry packages, so
        // pinning a single package would leave the others unresolved.
        packageIdSelectionPreference: null,
      },
      randomUUID(),
    );
  } else {
    settleTx = await client.exercise(
      "Deal",
      dealCid,
      "Settle",
      {},
      [spec.buyer, spec.dealer],
      `cmd-settle-${spec.reference}`,
    );
  }
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

  if (receipt.bidId !== spec.expectedBidId) {
    throw new Error(`Receipt bid ${receipt.bidId} does not match the awarded bid ${spec.expectedBidId}`);
  }
  if (receipt.selectionPolicy !== spec.expectedPolicy) {
    throw new Error(
      `Receipt policy ${receipt.selectionPolicy} does not match the RFQ policy ${spec.expectedPolicy}`,
    );
  }
  if (receipt.sealedQuote !== spec.sealedQuoteCid) {
    throw new Error("Receipt does not reference the awarded sealed quote");
  }

  return { dealCid, receiptCid, receipt };
};
