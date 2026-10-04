import { CantonClient } from "./client.js";
import type { TokenInstrument } from "./config.js";
import {
  createDvpLegs,
  findAllocationLegsByCid,
  formatTokenAmount,
  listHoldings,
  parseTokenAmount,
  type AllocationLeg,
} from "./token-allocation.js";
import { PACKAGE_ID_V2, TPL_V2, type Party } from "./types.js";
import { createSettlementPlanV2, findReceiptV2, settleV2 } from "./settlement-v2.js";

/**
 * The real Token Standard delivery-versus-payment, as reusable tooling.
 *
 * This settles genuine CIP-56 registry holdings. It creates two Allocation
 * contracts, runs the mandate-governed award chain, pins both allocations in a
 * SettlementPlan, then settles the two registry transfers and the ShadowDesk
 * receipt in a single Ledger API transaction. Nothing is simulated, and it
 * cannot run on the local sandbox because that has no token registry.
 *
 * It lives here rather than in a script so the real-token path has exactly one
 * implementation: the e2e check and the demo both drive this, so a fix cannot
 * reach one and miss the other.
 */

/** Prices are carried at 1e18 so the decimal rendering is exact. */
export const PRICE_SCALE = 10n ** 18n;

/** Render a 1e18-scaled price as the fixed-point decimal the ledger accepts. */
export const formatPrice = (scaled: bigint): string => {
  const whole = scaled / PRICE_SCALE;
  const frac = scaled % PRICE_SCALE;
  const fracText = frac.toString().padStart(18, "0").slice(0, 10);
  return `${whole}.${fracText}`;
};

/**
 * Parse a human-entered price into the 1e18 scale the ledger uses.
 *
 * Prices come from configuration as ordinary decimal text, so this rejects
 * anything it cannot represent exactly rather than silently rounding.
 */
export const parseUnitPriceScaled = (raw: string): bigint => {
  const text = raw.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(text)) {
    throw new Error(`unit price must be a positive decimal with at most 18 fractional digits, got "${raw}"`);
  }
  const [whole, frac = ""] = text.split(".");
  const scaled = BigInt(whole) * PRICE_SCALE + BigInt(frac.padEnd(18, "0"));
  if (scaled <= 0n) throw new Error("unit price must be positive");
  return scaled;
};

/** The demo price: 1.01 payment units per whole security unit. */
export const DEFAULT_UNIT_PRICE_SCALED = PRICE_SCALE + PRICE_SCALE / 100n;

/**
 * Choose which instrument the dealer delivers and which the buyer pays.
 *
 * A settlement is symmetric in its two legs, so the delivered id only decides
 * the direction of the trade. Both entry points resolve the pair here so the
 * demo and the e2e check cannot end up trading different things.
 *
 * Leaving `paymentId` unset pairs the delivered instrument with the other
 * configured one. Passing it explicitly allows a same-instrument trade, where
 * both legs are created by one registry. That is the only kind that can settle
 * while an instrument's AllocationFactory package is missing from the node,
 * since the other leg would need the same missing package.
 */
export const resolveInstrumentPair = (
  deliveredId: string,
  paymentId: string | undefined,
  instruments: readonly TokenInstrument[],
): { security: TokenInstrument; payment: TokenInstrument } => {
  const configured = instruments.map((i) => i.id).join(", ");
  const find = (id: string, role: string): TokenInstrument => {
    const match = instruments.find((i) => i.id.toUpperCase() === id.trim().toUpperCase());
    if (!match) throw new Error(`${role} instrument ${id} is not configured (configured: ${configured})`);
    return match;
  };

  const security = find(deliveredId, "delivered");
  const payment = paymentId
    ? find(paymentId, "payment")
    : instruments.find((i) => i !== security);
  if (!payment) {
    throw new Error(`could not infer a payment instrument for ${deliveredId}; pass one explicitly`);
  }
  return { security, payment };
};

