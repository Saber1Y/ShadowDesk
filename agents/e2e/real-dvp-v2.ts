import { CantonClient, envValue } from "../shared/client.js";
import { settlementEnvironment } from "../shared/config.js";
import {
  createDvpLegs,
  findAllocationLegsByCid,
  formatTokenAmount,
  listHoldings,
  parseTokenAmount,
  type AllocationLeg,
} from "../shared/token-allocation.js";
import { PACKAGE_ID_V2, TPL_V2, type Party } from "../shared/types.js";
import { createSettlementPlanV2, findReceiptV2, settleV2 } from "../shared/settlement-v2.js";

/**
 * Real Token Standard (CIP-56) delivery-versus-payment, on the v2 contract.
 *
 * This is the check that matters. It settles genuine registry holdings: it
 * creates two Allocation contracts, pins them in a SettlementPlan, then settles
 * the registry transfers and the ShadowDesk receipt in one Ledger API
 * transaction. Nothing here is simulated, and localnet cannot run it because it
 * has no registry.
 *
 * Unlike the v1 real-dvp check, the trade is sized from holdings the script
 * reads itself, so there is nothing to hand-configure beyond being funded.
 *
 * Run it through the session loader so the DevNet token is present:
 *   scripts/env/with-devnet-auth.sh npm run e2e:real-dvp-v2
 */

const PRICE_SCALE = 10n ** 18n;

const network = settlementEnvironment().network;
if (network !== "devnet") {
  throw new Error(
    "real DvP needs SHADOWDESK_NETWORK=devnet; the local sandbox has no token registry. " +
      "Run it through scripts/env/with-devnet-auth.sh",
  );
}

