import { CantonClient, envValue } from "../shared/client.js";
import { TPL, type BlockTradeRFQ, type QuoteProposal, type Asset } from "../shared/types.js";
import { CTBILL, CUSDC, type AssetIdSpec } from "../shared/config.js";

export interface RfqSpec {
  reference: string;
  assetToBuy: AssetIdSpec;
  settlementAsset: AssetIdSpec;
  amount: number;
  maxPrice: number;
  dealers: string[];
  expiry: string;
}

export interface RfqOverrides {
  amount?: number;
  maxPrice?: number;
  assetToBuy?: AssetIdSpec;
  settlementAsset?: AssetIdSpec;
}

export const defaultRfq = (dealerCount: number, dealerParties: string[], overrides: RfqOverrides = {}): RfqSpec => {
  const expiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  return {
    reference: `RFQ-DEMO-${Date.now()}`,
    assetToBuy: overrides.assetToBuy ?? CTBILL,
    settlementAsset: overrides.settlementAsset ?? CUSDC,
    amount: overrides.amount ?? 1_000_000,
    maxPrice: overrides.maxPrice ?? 101.0,
    dealers: dealerParties,
    expiry,
  };
};

export type QuoteReader = {
  rfq: string;
  buyer: string;
  dealer: string;
  amount: string;
  offeredPrice: string;
  bidId: string;
};

export const selectWinner = <T extends QuoteReader>(quotes: T[], maxPrice: number): T | null => {
  const eligible = quotes.filter((q) => Number(q.offeredPrice) <= maxPrice);
  if (eligible.length === 0) return null;
  eligible.sort((a, b) => {
    if (Number(a.offeredPrice) !== Number(b.offeredPrice)) {
      return Number(a.offeredPrice) - Number(b.offeredPrice);
    }
    return a.bidId.localeCompare(b.bidId);
  });
  return eligible[0];
};

export class BuyerAgent {
  readonly client: CantonClient;
  buyerParty: string | null = null;

  constructor(baseUrl: string, participantName: string) {
    this.client = new CantonClient(baseUrl, participantName, envValue("SHADOWDESK_LEDGER_USER_ID") ?? "shadowdesk-buyer");
  }

  async provision(): Promise<string> {
    this.buyerParty = await this.client.ensureParty("buyer");
    return this.buyerParty;
  }

  async ensureCash(cashSpec: AssetIdSpec, quantity: number): Promise<string> {
    if (!this.buyerParty) throw new Error("provision() first");
    const end = await this.client.ledgerEnd();
    const assets = await this.client.queryActiveContracts(
      this.buyerParty,
      ["ShadowDesk.Asset:Asset"],
      end,
    );
    const cash = assets.find((a) => {
      const rec = a as unknown as { createArgument: Asset };
      return rec.createArgument.id.symbol === cashSpec.symbol &&
        rec.createArgument.holder === this.buyerParty &&
        Number(rec.createArgument.quantity) >= quantity;
    });
    if (cash) return cash.contractId;
    const tx = await this.client.create(
      "Asset",
      {
        holder: this.buyerParty,
        id: { issuer: cashSpec.issuer, symbol: cashSpec.symbol },
        quantity: String(quantity),
        reference: "SEED-BUYER-CASH",
      },
      [this.buyerParty],
      `cmd-buyer-seed-cash-${Date.now()}`,
    );
    for (const e of tx.transaction.events) {
      const created = (e as any).CreatedEvent;
      if (created && created.templateId.endsWith(":ShadowDesk.Asset:Asset")) return created.contractId;
    }
    throw new Error("cash asset create produced no contract");
  }

  async createRfq(spec: RfqSpec): Promise<string> {
    if (!this.buyerParty) throw new Error("provision() first");
    const tx = await this.client.create(
      "BlockTradeRFQ",
      {
        buyer: this.buyerParty,
        dealers: spec.dealers,
        assetToBuy: spec.assetToBuy.symbol,
        settlementAsset: spec.settlementAsset.symbol,
        amount: String(spec.amount),
        maxPrice: String(spec.maxPrice),
        reference: spec.reference,
        expiry: spec.expiry,
      },
      [this.buyerParty],
      `cmd-create-rfq-${spec.reference}`,
    );
    for (const e of tx.transaction.events) {
      const created = (e as any).CreatedEvent;
      if (created && created.templateId.endsWith(":ShadowDesk.Rfq:BlockTradeRFQ")) return created.contractId;
    }
    throw new Error("RFQ create produced no contract");
  }

  async collectProposals(rfqCid: string, timeoutMs = 90_000): Promise<(QuoteReader & { _cid: string })[]> {
    const reader = await this.client.waitForCondition(async () => {
      const end = await this.client.ledgerEnd();
      const props = await this.client.queryActiveContracts(this.buyerParty!, ["ShadowDesk.Rfq:QuoteProposal"], end);
      return props.length > 0;
    }, timeoutMs, 1000, `proposals for ${rfqCid}`);
    void reader;
    const end = await this.client.ledgerEnd();
    const props = await this.client.queryActiveContracts(this.buyerParty!, ["ShadowDesk.Rfq:QuoteProposal"], end);
    return props
      .map((p) => {
        const arg = (p as unknown as { createArgument: QuoteProposal }).createArgument;
        return {
          rfq: arg.rfq,
          buyer: arg.buyer,
          dealer: arg.dealer,
          amount: String(arg.amount),
          offeredPrice: String(arg.offeredPrice),
          bidId: arg.bidId,
          expiry: String(arg.expiry),
          _cid: p.contractId,
        } as QuoteReader & { _cid: string };
      })
      .filter((q) => q.rfq === rfqCid)
      .sort((a, b) => (a._cid < b._cid ? -1 : 1));
  }

  async runRound(spec: RfqSpec, timeoutMs = 90_000): Promise<{ rfqCid: string; winner?: QuoteReader & { _cid: string } }> {
    if (!this.buyerParty) throw new Error("provision() first");
    const rfqCid = await this.createRfq(spec);
    const proposals = await this.collectProposals(rfqCid, timeoutMs);
    const winner = selectWinner(proposals, spec.maxPrice) as (QuoteReader & { _cid: string }) | null;
    if (!winner) {
      return { rfqCid };
    }
    const sealedTx = await this.client.exercise(
      "QuoteProposal",
      winner._cid,
      "AcceptProposal",
      { maxPrice: String(spec.maxPrice) },
      [this.buyerParty],
      `cmd-accept-${winner.bidId}`,
    );
    let sealedCid: string | null = null;
    for (const e of sealedTx.transaction.events) {
      const created = (e as any).CreatedEvent;
      if (created && created.templateId.endsWith(":ShadowDesk.Rfq:SealedQuote")) sealedCid = created.contractId;
    }
    return { rfqCid, winner: { ...winner, _cid: winner._cid, sealedCid: sealedCid ?? undefined } as any };
  }
}
