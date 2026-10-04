import { CantonClient, envValue } from "../shared/client.js";
import { settlementEnvironment, type TokenInstrument } from "../shared/config.js";
import { formatTokenAmount } from "../shared/token-allocation.js";
import {
  DEFAULT_UNIT_PRICE_SCALED,
  availableHolding,
  formatPrice,
  parseUnitPriceScaled,
  resolveInstrumentPair,
  settleRealDvP,
} from "../shared/real-dvp.js";

/**
 * ShadowDesk on DevNet: a real two-token trade settled atomically on the
 * Canton Token Standard registry.
 *
 * This is the live version of the demo. Nothing is synthetic. The RFQ, quote,
 * settlement plan and receipt are real v2 contracts, and the two legs are real
 * CIP-56 Allocation transfers against genuine registry holdings:
 *
 *   Dealer A --[security allocation]--> Buyer
 *   Buyer    --[payment  allocation]--> Dealer A
 *
 * Both transfers and the ShadowDesk receipt land in a single Ledger API
 * transaction, so the buyer can never end up holding the security without the
 * dealer receiving the payment, or the reverse.
 *
 * The trade is sized from holdings the script reads itself, so there is nothing
 * to configure beyond being funded. `demo.ts` stays the localnet V1 demo; this
 * one needs DevNet because the local sandbox has no token registry.
 *
 *   scripts/env/with-devnet-auth.sh npm run demo:real
 */

const required = (name: string): string => {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for the real-token demo`);
  return value;
};

const short = (party: string): string => `${party.slice(0, 18)}...`;

const main = async (): Promise<void> => {
  const env = settlementEnvironment();
  if (env.network !== "devnet") {
    throw new Error(
      "the real-token demo needs SHADOWDESK_NETWORK=devnet; the local sandbox has no token registry. " +
        "Use npm run demo for the localnet demo, or run this through scripts/env/with-devnet-auth.sh",
    );
  }

  const buyer = required("SHADOWDESK_BUYER_PARTY");
  const dealer = required("SHADOWDESK_DEALER_A_PARTY");

  // The delivered instrument selects which holding each side spends. The
  // settlement is symmetric, so this only chooses the direction of the trade.
  // Leaving the payment instrument unset pairs it with the other configured
  // one; setting both trades a single instrument against itself.
  const { security, payment } = resolveInstrumentPair(
    envValue("SHADOWDESK_REAL_DELIVERED_INSTRUMENT") ?? env.cbtc.id,
    envValue("SHADOWDESK_REAL_PAYMENT_INSTRUMENT"),
    [env.cbtc, env.beth],
  );

  // Price in 1e18-scaled payment units per whole security unit. The default is
  // 1.01 so the arithmetic stays obviously correct by eye.
  const priceOverride = envValue("SHADOWDESK_REAL_UNIT_PRICE");
  const unitPriceScaled = priceOverride !== undefined
    ? parseUnitPriceScaled(priceOverride)
    : DEFAULT_UNIT_PRICE_SCALED;

  const client = new CantonClient(env.participants.participant1.jsonApi, "participant1");
  const fmt = (amount: bigint, instrument: TokenInstrument): string =>
    `${formatTokenAmount(amount, instrument.decimals)} ${instrument.id}`;

  console.log("=== ShadowDesk real-token settlement demo (DevNet, v2) ===");
  console.log(`delivering ${security.id} against ${payment.id} at ${formatPrice(unitPriceScaled)}`);

  const before = {
    dealerSecurity: await availableHolding(client, dealer, security),
    buyerSecurity: await availableHolding(client, buyer, security),
    buyerPayment: await availableHolding(client, buyer, payment),
    dealerPayment: await availableHolding(client, dealer, payment),
  };

  console.log(`\nLive registry holdings before the trade`);
  console.log(`  dealer ${short(dealer)} ${fmt(before.dealerSecurity, security)}, ${fmt(before.dealerPayment, payment)}`);
  console.log(`  buyer  ${short(buyer)} ${fmt(before.buyerSecurity, security)}, ${fmt(before.buyerPayment, payment)}`);

  if (before.dealerSecurity <= 0n) {
    throw new Error(`the dealer holds no ${security.id} to deliver; fund it first`);
  }
  if (before.buyerPayment <= 0n) {
    throw new Error(`the buyer holds no ${payment.id} to pay with; fund it first`);
  }

  // The shared flow sizes the trade so the payment leg is exactly covered and
  // neither side is overdrawn, then reports what it sized.
  console.log(`\nRunning the trade. Both legs and the receipt settle in one transaction.`);

  const result = await settleRealDvP({
    client,
    buyer,
    dealer,
    security,
    payment,
    unitPriceScaled,
    reference: `SHADOWDESK-DEMO-REAL-${Date.now()}`,
    log: (line) => console.log(line.replace(/^\[dvp\]/, "  ")),
  });

  console.log(`\nSettled ${fmt(result.securityAmount, security)} for ${fmt(result.paymentAmount, payment)}`);
  console.log(`  quote=${result.sealedQuoteCid.slice(0, 20)}... plan=${result.planCid.slice(0, 20)}...`);
  console.log(`  receipt=${result.receiptCid.slice(0, 20)}... at ledger offset ${result.offset} across ${result.eventCount} events`);

  console.log(`\nLive registry holdings after the trade`);
  const after = result.balances;
  console.log(`  dealer ${security.id} ${fmt(before.dealerSecurity, security)} -> ${fmt(after.dealerSecurity, security)}`);
  console.log(`  buyer  ${security.id} ${fmt(before.buyerSecurity, security)} -> ${fmt(after.buyerSecurity, security)}`);
  console.log(`  buyer  ${payment.id} ${fmt(before.buyerPayment, payment)} -> ${fmt(after.buyerPayment, payment)}`);
  console.log(`  dealer ${payment.id} ${fmt(before.dealerPayment, payment)} -> ${fmt(after.dealerPayment, payment)}`);

  console.log("\nBoth legs and the receipt settled atomically against real registry holdings.");
  console.log("REAL TOKEN DEMO OK");
};

main().catch((e) => {
  console.error("\nREAL TOKEN DEMO FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