const required = (name: string): string => {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for the real DvP check`);
  return value;
};

const env = settlementEnvironment();
const baseUrl = env.participants.participant1.jsonApi;

const parties = {
  buyer: required("SHADOWDESK_BUYER_PARTY"),
  dealer: required("SHADOWDESK_DEALER_A_PARTY"),
};

const toBigInt = (value: string, decimals: number, label: string): bigint =>
  parseTokenAmount(value, decimals, label);

const available = async (
  client: CantonClient,
  party: Party,
  instrumentId: string,
): Promise<bigint> => {
  const instrument = instrumentId === env.cbtc.id ? env.cbtc : env.beth;
  const holdings = await listHoldings(client, party, instrument);
  return holdings.reduce(
    (sum, h) => sum + toBigInt(h.amount, instrument.decimals, `${instrumentId} holding`),
    0n,
  );
};

/** Format a 1e18-scaled price as a fixed-point decimal the ledger accepts. */
const formatPrice = (scaled: bigint): string => {
  const whole = scaled / PRICE_SCALE;
  const frac = scaled % PRICE_SCALE;
  const fracText = frac.toString().padStart(18, "0").slice(0, 10);
  return `${whole}.${fracText}`;
};

const main = async (): Promise<void> => {
  const client = new CantonClient(baseUrl, "participant1");
  const now = Date.now();
  const suffix = String(now);
  const expiry = new Date(now + 24 * 3600 * 1000).toISOString();

  // Which instrument the dealer delivers. The settlement is symmetric in both
  // legs, so this only selects which holding each side spends. It defaults to
  // the product's intended CBTC-for-BETH direction and can be flipped when
  // DevNet balances only fund the opposite side.
  const delivered = (envValue("SHADOWDESK_E2E_DELIVERED_INSTRUMENT") ?? env.cbtc.id).toUpperCase();
  const security = delivered === env.beth.id ? env.beth : env.cbtc;
  const payment = security === env.cbtc ? env.beth : env.cbtc;
  console.log(`[dv2] trading ${security.id} for ${payment.id} (${payment.decimals} decimals)`);

  const dealerSecurity = await available(client, parties.dealer, security.id);
  const buyerPayment = await available(client, parties.buyer, payment.id);
  const buyerSecurity = await available(client, parties.buyer, security.id);
  console.log(
    `[dv2] holdings dealer ${security.id}=${dealerSecurity} | buyer ${payment.id}=${buyerPayment} | buyer ${security.id}=${buyerSecurity}`,
  );

  if (dealerSecurity <= 0n) {
    throw new Error(`dealer ${parties.dealer} holds no ${security.id}; fund it before running`);
  }
  if (buyerPayment <= 0n) {
    throw new Error(`buyer ${parties.buyer} holds no ${payment.id}; fund it before running`);
  }

  // Price the trade from the ask, unless overridden. The default is a round
  // number so the arithmetic below stays obviously correct.
  const unitPriceScaled = envValue("SHADOWDESK_DVP_UNIT_PRICE")
    ? PRICE_SCALE * BigInt(Math.round(Number(required("SHADOWDESK_DVP_UNIT_PRICE")) * 1e6)) / 1_000_000n
    : PRICE_SCALE * 1n + PRICE_SCALE / 100n;

  // Size so the payment leg exactly covers quantity x price, then never exceed
  // what the dealer actually holds.
  let quantity = dealerSecurity;
  const paymentFor = (q: bigint): bigint => (q * unitPriceScaled) / PRICE_SCALE;
  if (paymentFor(quantity) > buyerPayment) {
    quantity = (buyerPayment * PRICE_SCALE) / unitPriceScaled;
    if (quantity <= 0n) throw new Error("buyer cannot fund even one whole unit; fund more BETH");
    console.log(`[dv2] sized down to ${quantity} so the payment leg is covered`);
  }

  const securityAmount = quantity;
  const paymentAmount = paymentFor(quantity);
  // Registry and ShadowDesk contracts both take fixed-point decimals, and the
  // SettlementPlan asserts leg.amount == quantity, so every amount crossing the
  // wire is rendered from the same base-unit arithmetic.
  const securityDecimal = formatTokenAmount(securityAmount, security.decimals);
  const paymentDecimal = formatTokenAmount(paymentAmount, payment.decimals);
  const unitPrice = formatPrice(unitPriceScaled);
  const reference = `SHADOWDESK-DVP-V2-${suffix}`;
  console.log(`[dv2] quantity=${securityDecimal} ${security.id} at ${unitPrice} ${payment.id}`);

  // 1. Create the two registry allocations.
  const legs = await createDvpLegs(client, {
    executor: parties.buyer,
    settlementRef: reference,
    security: {
      instrument: security,
      sender: parties.dealer,
      receiver: parties.buyer,
      amount: securityDecimal,
      legId: "security",
    },
    payment: {
      instrument: payment,
      sender: parties.buyer,
      receiver: parties.dealer,
      amount: paymentDecimal,
      legId: "payment",
    },
  });
  console.log(`[dv2] allocations created security=${legs.securityLegId.slice(0, 20)}... payment=${legs.paymentLegId.slice(0, 20)}...`);

  // 2. Read them back through the allocation interface, which is what the
  //    executor will trust. Reading them here proves the round trip before the
  //    plan pins them.
  const resolved = await findAllocationLegsByCid(
    client,
    [parties.buyer, parties.dealer],
    [legs.securityLegId, legs.paymentLegId],
    { registryUrl: security.registryUrl, instrument: security.instrument },
  );
  const securityLeg = resolved.get(legs.securityLegId);
  const paymentLeg = resolved.get(legs.paymentLegId);
  if (!securityLeg || !paymentLeg) {
    throw new Error(
      `interface query did not return both allocations: security=${Boolean(securityLeg)} payment=${Boolean(paymentLeg)}`,
    );
  }
  console.log("[dv2] interface query returned both allocations");

  // 3. Mandate-governed award chain on v2.
  const riskOfficer = envValue("SHADOWDESK_RISK_OFFICER_PARTY") ?? parties.buyer;
  const mandateCid = created(
    await client.submitMany(
      [
        {
          CreateCommand: {
            templateId: TPL_V2.TreasuryMandate,
            createArguments: {
              buyer: parties.buyer,
              riskOfficer,
              approvedDealers: [parties.dealer],
              securityInstrument: { id: security.id, admin: security.issuer },
              settlementInstrument: { id: payment.id, admin: payment.issuer },
              maxAmount: securityDecimal,
              maxPrice: unitPrice,
              reference: `MANDATE-DV2-${suffix}`,
              expiry,
            },
          },
        },
      ],
      [parties.buyer, riskOfficer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dv2-mandate-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:TreasuryMandate",
  );

  const approvedCid = created(
    await client.submitMany(
      [exercise(TPL_V2.TreasuryMandate, mandateCid, "Approve")],
      [parties.buyer, riskOfficer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dv2-approve-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:ApprovedMandate",
  );

  const rfqCid = created(
    await client.submitMany(
      [
        {
          ExerciseCommand: {
            templateId: TPL_V2.ApprovedMandate,
            contractId: approvedCid,
            choice: "OpenRfq",
            choiceArgument: {
              dealers: [parties.dealer],
              amount: securityDecimal,
              maxPrice: unitPrice,
              reference: `RFQ-DV2-${suffix}`,
              expiry,
            },
          },
        },
      ],
      [parties.buyer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dv2-rfq-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:BlockTradeRFQ",
  );

  const proposalCid = created(
    await client.submitMany(
      [
        {
          ExerciseCommand: {
            templateId: TPL_V2.BlockTradeRFQ,
            contractId: rfqCid,
            choice: "SubmitQuoteProposal",
            choiceArgument: { dealer: parties.dealer, offeredPrice: unitPrice, bidId: "BID-DV2-1" },
          },
        },
      ],
      [parties.dealer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dv2-proposal-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:QuoteProposal",
  );

  const sealedCid = created(
    await client.submitMany(
      [
        {
          ExerciseCommand: {
            templateId: TPL_V2.QuoteProposal,
            contractId: proposalCid,
            choice: "AcceptProposal",
            choiceArgument: { maxPrice: unitPrice },
          },
        },
      ],
      [parties.buyer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dv2-accept-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:SealedQuote",
  );
  console.log(`[dv2] award sealed ${sealedCid.slice(0, 20)}... at ${unitPrice}`);

  // 4. Pin both allocations in a SettlementPlan.
  const planCid = await createSettlementPlanV2(client, {
    buyer: parties.buyer,
    dealer: parties.dealer,
    executor: parties.buyer,
    reference,
    sealedQuote: sealedCid,
    securityInstrument: security,
    settlementInstrument: payment,
    quantity: securityDecimal,
    unitPrice,
    securityLeg: toLegRef(securityLeg, "SecurityLeg", securityDecimal),
    paymentLeg: toLegRef(paymentLeg, "PaymentLeg", paymentDecimal),
    expiry,
  });
  console.log(`[dv2] plan ${planCid.slice(0, 20)}... pins both allocations`);

  // 5. Settle: registry transfers and the receipt in one transaction.
  // Sender debits and receiver credits are both read, because a leg that moved
  // the right amount in the wrong direction would satisfy a debit-only check.
  const beforeDealerSecurity = await available(client, parties.dealer, security.id);
  const beforeBuyerPayment = await available(client, parties.buyer, payment.id);
  const beforeBuyerSecurity = await available(client, parties.buyer, security.id);
  const beforeDealerPayment = await available(client, parties.dealer, payment.id);

  const result = await settleV2(client, {
    buyer: parties.buyer,
    dealer: parties.dealer,
    executor: parties.buyer,
    planContractId: planCid,
    registryUrl: security.registryUrl,
  });
  console.log(
    `[dv2] settled in one transaction at offset ${result.offset} (${result.eventCount} events), receipt=${result.receiptContractId.slice(0, 20)}...`,
  );

  // 6. The evidence: both holdings moved, in the same transaction as the receipt.
  const afterDealerSecurity = await available(client, parties.dealer, security.id);
  const afterBuyerPayment = await available(client, parties.buyer, payment.id);
  const afterBuyerSecurity = await available(client, parties.buyer, security.id);
  const afterDealerPayment = await available(client, parties.dealer, payment.id);

  const moved: Array<[string, bigint, bigint, "debit" | "credit", bigint]> = [
    [
      `dealer ${security.id}`,
      beforeDealerSecurity,
      afterDealerSecurity,
      "debit",
      securityAmount,
    ],
    [
      `buyer ${payment.id}`,
      beforeBuyerPayment,
      afterBuyerPayment,
      "debit",
      paymentAmount,
    ],
    [
      `buyer ${security.id}`,
      beforeBuyerSecurity,
      afterBuyerSecurity,
      "credit",
      securityAmount,
    ],
    [
      `dealer ${payment.id}`,
      beforeDealerPayment,
      afterDealerPayment,
      "credit",
      paymentAmount,
    ],
  ];
  for (const [label, before, after, kind, expected] of moved) {
    const delta = kind === "debit" ? before - after : after - before;
    if (delta !== expected) {
      throw new Error(
        `${label} ${kind} was ${delta} base units, expected ${expected} ` +
          `(balance ${before} -> ${after})`,
      );
    }
  }
  console.log(
    `[dv2] holdings moved: dealer -${securityDecimal} ${security.id}, buyer -${paymentDecimal} ${payment.id}, ` +
      `buyer +${securityDecimal} ${security.id}, dealer +${paymentDecimal} ${payment.id}`,
  );

  const receipt = await findReceiptV2(client, parties.buyer, reference);
  if (!receipt) throw new Error("buyer cannot read the receipt the settlement created");
  if (receipt.securityAllocationCid !== legs.securityLegId) {
    throw new Error("receipt records a different security allocation than the plan pinned");
  }
  if (receipt.paymentAllocationCid !== legs.paymentLegId) {
    throw new Error("receipt records a different payment allocation than the plan pinned");
  }
  console.log(`[dv2] receipt ties both allocations and quote ${receipt.sealedQuote.slice(0, 16)}...`);
  console.log(`DVP V2 REAL ALLOCATION OK ref=${reference}`);
};

const toLegRef = (leg: AllocationLeg, role: "SecurityLeg" | "PaymentLeg", amount: string) => ({
  role,
  allocationCid: leg.contractId,
  instrument: { id: leg.instrumentId, admin: leg.admin },
  sender: leg.sender,
  receiver: leg.receiver,
  amount,
});

const exercise = (templateId: string, contractId: string, choice: string, choiceArgument: unknown = {}) => ({
  ExerciseCommand: { templateId, contractId, choice, choiceArgument },
});

const created = (tx: any, moduleSuffix: string): string => {
  const event = (tx.transaction?.events ?? [])
    .map((e: any) => e.CreatedEvent)
    .find((e: any) => typeof e?.templateId === "string" && e.templateId.endsWith(moduleSuffix));
  if (!event) throw new Error(`expected a ${moduleSuffix} created event`);
  return event.contractId as string;
};

main().catch((e) => {
  console.error("DVP V2 REAL ALLOCATION FAILED:", e);
  process.exit(1);
});