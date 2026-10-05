import { CantonClient, envValue } from "../shared/client.js";
import { PACKAGE_ID_V2 } from "../shared/types.js";
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
 * ShadowDesk on DevNet, settled through the v2 SettlementPlan.
 *
 * Both transfers and the ShadowDesk receipt land in a single Ledger API
 * transaction, so the buyer can never end up holding the security without the
 * dealer receiving the payment, or the reverse.
 *
 * **This path cannot complete on DevNet.** It settles through the v2
 * `SettlementPlan`, and the v2 package is not installed on the participant and
 * cannot be uploaded: `POST /v2/packages` returns 403 for this application's
 * token, which only a participant operator can do. The run therefore fails at
 * submit with `Package-id 9e41d0b5b46e... not known`.
 *
 * It is kept because the v2 receipt is the right end state: it records the
 * registry `InstrumentId` directly instead of the `AssetId` pair the deployed v1
 * package is limited to. It becomes usable the moment the package can be
 * installed, with no code change.
 *
 * For a real-token flow that runs on DevNet today, use `npm run e2e:real-flow`.
 * That settles the same way, in one update carrying the v1 receipt plus both
 * registry transfers, using only packages already deployed.
 *
 *   scripts/env/with-devnet-auth.sh npm run demo:real
 */

const required = (name: string): string => {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for the real-token demo`);
  return value;
};

const short = (party: string): string => `${party.slice(0, 18)}...`;

/**
 * Refuse to start when the v2 settlement package is absent from the participant.
 *
 * The registry half of this flow works fine without it, so the failure would
 * otherwise surface late, as an opaque `Package-id not known` at submit, after a
 * full round had already been written.
 */
const assertV2PackageInstalled = async (env: ReturnType<typeof settlementEnvironment>): Promise<void> => {
  const client = new CantonClient(env.participants.participant1.jsonApi, "participant1");
  let installed: string[] = [];
  try {
    const resp = await fetch(`${client.baseUrl}/v2/packages?limit=1000`, {
      headers: envValue("SHADOWDESK_CANTON_ACCESS_TOKEN")
        ? { Authorization: `Bearer ${envValue("SHADOWDESK_CANTON_ACCESS_TOKEN")}` }
        : {},
    });
    if (resp.ok) installed = ((await resp.json()) as any).packageIds ?? [];
  } catch {
    // An unreadable package list is not proof of absence; let the run proceed and
    // let the ledger decide.
    return;
  }
  if (installed.length === 0 || installed.includes(PACKAGE_ID_V2)) return;
  throw new Error(
    `the v2 settlement package ${PACKAGE_ID_V2.slice(0, 12)}... is not installed on this participant.\n` +
      "This demo settles through the v2 SettlementPlan, so it cannot complete without it, and this " +
      "application cannot install it: POST /v2/packages returns 403 for its own token.\n" +
      "Use `npm run e2e:real-flow` for a real-token DevNet settlement that runs today, or have a " +
      "participant operator install daml-v2/.daml/dist/shadowdesk-treasury-v2-1.0.0.dar.",
  );
};

const main = async (): Promise<void> => {
  const env = settlementEnvironment();
  if (env.network !== "devnet") {
    throw new Error(
      "the real-token demo needs SHADOWDESK_NETWORK=devnet; the local sandbox has no token registry. " +
        "Use npm run demo for the localnet demo, or run this through scripts/env/with-devnet-auth.sh",
    );
  }

  // Fail here rather than after a full round of quoting. The v2 package is
  // settled through, so without it the run cannot commit, and the ledger would
  // only report "Package-id not known" once everything else had been written.
  await assertV2PackageInstalled(env);

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