/** Total base units of an instrument a party can currently spend. */
export const availableHolding = async (
  client: CantonClient,
  party: Party,
  instrument: TokenInstrument,
): Promise<bigint> => {
  const holdings = await listHoldings(client, party, instrument);
  return holdings.reduce(
    (sum, holding) => sum + parseTokenAmount(holding.amount, instrument.decimals, `${instrument.id} holding`),
    0n,
  );
};

export interface RealDvPOptions {
  client: CantonClient;
  buyer: Party;
  dealer: Party;
  /** Who signs the settlement update. Defaults to the buyer. */
  executor?: Party;
  /** Who approves the treasury mandate. Defaults to the buyer. */
  riskOfficer?: Party;
  /** The instrument the dealer delivers. */
  security: TokenInstrument;
  /** The instrument the buyer delivers. */
  payment: TokenInstrument;
  /** 1e18-scaled price of the security in the payment instrument. */
  unitPriceScaled: bigint;
  /** Cap the trade size in security base units. Omit to trade the dealer's whole holding. */
  maxSecurityBaseUnits?: bigint;
  /** Stable label used in the settlement reference and log prefix. */
  reference: string;
  log?: (line: string) => void;
}

export interface RealDvPResult {
  reference: string;
  security: TokenInstrument;
  payment: TokenInstrument;
  securityAmount: bigint;
  paymentAmount: bigint;
  securityDecimal: string;
  paymentDecimal: string;
  unitPrice: string;
  sealedQuoteCid: string;
  planCid: string;
  securityAllocationCid: string;
  paymentAllocationCid: string;
  receiptCid: string;
  /** Ledger offset of the single update that moved both legs and wrote the receipt. */
  offset: number;
  eventCount: number;
  balances: {
    dealerSecurity: bigint;
    buyerSecurity: bigint;
    buyerPayment: bigint;
    dealerPayment: bigint;
  };
}

/**
 * Size a trade so the payment leg is exactly covered and neither side is
 * overdrawn. The payment leg is what the buyer pays, so it is sized from the
 * buyer's balance when the dealer's full holding would not clear.
 */
export const sizeRealTrade = (
  dealerSecurity: bigint,
  buyerPayment: bigint,
  unitPriceScaled: bigint,
  maxSecurityBaseUnits?: bigint,
): { securityAmount: bigint; paymentAmount: bigint } => {
  if (unitPriceScaled <= 0n) throw new Error("unit price must be positive");
  const paymentFor = (security: bigint): bigint => (security * unitPriceScaled) / PRICE_SCALE;

  let securityAmount = dealerSecurity;
  if (maxSecurityBaseUnits !== undefined && maxSecurityBaseUnits > 0n && securityAmount > maxSecurityBaseUnits) {
    securityAmount = maxSecurityBaseUnits;
  }
  if (securityAmount <= 0n) throw new Error("the dealer holds nothing to deliver");

  if (paymentFor(securityAmount) > buyerPayment) {
    securityAmount = (buyerPayment * PRICE_SCALE) / unitPriceScaled;
    if (securityAmount <= 0n) {
      throw new Error("the buyer cannot fund even one whole unit of the payment instrument");
    }
  }
  return { securityAmount, paymentAmount: paymentFor(securityAmount) };
};

/**
 * Run a whole real-token trade and settle it atomically.
 *
 * Every amount that crosses the wire is a registry-native fixed-point decimal.
 * The registry reads a bare integer as that many whole tokens, and
 * SettlementPlan requires each leg amount to equal the settled quantity, so all
 * three are rendered from the same base-unit arithmetic.
 */
