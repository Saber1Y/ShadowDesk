import { CantonClient, envValue } from "../shared/client.js";
import { TPL, type BlockTradeRFQ, type Asset } from "../shared/types.js";
import { CTBILL, type AssetIdSpec } from "../shared/config.js";

export type PricingPolicy = (rfq: BlockTradeRFQ, dealerParty: string) => string | null;

export interface PricingConfig {
  maxMarkup: number;
  offset: number;
}

export const baseBidPolicy = (cfg: PricingConfig): PricingPolicy => {
  return (rfq: BlockTradeRFQ, dealerParty: string): string | null => {
    const maxPrice = Number(rfq.maxPrice);
    const base = 98.0 + cfg.offset;
    const price = Math.min(base, maxPrice);
    if (price > maxPrice + cfg.maxMarkup) return null;
    return price.toFixed(2);
  };
};

export const fixedPricePolicy = (price: number): PricingPolicy => {
  return () => price.toFixed(2);
};

export class DealerAgent {
  readonly client: CantonClient;
  readonly dealerPartyHint: string;
  dealerParty: string | null = null;
  readonly pricing: PricingPolicy;

  constructor(baseUrl: string, participantName: string, dealerPartyHint: string, policy: PricingPolicy) {
    this.dealerPartyHint = dealerPartyHint;
    const userId = envValue("SHADOWDESK_LEDGER_USER_ID") ?? `shadowdesk-dealer-${dealerPartyHint}`;
    this.client = new CantonClient(baseUrl, participantName, userId);
    this.pricing = policy;
  }

  async provision(): Promise<string> {
    this.dealerParty = await this.client.ensureParty(this.dealerPartyHint);
    return this.dealerParty;
  }

  async ensureInventory(assetSpec: AssetIdSpec, quantity: number): Promise<string> {
    if (!this.dealerParty) throw new Error("provision() first");
    const end = await this.client.ledgerEnd();
    const assets = await this.client.queryActiveContracts(
      this.dealerParty,
      ["ShadowDesk.Asset:Asset"],
      end,
    );
    const inv = assets.find((a) => {
      const rec = a as unknown as { createArgument: Asset };
      return rec.createArgument.id.symbol === assetSpec.symbol &&
        rec.createArgument.holder === this.dealerParty &&
        Number(rec.createArgument.quantity) === quantity;
    });
    if (inv) return inv.contractId;
    const tx = await this.client.create(
      "Asset",
      {
        holder: this.dealerParty,
        id: { issuer: assetSpec.issuer, symbol: assetSpec.symbol },
        quantity: String(quantity),
        reference: `SEED-DEALER-${assetSpec.symbol}`,
      },
      [this.dealerParty],
      `cmd-dealer-seed-${assetSpec.symbol}-${Date.now()}`,
    );
    for (const e of tx.transaction.events) {
      const created = (e as any).CreatedEvent;
      if (created && created.templateId.endsWith(":ShadowDesk.Asset:Asset")) return created.contractId;
    }
    throw new Error("inventory create produced no contract");
  }

  async observeRfqs(timeoutMs = 90_000): Promise<{ cid: string; arg: BlockTradeRFQ }[]> {
    if (!this.dealerParty) throw new Error("provision() first");
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const end = await this.client.ledgerEnd();
      const rfqs = await this.client.queryActiveContracts(
        this.dealerParty,
        ["ShadowDesk.Rfq:BlockTradeRFQ"],
        end,
      );
      const mine = rfqs.filter((r) => {
        const arg = (r as unknown as { createArgument: BlockTradeRFQ }).createArgument;
        return arg.dealers.includes(this.dealerParty!);
      });
      if (mine.length > 0) {
        return mine.map((r) => ({
          cid: r.contractId,
          arg: (r as unknown as { createArgument: BlockTradeRFQ }).createArgument,
        }));
      }
      await new Promise((res) => setTimeout(res, 1000));
    }
    throw new Error(`Dealer ${this.dealerPartyHint} saw no RFQ within ${timeoutMs}ms`);
  }

  private async alreadyQuoted(rfqCid: string): Promise<boolean> {
    if (!this.dealerParty) throw new Error("provision() first");
    const end = await this.client.ledgerEnd();
    const props = await this.client.queryActiveContracts(
      this.dealerParty,
      ["ShadowDesk.Rfq:QuoteProposal", "ShadowDesk.Rfq:SealedQuote"],
      end,
    );
    return props.some((p) => {
      const arg = (p as unknown as { createArgument: QuoteProposalLike }).createArgument;
      return arg.rfq === rfqCid && arg.dealer === this.dealerParty;
    });
  }

  async quoteOn(rfqCid: string, rfq: BlockTradeRFQ): Promise<string | null> {
    if (!this.dealerParty) throw new Error("provision() first");
    if (await this.alreadyQuoted(rfqCid)) {
      return null;
    }
    const price = this.pricing(rfq, this.dealerParty);
    if (price === null) return null;
    const tx = await this.client.exercise(
      "BlockTradeRFQ",
      rfqCid,
      "SubmitQuoteProposal",
      {
        dealer: this.dealerParty,
        offeredPrice: price,
        bidId: `BID-${this.dealerPartyHint.toUpperCase()}-${rfq.reference}`,
      },
      [this.dealerParty],
      `cmd-quote-${this.dealerPartyHint}-${rfq.reference}`,
    );
    for (const e of tx.transaction.events) {
      const created = (e as any).CreatedEvent;
      if (created && created.templateId.endsWith(":ShadowDesk.Rfq:QuoteProposal")) return created.contractId;
    }
    throw new Error("quote create produced no proposal");
  }
}

type QuoteProposalLike = {
  rfq: string;
  dealer: string;
};
