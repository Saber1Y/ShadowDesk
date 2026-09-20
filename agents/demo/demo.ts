import { BuyerAgent, selectWinner, defaultRfq, type RfqOverrides } from "../buyer/buyer.js";
import { DealerAgent, fixedPricePolicy } from "../dealer/dealer.js";
import { settleDeal, registerSettlementIntent, resolveSettlementIntent } from "../shared/settlement.js";
import { PARTICIPANTS, CUSDC, CTBILL, type AssetIdSpec } from "../shared/config.js";

const P1 = PARTICIPANTS.participant1;
const P2 = PARTICIPANTS.participant2;

const dealerSpecs = [
  { hint: "dealerA", price: 100.2, participant: P1 },
  { hint: "dealerB", price: 100.5, participant: P2 },
];

const numberFromEnv = (name: string): number | undefined => {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
};

const assetFromEnv = (name: string, fallback: AssetIdSpec): AssetIdSpec => {
  const symbol = process.env[name] ?? fallback.symbol;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(symbol)) {
    throw new Error(`${name} must be 1-32 letters, numbers, dots, dashes, or underscores`);
  }
  return { issuer: "ShadowDesk", symbol };
};

const main = async () => {
  console.log("=== ShadowDesk RFQ demo across two participants ===");

  const buyer = new BuyerAgent(P1.jsonApi, P1.name);
  const buyerParty = await buyer.provision();
  console.log(`[buyer] party=${buyerParty}`);

  const assetToBuy = assetFromEnv("SHADOWDESK_ASSET_TO_BUY", CTBILL);
  const settlementAsset = assetFromEnv("SHADOWDESK_SETTLEMENT_ASSET", CUSDC);
  if (assetToBuy.symbol === settlementAsset.symbol) {
    throw new Error("The security and settlement asset must be different.");
  }
  const overrides: RfqOverrides = {
    amount: numberFromEnv("SHADOWDESK_AMOUNT"),
    maxPrice: numberFromEnv("SHADOWDESK_MAX_PRICE"),
    assetToBuy,
    settlementAsset,
  };

  const dealers = await Promise.all(
    dealerSpecs.map(async ({ hint, price, participant }) => {
      const agent = new DealerAgent(participant.jsonApi, participant.name, hint, fixedPricePolicy(price));
      const party = await agent.provision();
      const invCid = await agent.ensureInventory(assetToBuy, overrides.amount ?? 1_000_000);
      registerSettlementIntent({
        dealerParty: party,
        securitySymbol: assetToBuy.symbol,
        securityCid: invCid,
        quantity: overrides.amount ?? 1_000_000,
        participant: participant.name,
      });
      console.log(`[dealer ${hint}] party=${party} inventory=${invCid.slice(0, 16)}...`);
      return agent;
    }),
  );

  const spec = defaultRfq(dealers.length, dealers.map((d) => d.dealerParty!), overrides);
  const cashCid = await buyer.ensureCash(settlementAsset, Math.ceil(spec.amount * spec.maxPrice * 2));
  console.log(`[buyer] cash=${cashCid.slice(0, 16)}...`);

  console.log(`[buyer] creating RFQ ${spec.reference}: ${spec.amount} ${spec.assetToBuy.symbol} max@${spec.maxPrice}`);
  const rfqCid = await buyer.createRfq(spec);
  console.log(`[buyer] rfq=${rfqCid.slice(0, 16)}...`);

  const quoteResults = await Promise.all(
    dealers.map(async (agent, idx) => {
      const rfqs = await agent.observeRfqs(60_000);
      const mine = rfqs.find((r) => r.cid === rfqCid) ?? rfqs[0];
      const propCid = await agent.quoteOn(mine.cid, mine.arg);
      console.log(
        `[dealer ${agent.dealerPartyHint}] quoted price=${dealerSpecs[idx].price} => ${propCid ? propCid.slice(0, 16) : "skip"}`,
      );
      return propCid;
    }),
  );
  if (quoteResults.some((c) => !c)) {
    console.error("A dealer failed to submit a fresh quote (already quoted before?)");
  }

  const proposals = await buyer.collectProposals(rfqCid, 60_000);
  console.log(`\n[venue] ${proposals.length} proposals collected`);
  proposals.forEach((p) => {
    console.log(`  proposal dealer=${p.dealer.split("::")[0]} price=${p.offeredPrice} bidId=${p.bidId}`);
  });

  const winner = selectWinner(proposals, spec.maxPrice);
  if (!winner) {
    await buyer.client.exercise("BlockTradeRFQ", rfqCid, "CloseRfq", {}, [buyerParty], `cmd-close-${spec.reference}`);
    throw new Error("No proposal was within maxPrice; venue closes the RFQ.");
  }
  console.log(`[venue] deterministic winner: dealer=${winner.dealer.split("::")[0]} price=${winner.offeredPrice}`);

  const sealedTx = await buyer.client.exercise(
    "QuoteProposal",
    winner._cid,
    "AcceptProposal",
    { maxPrice: String(spec.maxPrice) },
    [buyerParty],
    `cmd-accept-${winner.bidId}`,
  );
  (sealedTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Rfq:SealedQuote"));
  console.log(`[venue] sealed quote for winner (no other dealer can see it)`);

  // Privacy guard: losing dealer (cross-participant) must not see winner's sealed quote
  const losingDealer = dealers.find((d) => d.dealerParty !== winner.dealer)!;
  const lEnd = await losingDealer.client.ledgerEnd();
  const losingView = await losingDealer.client.queryActiveContracts(
    losingDealer.dealerParty!,
    ["ShadowDesk.Rfq:SealedQuote", "ShadowDesk.Rfq:QuoteProposal"],
    lEnd,
  );
  const seenSealed = losingView.filter((c: any) => c.createArgument?.dealer === winner.dealer).length;
  console.log(
    `[venue] losing dealer ${losingDealer.dealerPartyHint} sees ${seenSealed} of winner's quotes (expect 0)`,
  );
  if (seenSealed !== 0) {
    throw new Error("PRIVACY VIOLATION: losing dealer can see the winning dealer's quote");
  }

  const winnerDealer = dealers.find((d) => d.dealerParty === winner.dealer)!;
  const intent = resolveSettlementIntent(winner.dealer);

  const { receiptCid, receipt } = await settleDeal(buyer.client, {
    reference: `DEAL-${spec.reference}`,
    buyer: buyerParty,
    dealer: winner.dealer,
    securitySymbol: spec.assetToBuy.symbol,
    quantity: spec.amount,
    unitPrice: Number(winner.offeredPrice),
    paymentCid: cashCid,
    securityCid: intent.securityCid,
    settlementAsset: spec.settlementAsset,
    expiry: spec.expiry,
  });
  console.log(`[venue] DvP settled on ${P1.name}: receipt=${receiptCid.slice(0, 16)}... value=${receipt.totalValue}`);

  const end = await buyer.client.ledgerEnd();
  const buyerAssets = await buyer.client.queryActiveContracts(buyerParty, ["ShadowDesk.Asset:Asset"], end);
  const buyerBonds = buyerAssets.filter((a: any) => a.createArgument?.id?.symbol === assetToBuy.symbol);
  console.log(
    `[buyer] holds ${buyerBonds.length} × ${assetToBuy.symbol} (qty ${buyerBonds[0]?.createArgument.quantity ?? "0"})`,
  );

  const dEnd = await winnerDealer.client.ledgerEnd();
  const dealerAssets = await winnerDealer.client.queryActiveContracts(winnerDealer.dealerParty!, ["ShadowDesk.Asset:Asset"], dEnd);
  const dealerCash = dealerAssets.filter((a: any) => a.createArgument?.id?.symbol === settlementAsset.symbol);
  console.log(
    `[dealer ${winnerDealer.dealerPartyHint}] holds ${dealerCash.length} × ${settlementAsset.symbol} (qty ${dealerCash[0]?.createArgument.quantity ?? "0"})`,
  );

  console.log("\n=== DEMO COMPLETE: atomic DvP settled, cross-participant quote secrecy intact ===");
};

main().catch((err) => {
  console.error("DEMO FAILED:", err);
  process.exit(1);
});
