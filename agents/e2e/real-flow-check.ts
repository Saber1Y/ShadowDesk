import { BuyerAgent, selectWinner, defaultRfq, SELECTION_POLICY, type RfqOverrides } from "../buyer/buyer.js";
import { DealerAgent, fixedPricePolicy } from "../dealer/dealer.js";
import { CantonClient, envValue } from "../shared/client.js";
import { PARTICIPANTS, settlementEnvironment, type TokenInstrument } from "../shared/config.js";
import { settleDeal, registerSettlementIntent } from "../shared/settlement.js";
import {
  cancelDanglingAllocations,
  formatTokenAmount,
  createDvpLegs,
  listHoldings,
  listAllocationLegs,
} from "../shared/token-allocation.js";

/**
 * End-to-end ShadowDesk flow on DevNet, settled in real registry tokens.
 *
 * The whole venue workflow runs against the deployed package: mandate, RFQ,
 * sealed quotes, deterministic award. The settlement then commits, in ONE Ledger
 * API update, both the `Deal.Settle` that writes the on-chain receipt and the two
 * registry `Allocation_ExecuteTransfer` commands that move real tokens.
 *
 * That single update is the product claim: the receipt cannot exist unless the
 * tokens moved, and the tokens cannot move unless the receipt was written. Both
 * sides come from packages already installed on this participant, so no package
 * upload is required.
 */

const env = settlementEnvironment();
if (env.network !== "devnet") {
  throw new Error("this check needs SHADOWDESK_NETWORK=devnet; run it via scripts/env/with-devnet-auth.sh");
}

