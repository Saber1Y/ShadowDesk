import { BuyerAgent, selectWinner, defaultRfq, SELECTION_POLICY, type RfqOverrides } from "../buyer/buyer.js";
import { DealerAgent, fixedPricePolicy } from "../dealer/dealer.js";
import { writeFileSync } from "node:fs";
import { CantonClient, envValue } from "../shared/client.js";
import { PARTICIPANTS, settlementEnvironment, type TokenInstrument } from "../shared/config.js";
import { settleDeal, registerSettlementIntent } from "../shared/settlement.js";
import {
  cancelDanglingAllocations,
  formatTokenAmount,
  parseTokenAmount,
  createDvpLegs,
  listHoldings,
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

const partyHint = (party: string): string => {
  const namespace = party.split("::")[0];
  const hinted = namespace.replace(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}-?|^[0-9a-fA-F]{8}-/,
    "",
  );
  return hinted.length > 0 ? hinted : namespace.slice(0, 12);
};

const num = (name: string, fallback: number): number => {
  const raw = envValue(name);
  return raw === undefined ? fallback : Number(raw);
};


export interface RealSettlementRecord {
  settlementRef: string;
  receiptCid: string;
  updateId: string;
  delivered: string;
  payment: string;
  legs: Array<{ cid: string; legId: string; instrument: string; sender: string; receiver: string; amount: string }>;
}

const settlementRecords: RealSettlementRecord[] = [];

/**
 * Publish what the settle returned for the dashboard to read.
 *
 * Written to a path the caller supplies rather than logged, because the caller
 * needs the allocation ids and the update id as data and parsing them back out of
 * console output would be guesswork.
 */
const recordSettlement = (record: RealSettlementRecord): void => {
  settlementRecords.push(record);
  const target = envValue("SHADOWDESK_E2E_RESULT_PATH");
  if (!target) return;
  try {
    writeFileSync(target, JSON.stringify(settlementRecords, null, 2));
  } catch (e) {
    console.warn(`[result] could not write ${target}: ${String(e)}`);
  }
};

interface RoundOutcome {
  winner: string;
  price: number;
  receiptCid: string;
  dealerBefore: number;
  dealerAfter: number;
  buyerBefore: number;
  buyerAfter: number;
  legs: number;
}

/**
 * One full round: mandate, RFQ, both dealers bid, the cheapest wins, and the
 * awarded dealer's registry legs settle in the same update as the receipt.
 *
 * Run twice with the pricing swapped, so each dealer is the one that actually
 * delivers. A competition where only the winner ever moves tokens does not show
 * that the losing dealer could have delivered, only that it did not.
 */
