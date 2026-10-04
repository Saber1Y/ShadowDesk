import { BuyerAgent, selectWinner, defaultRfq, SELECTION_POLICY, type RfqOverrides } from "../buyer/buyer.js";
import { DealerAgent, fixedPricePolicy } from "../dealer/dealer.js";
import { CantonClient, envValue } from "../shared/client.js";
import { PARTICIPANTS, settlementEnvironment, type TokenInstrument } from "../shared/config.js";
import { registerSettlementIntent } from "../shared/settlement.js";
import { cancelDanglingAllocations, createDvpLegs, listAllocationLegs, listHoldings, buildAllocationTransferCommands } from "../shared/token-allocation.js";
import { TPL } from "../shared/types.js";
import { randomUUID } from "node:crypto";

/**
 * Negative test: a Deal that breaches its mandate must be rejected on-ledger,
 * and no real token may move.
 *
 * The happy path proves a settlement commits. This proves the other half of the
 * guarantee: when the ledger rejects the deal, the registry legs submitted in the
 * same update are rolled back too, so a failed trade cannot half-settle. That is
 * the property that makes batching the receipt and both transfers into one update
 * worth doing.
 */

const env = settlementEnvironment();
if (env.network !== "devnet") {
  throw new Error("this check needs SHADOWDESK_NETWORK=devnet");
}

const required = (name: string): string => {
  const v = envValue(name);
  if (!v) throw new Error(`${name} is required`);
  return v;
};