export const settleRealDvP = async (options: RealDvPOptions): Promise<RealDvPResult> => {
  const {
    client,
    buyer,
    dealer,
    security,
    payment,
    unitPriceScaled,
    reference,
    maxSecurityBaseUnits,
  } = options;
  const executor = options.executor ?? buyer;
  const riskOfficer = options.riskOfficer ?? buyer;
  const log = options.log ?? ((line: string) => console.log(line));

  const suffix = reference.replace(/[^A-Za-z0-9]+/g, "-");
  const expiry = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

  const dealerSecurity = await availableHolding(client, dealer, security);
  const buyerSecurity = await availableHolding(client, buyer, security);
  const buyerPayment = await availableHolding(client, buyer, payment);
  log(
    `[dvp] holdings dealer ${security.id}=${formatTokenAmount(dealerSecurity, security.decimals)} | ` +
      `buyer ${payment.id}=${formatTokenAmount(buyerPayment, payment.decimals)} | ` +
      `buyer ${security.id}=${formatTokenAmount(buyerSecurity, security.decimals)}`,
  );

  const { securityAmount, paymentAmount } = sizeRealTrade(
    dealerSecurity,
    buyerPayment,
    unitPriceScaled,
    maxSecurityBaseUnits,
  );
  const securityDecimal = formatTokenAmount(securityAmount, security.decimals);
  const paymentDecimal = formatTokenAmount(paymentAmount, payment.decimals);
  const unitPrice = formatPrice(unitPriceScaled);
  log(`[dvp] quantity=${securityDecimal} ${security.id} at ${unitPrice} ${payment.id}`);

  // 1. Create the two registry allocations. They exist but have not moved: the
  //    holder still has to authorise the transfer.
  const legs = await createDvpLegs(client, {
    executor,
    settlementRef: reference,
    security: {
      instrument: security,
      sender: dealer,
      receiver: buyer,
      amount: securityDecimal,
      legId: "security",
    },
    payment: {
      instrument: payment,
      sender: buyer,
      receiver: dealer,
      amount: paymentDecimal,
      legId: "payment",
    },
  });
  log(
    `[dvp] allocations created security=${legs.securityLegId.slice(0, 20)}... payment=${legs.paymentLegId.slice(0, 20)}...`,
  );

  // 2. Read them back through the allocation interface, which is what the
  //    executor will trust. Reading them here proves the round trip before the
  //    plan pins them.
  const resolved = await findAllocationLegsByCid(
    client,
    [buyer, dealer],
    [legs.securityLegId, legs.paymentLegId],
    { registryUrl: security.registryUrl, instrument: security },
  );
  const securityLeg = resolved.get(legs.securityLegId);
  const paymentLeg = resolved.get(legs.paymentLegId);
  if (!securityLeg || !paymentLeg) {
    throw new Error(
      `interface query did not return both allocations: security=${Boolean(securityLeg)} payment=${Boolean(paymentLeg)}`,
    );
  }
  log("[dvp] interface query returned both allocations");

  // 3. Mandate-governed award chain on v2.
  const mandateCid = created(
    await client.submitMany(
      [
        {
          CreateCommand: {
            templateId: TPL_V2.TreasuryMandate,
            createArguments: {
              buyer,
              riskOfficer,
              approvedDealers: [dealer],
              securityInstrument: { id: security.id, admin: security.issuer },
              settlementInstrument: { id: payment.id, admin: payment.issuer },
              maxAmount: securityDecimal,
              maxPrice: unitPrice,
              reference: `MANDATE-${suffix}`,
              expiry,
            },
          },
        },
      ],
      [buyer, riskOfficer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dvp-mandate-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:TreasuryMandate",
  );

  const approvedCid = created(
    await client.submitMany(
      [exercise(TPL_V2.TreasuryMandate, mandateCid, "Approve")],
      [buyer, riskOfficer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dvp-approve-${suffix}`,
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
              dealers: [dealer],
              amount: securityDecimal,
              maxPrice: unitPrice,
              reference: `RFQ-${suffix}`,
              expiry,
            },
          },
        },
      ],
      [buyer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dvp-rfq-${suffix}`,
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
            choiceArgument: { dealer, offeredPrice: unitPrice, bidId: `BID-${suffix}` },
          },
        },
      ],
      [dealer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dvp-proposal-${suffix}`,
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
      [buyer],
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `dvp-accept-${suffix}`,
    ),
    ":ShadowDesk.V2.Rfq:SealedQuote",
  );
  log(`[dvp] award sealed ${sealedCid.slice(0, 20)}... at ${unitPrice}`);

  // 4. Pin both allocations in a SettlementPlan. The plan is the authorization
  //    record: it is what the receipt is checked against, and it cannot name a
  //    different leg than the one the registry created.
  const planCid = await createSettlementPlanV2(client, {
    buyer,
    dealer,
    executor,
    reference,
    sealedQuote: sealedCid,
    securityInstrument: security,
    settlementInstrument: payment,
    quantity: securityDecimal,
    unitPrice,
    securityLeg,
    paymentLeg,
    expiry,
  });
  log(`[dvp] plan ${planCid.slice(0, 20)}... pins both allocations`);

  // 5. Settle: both registry transfers and the receipt in one update.
  const before = {
    dealerSecurity,
    buyerSecurity,
    buyerPayment,
    dealerPayment: await availableHolding(client, dealer, payment),
  };

  const result = await settleV2(client, {
    buyer,
    dealer,
    executor,
    planContractId: planCid,
    registryUrl: security.registryUrl,
  });
  log(
    `[dvp] settled in one update at offset ${result.offset} (${result.eventCount} events), ` +
      `receipt=${result.receiptContractId.slice(0, 20)}...`,
  );

  // 6. The evidence. Sender debits and receiver credits are both read, because
  //    a leg that moved the right amount in the wrong direction would satisfy a
  //    debit-only check.
  const after = {
    dealerSecurity: await availableHolding(client, dealer, security),
    buyerSecurity: await availableHolding(client, buyer, security),
    buyerPayment: await availableHolding(client, buyer, payment),
    dealerPayment: await availableHolding(client, dealer, payment),
  };

  const moves: Array<[string, bigint, bigint, "debit" | "credit", bigint]> = [
    [`dealer ${security.id}`, before.dealerSecurity, after.dealerSecurity, "debit", securityAmount],
    [`buyer ${payment.id}`, before.buyerPayment, after.buyerPayment, "debit", paymentAmount],
    [`buyer ${security.id}`, before.buyerSecurity, after.buyerSecurity, "credit", securityAmount],
    [`dealer ${payment.id}`, before.dealerPayment, after.dealerPayment, "credit", paymentAmount],
  ];
  for (const [label, from, to, kind, expected] of moves) {
    const delta = kind === "debit" ? from - to : to - from;
    if (delta !== expected) {
      throw new Error(
        `${label} ${kind} was ${delta} base units, expected ${expected} (balance ${from} -> ${to})`,
      );
    }
  }
  log(
    `[dvp] holdings moved: dealer -${securityDecimal} ${security.id}, buyer -${paymentDecimal} ${payment.id}, ` +
      `buyer +${securityDecimal} ${security.id}, dealer +${paymentDecimal} ${payment.id}`,
  );

  const receipt = await findReceiptV2(client, buyer, reference);
  if (!receipt) throw new Error("the buyer cannot read the receipt the settlement created");
  if (receipt.securityAllocationCid !== legs.securityLegId) {
    throw new Error("receipt records a different security allocation than the plan pinned");
  }
  if (receipt.paymentAllocationCid !== legs.paymentLegId) {
    throw new Error("receipt records a different payment allocation than the plan pinned");
  }
  log(`[dvp] receipt ties both allocations and quote ${receipt.sealedQuote.slice(0, 16)}...`);

  return {
    reference,
    security,
    payment,
    securityAmount,
    paymentAmount,
    securityDecimal,
    paymentDecimal,
    unitPrice,
    sealedQuoteCid: sealedCid,
    planCid,
    securityAllocationCid: legs.securityLegId,
    paymentAllocationCid: legs.paymentLegId,
    receiptCid: result.receiptContractId,
    offset: result.offset,
    eventCount: result.eventCount,
    balances: after,
  };
};

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