const runRound = async (
  client: CantonClient,
  parties: { buyer: string; dealerA: string; dealerB: string; riskOfficer: string },
  cfg: {
    label: string;
    securityUnits: bigint;
    payUnits: bigint;
    delivered: TokenInstrument;
    payment: TokenInstrument;
    priceA: number;
    priceB: number;
    expectWinner: string;
  },
): Promise<RoundOutcome> => {
  const { buyer, dealerA, dealerB, riskOfficer } = parties;
  const { securityUnits, payUnits, delivered, payment } = cfg;
  const quantity = formatTokenAmount(securityUnits, delivered.decimals);
  const payAmount = formatTokenAmount(payUnits, payment.decimals);
  const unitPrice = Math.max(cfg.priceA, cfg.priceB);
  const settlementRef = `SHADOWDESK-E2E-${Date.now()}-${cfg.label}`;
  const buyerAgent = new BuyerAgent(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);
  const agentA = new DealerAgent(
    PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name, "dealerA", fixedPricePolicy(cfg.priceA),
  );
  const agentB = new DealerAgent(
    PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name, "dealerB", fixedPricePolicy(cfg.priceB),
  );
  await buyerAgent.provision();
  await agentA.provision();
  await agentB.provision();

  const total = async (party: string): Promise<number> =>
    (await listHoldings(client, party, delivered)).reduce((s, h) => s + Number(h.amount), 0);

  const cashCid = await buyerAgent.ensureCash(payment, Number(payUnits * 2n));
  const inventoryByParty = new Map<string, string>([
    [dealerA, await agentA.ensureInventory(delivered, Number(securityUnits))],
    [dealerB, await agentB.ensureInventory(delivered, Number(securityUnits))],
  ]);
  registerSettlementIntent({
    dealerParty: dealerA,
    securitySymbol: delivered.id,
    securityCid: inventoryByParty.get(dealerA)!,
    quantity: Number(securityUnits),
    participant: PARTICIPANTS.participant1.name,
  });

  const overrides: RfqOverrides = {
    amount: Number(securityUnits),
    maxPrice: unitPrice,
    assetToBuy: delivered,
    settlementAsset: payment,
  };
  const spec = defaultRfq(2, [dealerA, dealerB], overrides);
  spec.mandate = { riskOfficer, maxAmount: Number(securityUnits) };

  console.log(`\n--- round ${cfg.label}: ${securityUnits} ${delivered.id} for ${payAmount} ${payment.id} @ <=${unitPrice}`);
  const rfqCid = await buyerAgent.createRfq(spec);

  for (const agent of [agentA, agentB]) {
    const observed = await agent.observeRfqs(60_000);
    const mine = observed.find((r) => r.cid === rfqCid) ?? observed[0];
    if (!mine) throw new Error(`${agent.dealerPartyHint} did not observe the RFQ`);
    if (!(await agent.quoteOn(mine.cid, mine.arg))) throw new Error(`${agent.dealerPartyHint} did not quote`);
  }

  const proposals = await buyerAgent.collectProposals(rfqCid, 60_000);
  if (proposals.length < 2) {
    throw new Error(`expected 2 competing proposals in round ${cfg.label}, collected ${proposals.length}`);
  }
  const ranked = [...proposals].sort(
    (a, b) => Number(a.offeredPrice) - Number(b.offeredPrice) || a.bidId.localeCompare(b.bidId),
  );
  for (const [i, bid] of ranked.entries()) {
    console.log(`  rank ${i + 1} ${bid.dealer === dealerA ? "dealerA" : "dealerB"} ${bid.offeredPrice} ${bid.bidId}`);
  }
  const winner = selectWinner(proposals, spec.maxPrice);
  if (!winner) throw new Error("no proposal within maxPrice");
  if (winner.bidId !== ranked[0].bidId) {
    throw new Error(
      `${SELECTION_POLICY} selected ${winner.bidId} at ${winner.offeredPrice} over the cheapest ${ranked[0].bidId} at ${ranked[0].offeredPrice}`,
    );
  }
  const expectedParty = cfg.expectWinner === "dealerA" ? dealerA : dealerB;
  if (winner.dealer !== expectedParty) {
    throw new Error(`round ${cfg.label} expected ${cfg.expectWinner} to win, got ${winner.dealer}`);
  }
  const saving = Number(ranked[1].offeredPrice) - Number(ranked[0].offeredPrice);
  console.log(`  ${SELECTION_POLICY} awards ${cfg.expectWinner} at ${winner.offeredPrice}; saving ${saving.toFixed(10)}`);

  const sealedTx = await buyerAgent.client.exercise(
    "QuoteProposal", winner._cid, "AcceptProposal", { maxPrice: String(spec.maxPrice) }, [buyer],
    `cmd-accept-${winner.bidId}`,
  );
  const sealedEvent = (sealedTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent).filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Rfq:SealedQuote"));
  if (!sealedEvent) throw new Error("AcceptProposal produced no sealed quote");
  if (sealedEvent.createArgument.selectionPolicy !== SELECTION_POLICY) {
    throw new Error(`award policy ${sealedEvent.createArgument.selectionPolicy} != ${SELECTION_POLICY}`);
  }
  const sealedCid: string = sealedEvent.contractId;
  console.log(`  sealed under policy=${SELECTION_POLICY}`);

  const createdLegs = await createDvpLegs(client, {
    executor: buyer,
    settlementRef,
    security: { instrument: delivered, sender: winner.dealer, receiver: buyer, amount: quantity, legId: "security" },
    payment: { instrument: payment, sender: buyer, receiver: winner.dealer, amount: payAmount, legId: "payment" },
  });
  const legs = new Map<string, any>();
  for (const leg of [createdLegs.securityLeg, createdLegs.paymentLeg]) legs.set(leg.contractId, leg);
  if (legs.size === 0) throw new Error(`no legs resolved for round ${cfg.label}`);

  const dealerBefore = await total(winner.dealer);
  const buyerBefore = await total(buyer);

  const settled = await settleDeal(buyerAgent.client, {
    reference: `DEAL-${spec.reference}`,
    buyer,
    dealer: winner.dealer,
    securitySymbol: delivered.id,
    quantity: Number(securityUnits),
    unitPrice: Number(winner.offeredPrice),
    paymentCid: cashCid,
    securityCid: inventoryByParty.get(winner.dealer)!,
    settlementAsset: { issuer: payment.issuer, symbol: payment.id },
    sealedQuoteCid: sealedCid,
    expectedBidId: winner.bidId,
    expectedPolicy: SELECTION_POLICY,
    expiry: spec.expiry,
    securityIssuer: delivered.issuer,
    allocations: { legs: [...legs.values()], executor: buyer },
  });

  const { receiptCid, receipt } = settled;
  const dealerAfter = await total(winner.dealer);
  const buyerAfter = await total(buyer);
  console.log(
    `  ONE update: receipt=${receiptCid.slice(0, 16)}... + ${legs.size} registry legs; ` +
      `security=${JSON.stringify((receipt as any).security)}`,
  );
  console.log(
    `  ${delivered.id} delivering dealer ${dealerBefore} -> ${dealerAfter}, buyer ${buyerBefore} -> ${buyerAfter}`,
  );

  // The registry legs are consumed by their own execution, so they leave the
  // active contract set and cannot be read back later. Recording what the settle
  // actually returned is the only way to show the real allocation ids for this
  // round, and it comes from the ledger response rather than from a restatement.
  recordSettlement({
    settlementRef,
    receiptCid,
    updateId: settled.updateId ?? "",
    delivered: delivered.id,
    payment: payment.id,
    legs: [...legs.values()].map((l) => ({
      cid: l.contractId,
      legId: l.legId,
      instrument: l.instrumentId,
      sender: l.sender,
      receiver: l.receiver,
      amount: l.amount,
    })),
  });

  return {
    winner: winner.dealer,
    price: Number(winner.offeredPrice),
    receiptCid,
    dealerBefore,
    dealerAfter,
    buyerBefore,
    buyerAfter,
    legs: legs.size,
  };
};

