import { CantonClient, envValue } from "../shared/client.js";
import { settlementEnvironment } from "../shared/config.js";
import {
  createDvpLegs,
  findAllocationLegsByCid,
  listHoldings,
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

const toBigInt = (value: string, label: string): bigint => {
  if (!/^-?\d+$/.test(value.trim())) {
    throw new Error(`${label} is not an integer token amount: ${JSON.stringify(value)}`);
  }
  return BigInt(value.trim());
};

const available = async (
  client: CantonClient,
  party: Party,
  instrumentId: string,
): Promise<bigint> => {
  const instrument = instrumentId === env.cbtc.id ? env.cbtc : env.beth;
  const holdings = await listHoldings(client, party, instrument);
  return holdings.reduce((sum, h) => sum + toBigInt(h.amount, `${instrumentId} holding`), 0n);
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

  const security = env.cbtc;
  const payment = env.beth;
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
  const unitPrice = formatPrice(unitPriceScaled);
  const reference = `SHADOWDESK-DVP-V2-${suffix}`;
  console.log(`[dv2] quantity=${securityAmount} ${security.id} at ${unitPrice} ${payment.id}`);

  // 1. Create the two registry allocations.
  const legs = await createDvpLegs(client, {
    executor: parties.buyer,
    settlementRef: reference,
    security: {
      instrument: security,
      sender: parties.dealer,
      receiver: parties.buyer,
      amount: securityAmount.toString(),
      legId: "security",
    },
    payment: {
      instrument: payment,
      sender: parties.buyer,
      receiver: parties.dealer,
      amount: paymentAmount.toString(),
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
              maxAmount: securityAmount.toString(),
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
              amount: securityAmount.toString(),
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
    quantity: securityAmount.toString(),
    unitPrice,
    securityLeg: toLegRef(securityLeg, "SecurityLeg", securityAmount.toString()),
    paymentLeg: toLegRef(paymentLeg, "PaymentLeg", paymentAmount.toString()),
    expiry,
  });
  console.log(`[dv2] plan ${planCid.slice(0, 20)}... pins both allocations`);

  // 5. Settle: registry transfers and the receipt in one transaction.
  const beforeDealerSecurity = await available(client, parties.dealer, security.id);
  const beforeBuyerPayment = await available(client, parties.buyer, payment.id);

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
  if (beforeDealerSecurity - afterDealerSecurity !== securityAmount) {
    throw new Error(
      `dealer ${security.id} moved by ${beforeDealerSecurity - afterDealerSecurity}, expected ${securityAmount}`,
    );
  }
  if (beforeBuyerPayment - afterBuyerPayment !== paymentAmount) {
    throw new Error(
      `buyer ${payment.id} moved by ${beforeBuyerPayment - afterBuyerPayment}, expected ${paymentAmount}`,
    );
  }
  console.log(`[dv2] holdings moved: dealer -${securityAmount} ${security.id}, buyer -${paymentAmount} ${payment.id}`);

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