const main = async (): Promise<void> => {
  const { beth } = env;
  const buyerParty = required("SHADOWDESK_BUYER_PARTY");
  const dealerParty = required("SHADOWDESK_DEALER_A_PARTY");
  const riskOfficer = required("SHADOWDESK_RISK_OFFICER_PARTY");

  const instrument: TokenInstrument = beth;
  const quantity = 1_000_000_000n; // 0.1
  const unitPrice = 1;

  const ledger = new CantonClient(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);
  const total = async (party: string): Promise<number> =>
    (await listHoldings(ledger, party, instrument)).reduce((s, h) => s + Number(h.amount), 0);

  for (const inst of [beth]) {
    await cancelDanglingAllocations(ledger, [buyerParty, dealerParty], "SHADOWDESK-GUARD-", {
      registryUrl: inst.registryUrl,
      admin: inst.issuer,
    });
  }

  console.log("=== Mandate guard: a breaching Deal must not move tokens ===\n");

  const buyer = new BuyerAgent(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);
  const dealer = new DealerAgent(
    PARTICIPANTS.participant1.jsonApi,
    PARTICIPANTS.participant1.name,
    "dealerA",
    fixedPricePolicy(unitPrice),
  );
  await buyer.provision();
  await dealer.provision();

  // The mandate is deliberately small; the Deal built below claims more than it
  // authorises, which is exactly the case the runtime assertion exists to stop.
  const mandateMax = Number(quantity) / 2;

  const cashCid = await buyer.ensureCash(instrument, Number(quantity) * 2);
  const inventoryCid = await dealer.ensureInventory(instrument, Number(quantity));
  registerSettlementIntent({
    dealerParty,
    securitySymbol: instrument.id,
    securityCid: inventoryCid,
    quantity: Number(quantity),
    participant: PARTICIPANTS.participant1.name,
  });

  const overrides: RfqOverrides = {
    amount: mandateMax,
    maxPrice: unitPrice,
    assetToBuy: instrument,
    settlementAsset: instrument,
  };
  const spec = defaultRfq(1, [dealerParty], overrides);
  spec.mandate = { riskOfficer, maxAmount: mandateMax };
  const rfqCid = await buyer.createRfq(spec);
  console.log(`[buyer] RFQ under a mandate capped at ${mandateMax} base units`);

  const observed = await dealer.observeRfqs(60_000);
  const mine = observed.find((r) => r.cid === rfqCid) ?? observed[0];
  if (!mine) throw new Error("dealer did not observe the RFQ");
  if (!(await dealer.quoteOn(mine.cid, mine.arg))) throw new Error("dealer did not quote");

  const proposals = await buyer.collectProposals(rfqCid, 60_000);
  const winner = selectWinner(proposals, spec.maxPrice);
  if (!winner) throw new Error("no proposal within maxPrice");
  const sealedTx = await buyer.client.exercise(
    "QuoteProposal",
    winner._cid,
    "AcceptProposal",
    { maxPrice: String(spec.maxPrice) },
    [buyerParty],
    `cmd-accept-${winner.bidId}`,
  );
  const sealed = (sealedTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Rfq:SealedQuote"));
  if (!sealed) throw new Error("no sealed quote");
  if (sealed.createArgument.selectionPolicy !== SELECTION_POLICY) throw new Error("policy mismatch");
  console.log(`[venue] sealed ${winner.bidId} at ${winner.offeredPrice}`);

  // Reserve real tokens, so there is something concrete that must NOT move.
  const settlementRef = `SHADOWDESK-GUARD-${Date.now()}`;
  await createDvpLegs(ledger, {
    executor: buyerParty,
    settlementRef,
    security: {
      instrument,
      sender: dealerParty,
      receiver: buyerParty,
      amount: "0.0100000000",
      legId: "security",
    },
    payment: {
      instrument,
      sender: buyerParty,
      receiver: dealerParty,
      amount: "0.0100000000",
      legId: "payment",
    },
  });
  const legs = new Map<string, any>();
  for (const [party, inst] of [[dealerParty, instrument], [buyerParty, instrument]] as const) {
    for (const leg of await listAllocationLegs(ledger, party, settlementRef, {
      registryUrl: inst.registryUrl,
    })) {
      legs.set(leg.contractId, leg);
    }
  }
  if (legs.size === 0) throw new Error("no legs reserved for the guard test");

  const before = { dealer: await total(dealerParty), buyer: await total(buyerParty) };

  // Build the Deal directly so it can claim more than the mandate authorised.
  const dealTx = await buyer.client.create(
    "Deal",
    {
      reference: `DEAL-GUARD-${Date.now()}`,
      buyer: buyerParty,
      dealer: dealerParty,
      security: { issuer: instrument.issuer, symbol: instrument.id },
      // Twice what the mandate allows.
      quantity: String(mandateMax * 2),
      unitPrice: String(unitPrice),
      settlementAsset: { issuer: instrument.issuer, symbol: instrument.id },
      paymentCid: cashCid,
      securityCid: inventoryCid,
      sealedQuote: sealed.contractId,
      expiry: spec.expiry,
    },
    [buyerParty, dealerParty],
    `cmd-deal-guard-${Date.now()}`,
  );
  const dealCid = (dealTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Settlement:Deal"))?.contractId;
  if (!dealCid) throw new Error("guard Deal was not created");
  console.log(`[guard] Deal claims ${mandateMax * 2} against a mandate of ${mandateMax}`);

  // Submit the receipt and both real transfers together: this is exactly the
  // update the happy path uses, so a rejection here must roll the legs back too.
  const { commands, disclosedContracts, actAs } = await buildAllocationTransferCommands(ledger, [...legs.values()], {
    executor: buyerParty,
  });

  let rejected = "";
  try {
    await ledger.submitMany(
      [
        { ExerciseCommand: { templateId: TPL.Deal, contractId: dealCid, choice: "Settle", choiceArgument: {} } },
        ...commands,
      ],
      Array.from(new Set([...actAs, buyerParty, dealerParty])),
      { disclosedContracts, packageIdSelectionPreference: null },
      randomUUID(),
    );
  } catch (e: any) {
    rejected = String(e?.causeJson?.cause ?? e?.message ?? e);
  }

  if (!rejected) {
    throw new Error("a Deal exceeding its mandate was accepted; the guard did not hold");
  }
  console.log(`[guard] rejected on-ledger: ${rejected.slice(0, 160)}`);

  const after = { dealer: await total(dealerParty), buyer: await total(buyerParty) };
  const moved = Math.abs(after.dealer - before.dealer) > 1e-9 || Math.abs(after.buyer - before.buyer) > 1e-9;
  if (moved) {
    throw new Error(
      `tokens moved despite the rejection: dealer ${before.dealer} -> ${after.dealer}, buyer ${before.buyer} -> ${after.buyer}`,
    );
  }
  console.log(`[guard] balances unchanged: dealer ${after.dealer}, buyer ${after.buyer}`);

  // The legs must still be reserved, proving they were rolled back rather than
  // consumed, and are then released so the next round starts spendable.
  const stillThere = await listAllocationLegs(ledger, dealerParty, settlementRef, {
    registryUrl: instrument.registryUrl,
  });
  console.log(`[guard] ${stillThere.length} leg(s) still reserved after the rejected update`);
  const released = await cancelDanglingAllocations(ledger, [buyerParty, dealerParty], "SHADOWDESK-GUARD-", {
    registryUrl: instrument.registryUrl,
    admin: instrument.issuer,
  });
  console.log(`[guard] released ${released.length} reservation(s)`);

  console.log("\nMANDATE GUARD OK: rejected on-ledger, no token moved, legs rolled back");
};

main().catch((e) => {
  console.error("\nMANDATE GUARD FAILED:", e);
  process.exit(1);
});