const main = async (): Promise<void> => {
  const { beth, cbtc } = env;
  const pick = (name: string, fallback: TokenInstrument): TokenInstrument =>
    (envValue(name) ?? "BETH").toUpperCase() === "CBTC" ? cbtc : fallback;

  const delivered = pick("SHADOWDESK_REAL_DELIVERED_INSTRUMENT", beth);
  const payment = pick("SHADOWDESK_REAL_PAYMENT_INSTRUMENT", beth);

  const parties = {
    buyer: required("SHADOWDESK_BUYER_PARTY"),
    dealerA: required("SHADOWDESK_DEALER_A_PARTY"),
    dealerB: required("SHADOWDESK_DEALER_B_PARTY"),
    riskOfficer: required("SHADOWDESK_RISK_OFFICER_PARTY"),
  };

  // Quantities are in base units, as everywhere else in this project and in the
  // dashboard's request form. The registry wants a fixed-point decimal, so the
  // conversion happens once here at the boundary.
  const securityUnits = BigInt(Math.round(num("SHADOWDESK_E2E_QUANTITY", 0.03 * 10 ** delivered.decimals)));
  const unitPrice = num("SHADOWDESK_E2E_UNIT_PRICE", 1);
  const payUnits = BigInt(Math.round(Number(formatTokenAmount(securityUnits, delivered.decimals)) * unitPrice * 10 ** payment.decimals));

  const ledger = new CantonClient(PARTICIPANTS.participant1.jsonApi, PARTICIPANTS.participant1.name);

  console.log(`=== ShadowDesk end-to-end on DevNet (real ${delivered.id} / ${payment.id}) ===`);
  console.log(
    `delivering ${formatTokenAmount(securityUnits, delivered.decimals)} ${delivered.id} ` +
      `for ${formatTokenAmount(payUnits, payment.decimals)} ${payment.id} @ ${unitPrice}`,
  );

  // Release anything an earlier aborted round left reserved, so this one starts
  // from a spendable balance instead of failing on a lock.
  for (const instrument of [delivered, payment]) {
    const released = await cancelDanglingAllocations(
      ledger,
      [parties.buyer, parties.dealerA, parties.dealerB],
      "SHADOWDESK-E2E-",
      { registryUrl: instrument.registryUrl, admin: instrument.issuer },
    );
    if (released.length > 0) {
      console.log(`[registry] released ${released.length} reservation(s) left by an earlier ${instrument.id} round`);
    }
  }

  // Two rounds means two payments out of the buyer and one delivery per dealer.
  // Checking that up front turns a mid-run shortfall into an actionable message
  // instead of an opaque "holds 0.015 BETH but the leg needs 0.02" after the
  // first round has already committed.
  const ROUNDS = 2;
  const needed: Array<[string, string, bigint]> = [
    [parties.buyer, payment.id, payUnits * BigInt(ROUNDS)],
    [parties.dealerA, delivered.id, securityUnits],
    [parties.dealerB, delivered.id, securityUnits],
  ];
  const shortfalls: string[] = [];
  for (const [party, instrumentId, need] of needed) {
    const instrument = instrumentId === delivered.id ? delivered : payment;
    const held = (await listHoldings(ledger, party, instrument))
      .filter((h) => !h.locked)
      .reduce((sum, h) => sum + parseTokenAmount(h.amount, instrument.decimals, instrumentId), 0n);
    if (held < need) {
      shortfalls.push(
        `${partyHint(party)} needs ${formatTokenAmount(need, instrument.decimals)} ${instrumentId}, ` +
          `holds ${formatTokenAmount(held, instrument.decimals)}`,
      );
    }
  }
  if (shortfalls.length > 0) {
    throw new Error(
      `two rounds of ${formatTokenAmount(securityUnits, delivered.decimals)} ${delivered.id} for ` +
        `${formatTokenAmount(payUnits, payment.decimals)} ${payment.id} need:\n  ${shortfalls.join("\n  ")}\n` +
        "Run `npm run faucet:fund` to top up, or lower SHADOWDESK_E2E_QUANTITY.",
    );
  }

  const base = {
    securityUnits,
    payUnits,
    delivered,
    payment,
  };

  // Two rounds with the pricing swapped, so each dealer is the one that
  // delivers. Competition where only the winner ever moves tokens shows that the
  // loser did not deliver, not that it could have.
  const outcomes: RoundOutcome[] = [];
  outcomes.push(
    await runRound(ledger, parties, {
      ...base,
      label: "dealerA-undercuts",
      priceA: unitPrice,
      priceB: Number((unitPrice * 1.1).toFixed(10)),
      expectWinner: "dealerA",
    }),
  );
  outcomes.push(
    await runRound(ledger, parties, {
      ...base,
      label: "dealerB-undercuts",
      priceA: Number((unitPrice * 1.1).toFixed(10)),
      priceB: unitPrice,
      expectWinner: "dealerB",
    }),
  );

  const deliveredBy = new Set(outcomes.map((o) => o.winner));
  if (deliveredBy.size !== 2) {
    throw new Error(`expected both dealers to deliver, winners were ${[...deliveredBy].join(", ")}`);
  }
  for (const o of outcomes) {
    const moved = o.dealerBefore - o.dealerAfter;
    if (Math.abs(moved - Number(formatTokenAmount(securityUnits, delivered.decimals))) > 1e-9) {
      throw new Error(
        `delivering dealer balance moved ${moved}, expected the delivered amount ${formatTokenAmount(securityUnits, delivered.decimals)}`,
      );
    }
  }
  console.log(`\nboth dealers delivered across ${outcomes.length} rounds:`);
  for (const o of outcomes) {
    console.log(`  ${o.winner === parties.dealerA ? "dealerA" : "dealerB"} @ ${o.price}, receipt ${o.receiptCid.slice(0, 16)}...`);
  }
  console.log("\nE2E REAL FLOW OK: competitive round, both dealers deliver, receipts atomic with registry legs");
};

main().catch((e) => {
  console.error("\nE2E REAL FLOW FAILED:", e);
  process.exit(1);
});