const required = (name: string): string => {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const num = (name: string, fallback: number): number => {
  const raw = envValue(name);
  return raw === undefined ? fallback : Number(raw);
};

const main = async (): Promise<void> => {
  const { beth, cbtc } = env;
  const pick = (name: string, fallback: TokenInstrument): TokenInstrument =>
    (envValue(name) ?? "BETH").toUpperCase() === "CBTC" ? cbtc : fallback;

  const delivered = pick("SHADOWDESK_REAL_DELIVERED_INSTRUMENT", beth);
  const payment = pick("SHADOWDESK_REAL_PAYMENT_INSTRUMENT", beth);

  const buyerParty = required("SHADOWDESK_BUYER_PARTY");
  const dealerParty = required("SHADOWDESK_DEALER_A_PARTY");
  const riskOfficer = required("SHADOWDESK_RISK_OFFICER_PARTY");

  // Quantities are given in base units, as everywhere else in this project and in
  // the dashboard's request form. The registry, by contrast, wants a fixed-point
  // decimal string, so the conversion happens here at the boundary.
  const securityUnits = BigInt(Math.round(num("SHADOWDESK_E2E_QUANTITY", 0.03 * 10 ** delivered.decimals)));
  const unitPrice = num("SHADOWDESK_E2E_UNIT_PRICE", 1);
  const quantity = formatTokenAmount(securityUnits, delivered.decimals);
  const payUnits = BigInt(Math.round(Number(quantity) * unitPrice * 10 ** payment.decimals));
  const payAmount = formatTokenAmount(payUnits, payment.decimals);

  const ledger = new CantonClient(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);
  const total = async (party: string, instrument: TokenInstrument): Promise<number> =>
    (await listHoldings(ledger, party, instrument)).reduce((s, h) => s + Number(h.amount), 0);

  console.log(`=== ShadowDesk end-to-end on DevNet (real ${delivered.id} / ${payment.id}) ===`);
  console.log(`delivering ${quantity} ${delivered.id} for ${payAmount} ${payment.id} @ ${unitPrice}\n`);

  // An earlier aborted round leaves its holdings reserved, which would make this
  // one fail with "unexpected holding lock state". Release anything still pending
  // under our own prefix so the flow starts from a spendable balance.
  for (const instrument of [delivered, payment]) {
    const released = await cancelDanglingAllocations(
      ledger,
      [dealerParty, buyerParty],
      "SHADOWDESK-E2E-",
      { registryUrl: instrument.registryUrl, admin: instrument.issuer },
    );
    if (released.length > 0) {
      console.log(`[registry] released ${released.length} reservation(s) left by an earlier ${instrument.id} round`);
    }
  }

  const settlementRef = `SHADOWDESK-E2E-${Date.now()}`;
  const executor = buyerParty;

  // --- venue workflow, against the deployed package ---
  const buyer = new BuyerAgent(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);
  // The hint is resolved to a party by convention on DevNet:
  // "dealerA" -> SHADOWDESK_DEALER_A_PARTY.
  // Two dealers compete so the award exercises the selection policy rather than
  // a single bid. Dealer B quotes one notch dearer, so the deterministic winner
  // must be dealer A.
  const dealerPartyB = required("SHADOWDESK_DEALER_B_PARTY");
  const dealerA = new DealerAgent(
    PARTICIPANTS.participant1.jsonApi,
    PARTICIPANTS.participant1.name,
    "dealerA",
    fixedPricePolicy(unitPrice),
  );
  const dealerB = new DealerAgent(
    PARTICIPANTS.participant1.jsonApi,
    PARTICIPANTS.participant1.name,
    "dealerB",
    fixedPricePolicy(Number((unitPrice * 1.1).toFixed(10))),
  );
  await buyer.provision();
  await dealerA.provision();
  await dealerB.provision();

  // `Deal.Settle` asserts the locked security quantity equals the deal quantity
  // exactly, while it only requires the cash to cover it, so the inventory is
  // created at precisely the deal size and the cash at a surplus.
  const cashCid = await buyer.ensureCash(payment, Number(payUnits * 2n));
  const inventoryA = await dealerA.ensureInventory(delivered, Number(securityUnits));
  const inventoryB = await dealerB.ensureInventory(delivered, Number(securityUnits));
  const inventoryByParty = new Map<string, string>([
    [dealerParty, inventoryA],
    [dealerPartyB, inventoryB],
  ]);
  registerSettlementIntent({
    dealerParty,
    securitySymbol: delivered.id,
    securityCid: inventoryA,
    quantity: Number(securityUnits),
    participant: PARTICIPANTS.participant1.name,
  });

  const overrides: RfqOverrides = {
    amount: Number(securityUnits),
    maxPrice: unitPrice,
    assetToBuy: delivered,
    settlementAsset: payment,
  };
  const spec = defaultRfq(2, [dealerParty, dealerPartyB], overrides);
  spec.mandate = { riskOfficer, maxAmount: Number(securityUnits) };

  console.log(`[buyer] RFQ ${spec.reference}: ${securityUnits} ${delivered.id} max@${unitPrice}`);
  const rfqCid = await buyer.createRfq(spec);

  for (const agent of [dealerA, dealerB]) {
    const observed = await agent.observeRfqs(60_000);
    const mine = observed.find((r) => r.cid === rfqCid) ?? observed[0];
    if (!mine) throw new Error(`${agent.dealerPartyHint} did not observe the RFQ`);
    const propCid = await agent.quoteOn(mine.cid, mine.arg);
    if (!propCid) throw new Error(`${agent.dealerPartyHint} did not quote`);
    console.log(`[${agent.dealerPartyHint}] quoted, proposal=${propCid.slice(0, 16)}...`);
  }

  const proposals = await buyer.collectProposals(rfqCid, 60_000);
  if (proposals.length < 2) {
    throw new Error(`expected 2 competing proposals, collected ${proposals.length}`);
  }
  // The award must follow the declared policy, not happen to look right: dealer A
  // quotes the unit price and dealer B 10% above it, so the cheapest must win.
  const cheapest = [...proposals].sort(
    (a, b) => Number(a.offeredPrice) - Number(b.offeredPrice) || a.bidId.localeCompare(b.bidId),
  )[0];
  const winner = selectWinner(proposals, spec.maxPrice);
  if (!winner) throw new Error("no proposal within maxPrice");
  if (winner.bidId !== cheapest.bidId) {
    throw new Error(
      `${SELECTION_POLICY} selected ${winner.bidId} at ${winner.offeredPrice} over the cheapest ${cheapest.bidId} at ${cheapest.offeredPrice}`,
    );
  }
  if (winner.dealer !== dealerParty) {
    throw new Error(`expected dealerA to win on price, got ${winner.dealer}`);
  }
  // Best-execution evidence. The ledger cannot enumerate proposals, so it cannot
  // verify that the buyer took the cheapest; what it can do is record every bid
  // immutably, which makes the buyer's choice checkable after the fact against
  // the bids it published. Ranking them here states the claim explicitly.
  const ranked = [...proposals].sort(
    (a, b) => Number(a.offeredPrice) - Number(b.offeredPrice) || a.bidId.localeCompare(b.bidId),
  );
  for (const [i, bid] of ranked.entries()) {
    console.log(
      `  rank ${i + 1} ${bid.dealer.split("::")[0]} ${bid.offeredPrice} ${bid.bidId}${bid.bidId === winner.bidId ? "  <- awarded" : ""}`,
    );
  }
  const runnerUp = ranked.find((b) => b.bidId !== winner.bidId);
  const saving = runnerUp ? Number(runnerUp.offeredPrice) - Number(winner.offeredPrice) : Number(winner.offeredPrice);
  console.log(
    `[venue] ${SELECTION_POLICY} awards dealerA at ${winner.offeredPrice}; ${ranked.length} bids published, best saving ${saving.toFixed(10)} against ${runnerUp?.offeredPrice ?? "n/a"}`,
  );

  const sealedTx = await buyer.client.exercise(
    "QuoteProposal",
    winner._cid,
    "AcceptProposal",
    { maxPrice: String(spec.maxPrice) },
    [buyerParty],
    `cmd-accept-${winner.bidId}`,
  );
  const sealedEvent = (sealedTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Rfq:SealedQuote"));
  if (!sealedEvent) throw new Error("AcceptProposal produced no sealed quote");
  const sealedCid: string = sealedEvent.contractId;
  if (sealedEvent.createArgument.selectionPolicy !== SELECTION_POLICY) {
    throw new Error(`award policy ${sealedEvent.createArgument.selectionPolicy} != ${SELECTION_POLICY}`);
  }
  console.log(`[venue] sealed under policy=${SELECTION_POLICY}; no other dealer can see it`);

  // --- settlement: receipt and real tokens in one update ---
  // The registry legs are reserved only now that the counterparty is known: the
  // losing dealer never delivers anything, so reserving before the award would
  // lock a second dealer's balance for a trade that never happens.
  const dealerPartyLeg = winner.dealer;
  await createDvpLegs(ledger, {
    executor,
    settlementRef,
    security: {
      instrument: delivered,
      sender: dealerPartyLeg,
      receiver: buyerParty,
      amount: quantity,
      legId: "security",
    },
    payment: {
      instrument: payment,
      sender: buyerParty,
      receiver: dealerPartyLeg,
      amount: payAmount,
      legId: "payment",
    },
  });
  console.log(`[registry] both legs reserved under ${settlementRef} for the awarded dealer`);

  const legs = new Map<string, any>();
  for (const [party, instrument] of [
    [dealerPartyLeg, delivered],
    [buyerParty, payment],
  ] as const) {
    for (const leg of await listAllocationLegs(ledger, party, settlementRef, {
      registryUrl: instrument.registryUrl,
    })) {
      legs.set(leg.contractId, leg);
    }
  }
  if (legs.size === 0) throw new Error("no allocation legs resolved before settlement");

  const balancesBefore = {
    dealer: await total(dealerPartyLeg, delivered),
    buyer: await total(buyerParty, delivered),
  };

  const { receiptCid, receipt } = await settleDeal(buyer.client, {
    reference: `DEAL-${spec.reference}`,
    buyer: buyerParty,
    dealer: dealerParty,
    securitySymbol: delivered.id,
    quantity: Number(securityUnits),
    unitPrice: Number(winner.offeredPrice),
    paymentCid: cashCid,
    securityCid: inventoryByParty.get(dealerPartyLeg)!,
    // Daml's `AssetId` is `{ issuer, symbol }`; the registry instrument also
    // carries transport fields that must not be sent to the ledger.
    settlementAsset: { issuer: payment.issuer, symbol: payment.id },
    sealedQuoteCid: sealedCid,
    expectedBidId: winner.bidId,
    expectedPolicy: SELECTION_POLICY,
    expiry: spec.expiry,
    securityIssuer: delivered.issuer,
    allocations: { legs: [...legs.values()], executor },
  });

  console.log(`\n[settle] ONE update: receipt=${receiptCid.slice(0, 16)}... + ${legs.size} registry legs`);
  console.log(`[settle] receipt security=${JSON.stringify((receipt as any).security)}`);

  const balancesAfter = {
    dealer: await total(dealerPartyLeg, delivered),
    buyer: await total(buyerParty, delivered),
  };
  console.log(`[settle] dealer ${delivered.id} ${balancesBefore.dealer} -> ${balancesAfter.dealer}`);
  console.log(`[settle] buyer  ${delivered.id} ${balancesBefore.buyer} -> ${balancesAfter.buyer}`);

  console.log(`\nE2E REAL FLOW OK ref=${settlementRef} receipt=${receiptCid}`);
};

main().catch((e) => {
  console.error("\nE2E REAL FLOW FAILED:", e);
  process.exit(1);
});