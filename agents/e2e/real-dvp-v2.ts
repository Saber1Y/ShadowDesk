import { CantonClient, envValue } from "../shared/client.js";
import { settlementEnvironment } from "../shared/config.js";
import { formatTokenAmount } from "../shared/token-allocation.js";
import {
  DEFAULT_UNIT_PRICE_SCALED,
  formatPrice,
  parseUnitPriceScaled,
  resolveInstrumentPair,
  settleRealDvP,
} from "../shared/real-dvp.js";

/**
 * Real Token Standard (CIP-56) delivery-versus-payment, on the v2 contract.
 *
 * This is the check that matters. It settles genuine registry holdings: two
 * Allocation contracts are created, pinned in a SettlementPlan, then the
 * registry transfers and the ShadowDesk receipt are settled in one Ledger API
 * transaction. Nothing here is simulated, and the local sandbox cannot run it
 * because it has no token registry.
 *
 * Unlike the v1 real-dvp check, the trade is sized from holdings the script
 * reads itself, so there is nothing to hand-configure beyond being funded. The
 * sequence itself lives in shared/real-dvp.ts so the demo and this check cannot
 * drift apart.
 *
 * Run it through the session loader so the DevNet token is present:
 *   scripts/env/with-devnet-auth.sh npm run e2e:real-dvp-v2
 */

const required = (name: string): string => {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for the real DvP check`);
  return value;
};

const main = async (): Promise<void> => {
  const env = settlementEnvironment();
  if (env.network !== "devnet") {
    throw new Error(
      "real DvP needs SHADOWDESK_NETWORK=devnet; the local sandbox has no token registry. " +
        "Run it through scripts/env/with-devnet-auth.sh",
    );
  }

  const buyer = required("SHADOWDESK_BUYER_PARTY");
  const dealer = required("SHADOWDESK_DEALER_A_PARTY");

  // Which instrument the dealer delivers only selects the direction of the
  // trade; the settlement itself is symmetric in both legs.
  const { security, payment } = resolveInstrumentPair(
    envValue("SHADOWDESK_E2E_DELIVERED_INSTRUMENT") ?? env.cbtc.id,
    envValue("SHADOWDESK_E2E_PAYMENT_INSTRUMENT"),
    [env.cbtc, env.beth],
  );
  const unitPriceScaled = envValue("SHADOWDESK_DVP_UNIT_PRICE")
    ? parseUnitPriceScaled(envValue("SHADOWDESK_DVP_UNIT_PRICE")!)
    : DEFAULT_UNIT_PRICE_SCALED;

  console.log(
    `[dv2] trading ${security.id} for ${payment.id} at ${formatPrice(unitPriceScaled)} ` +
      `(${[env.cbtc.id, env.beth.id].join(", ")} configured)`,
  );

  const client = new CantonClient(env.participants.participant1.jsonApi, "participant1");
  const result = await settleRealDvP({
    client,
    buyer,
    dealer,
    security,
    payment,
    unitPriceScaled,
    reference: `SHADOWDESK-DVP-V2-${Date.now()}`,
    log: (line) => console.log(line.replace(/^\[dvp\]/, "[dv2]")),
  });

  const fmt = (amount: bigint, decimals: number): string => formatTokenAmount(amount, decimals);
  console.log(
    `[dv2] settled ${fmt(result.securityAmount, security.decimals)} ${security.id} for ` +
      `${fmt(result.paymentAmount, payment.decimals)} ${payment.id}`,
  );
  console.log(`[dv2] final holdings dealer ${security.id}=${fmt(result.balances.dealerSecurity, security.decimals)}`);
  console.log(`[dv2] final holdings buyer ${security.id}=${fmt(result.balances.buyerSecurity, security.decimals)}`);
  console.log(`[dv2] final holdings buyer ${payment.id}=${fmt(result.balances.buyerPayment, payment.decimals)}`);
  console.log(`[dv2] final holdings dealer ${payment.id}=${fmt(result.balances.dealerPayment, payment.decimals)}`);
  console.log(`[dv2] receipt=${result.receiptCid.slice(0, 24)}... offset=${result.offset} events=${result.eventCount}`);

  console.log(`DVP V2 REAL ALLOCATION OK ref=${result.reference}`);
};

main().catch((e) => {
  console.error("DVP V2 REAL ALLOCATION FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
