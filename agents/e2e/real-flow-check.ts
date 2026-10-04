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

  // Registry allocations reserve the real holdings for the whole round, so the
  // balances cannot be spent by anything else while the workflow is running.
  const settlementRef = `SHADOWDESK-E2E-${Date.now()}`;
  const executor = buyerParty;
  await createDvpLegs(ledger, {
    executor,
    settlementRef,
    security: {
      instrument: delivered,
      sender: dealerParty,
      receiver: buyerParty,
      amount: quantity,
      legId: "security",
    },
    payment: {
      instrument: payment,
      sender: buyerParty,
      receiver: dealerParty,
      amount: payAmount,
      legId: "payment",
    },
  });
  console.log(`[registry] both legs reserved under ${settlementRef}`);

  // --- venue workflow, against the deployed package ---
  const buyer = new BuyerAgent(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);
  // The hint is resolved to a party by convention on DevNet:
  // "dealerA" -> SHADOWDESK_DEALER_A_PARTY.
  const dealer = new DealerAgent(
    PARTICIPANTS.participant1.jsonApi,
    PARTICIPANTS.participant1.name,
    "dealerA",
    fixedPricePolicy(unitPrice),
  );
  await buyer.provision();
  await dealer.provision();

  // `Deal.Settle` asserts the locked security quantity equals the deal quantity
  // exactly, while it only requires the cash to cover it, so the inventory is
  // created at precisely the deal size and the cash at a surplus.
  const cashCid = await buyer.ensureCash(payment, Number(payUnits * 2n));
  const inventoryCid = await dealer.ensureInventory(delivered, Number(securityUnits));
  registerSettlementIntent({
    dealerParty,
    securitySymbol: delivered.id,
    securityCid: inventoryCid,
    quantity: Number(securityUnits),
    participant: PARTICIPANTS.participant1.name,
  });

  const overrides: RfqOverrides = {
    amount: Number(securityUnits),
    maxPrice: unitPrice,
    assetToBuy: delivered,
    settlementAsset: payment,
  };
  const spec = defaultRfq(1, [dealerParty], overrides);
  spec.mandate = { riskOfficer, maxAmount: Number(securityUnits) };

  console.log(`[buyer] RFQ ${spec.reference}: ${securityUnits} ${delivered.id} max@${unitPrice}`);
  const rfqCid = await buyer.createRfq(spec);

  const observed = await dealer.observeRfqs(60_000);
  const mine = observed.find((r) => r.cid === rfqCid) ?? observed[0];
  if (!mine) throw new Error("dealer did not observe the RFQ");
  const propCid = await dealer.quoteOn(mine.cid, mine.arg);
  if (!propCid) throw new Error("dealer did not quote");
  console.log(`[dealer] quoted, proposal=${propCid.slice(0, 16)}...`);

  const proposals = await buyer.collectProposals(rfqCid, 60_000);
  const winner = selectWinner(proposals, spec.maxPrice);
  if (!winner) throw new Error("no proposal within maxPrice");
  console.log(`[venue] winner dealer=${winner.dealer.split("::")[0]} price=${winner.offeredPrice}`);

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
  const legs = new Map<string, any>();
  for (const [party, instrument] of [
    [dealerParty, delivered],
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
    dealer: await total(dealerParty, delivered),
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
    securityCid: inventoryCid,
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
    dealer: await total(dealerParty, delivered),
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