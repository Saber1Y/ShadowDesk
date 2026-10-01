import { CantonClient, envValue } from "../shared/client.js";
import { PARTICIPANTS, settlementEnvironment } from "../shared/config.js";
import {
  createDvpLegs,
  executeAllocationsAtomically,
  listAllocationLegs,
  listHoldings,
  type AllocationLegRequest,
} from "../shared/token-allocation.js";

/**
 * Real Token Standard (CIP-56) delivery-versus-payment check.
 *
 * This exercises registry holdings and allocation contracts rather than the
 * ShadowDesk synthetic Asset contracts used by the award-chain check. It only
 * works on DevNet, because the registry and its instruments do not exist on
 * the local sandbox.
 *
 * Everything is read from the environment so no credentials or machine-specific
 * paths are baked into the repository.
 */

const network = settlementEnvironment().network;
if (network !== "devnet") {
  throw new Error(
    "real DvP needs SHADOWDESK_NETWORK=devnet; the local sandbox has no token registry. " +
      "Load the ignored DevNet profile first: source scripts/env/use-profile.sh devnet",
  );
}

const baseUrl = envValue("SHADOWDESK_LEDGER_URL") ?? PARTICIPANTS.participant1.jsonApi;
const required = (name: string): string => {
  const value = envValue(name);
  if (!value) throw new Error(`${name} is required for the real DvP check`);
  return value;
};

const parties = {
  buyer: required("SHADOWDESK_BUYER_PARTY"),
  dealerA: required("SHADOWDESK_DEALER_A_PARTY"),
  dealerB: required("SHADOWDESK_DEALER_B_PARTY"),
};

const { cbtc, beth } = settlementEnvironment();

const partyLabel = (party: string): string => {
  if (party === parties.buyer) return "buyer";
  if (party === parties.dealerA) return "dealerA";
  if (party === parties.dealerB) return "dealerB";
  return party.slice(0, 18);
};

const printHoldings = async (client: CantonClient): Promise<void> => {
  for (const [role, party] of Object.entries(parties)) {
    for (const instrument of [cbtc, beth]) {
      const holdings = await listHoldings(client, party, instrument);
      const total = holdings.reduce((sum, h) => sum + Number(h.amount), 0);
      console.log(
        `[dvp] ${role.padEnd(8)} ${instrument.id.padEnd(5)} holdings=${holdings.length} total=${total}`,
      );
    }
  }
};

const main = async (): Promise<void> => {
  const client = new CantonClient(baseUrl, "participant1");
  const holdingsOnly = process.argv.includes("--holdings");

  await printHoldings(client);
  if (holdingsOnly) {
    console.log("DVP HOLDINGS OK");
    return;
  }

  const settlementRef = `SHADOWDESK-DVP-${Date.now()}`;
  const security: AllocationLegRequest = {
    instrument: cbtc,
    sender: required("SHADOWDESK_DVP_SECURITY_SENDER"),
    receiver: required("SHADOWDESK_DVP_SECURITY_RECIPIENT"),
    amount: required("SHADOWDESK_DVP_SECURITY_AMOUNT"),
    legId: "security",
  };
  const payment: AllocationLegRequest = {
    instrument: beth,
    sender: required("SHADOWDESK_DVP_PAYMENT_SENDER"),
    receiver: required("SHADOWDESK_DVP_PAYMENT_RECIPIENT"),
    amount: required("SHADOWDESK_DVP_PAYMENT_AMOUNT"),
    legId: "payment",
  };
  const executor = envValue("SHADOWDESK_DVP_EXECUTOR") ?? parties.buyer;

  const before = {
    securitySender: (await listHoldings(client, security.sender, security.instrument)).reduce(
      (sum, h) => sum + Number(h.amount),
      0,
    ),
    paymentSender: (await listHoldings(client, payment.sender, payment.instrument)).reduce(
      (sum, h) => sum + Number(h.amount),
      0,
    ),
  };

  const legs = await createDvpLegs(client, { executor, settlementRef, security, payment });
  console.log(`[dvp] created ref=${settlementRef}`);
  console.log(`[dvp]   security ${partyLabel(security.sender)} -> ${partyLabel(security.receiver)} ${security.amount} ${security.instrument.id} cid=${legs.securityLegId.slice(0, 24)}...`);
  console.log(`[dvp]   payment  ${partyLabel(payment.sender)} -> ${partyLabel(payment.receiver)} ${payment.amount} ${payment.instrument.id} cid=${legs.paymentLegId.slice(0, 24)}...`);

  const listed = await listAllocationLegs(client, security.sender, settlementRef, {
    registryUrl: cbtc.registryUrl,
  });
  const paymentListed = await listAllocationLegs(client, payment.sender, settlementRef, {
    registryUrl: beth.registryUrl,
  });
  if (listed.length === 0 || paymentListed.length === 0) {
    throw new Error(
      `interface query did not find both legs under ${settlementRef}: security=${listed.length} payment=${paymentListed.length}`,
    );
  }
  console.log(`[dvp] interface query sees ${listed.length + paymentListed.length} legs before execution`);

  const result = await executeAllocationsAtomically(client, [...listed, ...paymentListed], { executor });
  console.log(`[dvp] both legs executed in one transaction (${result.eventCount} events)`);

  const afterSecuritySender = (await listHoldings(client, security.sender, security.instrument)).reduce(
    (sum, h) => sum + Number(h.amount),
    0,
  );
  const afterPaymentSender = (await listHoldings(client, payment.sender, payment.instrument)).reduce(
    (sum, h) => sum + Number(h.amount),
    0,
  );
  const dropped = before.securitySender - afterSecuritySender === Number(security.amount)
    && before.paymentSender - afterPaymentSender === Number(payment.amount);
  if (!dropped) {
    throw new Error(
      `holdings did not move by the allocated amounts: security ${before.securitySender} -> ${afterSecuritySender}, payment ${before.paymentSender} -> ${afterPaymentSender}`,
    );
  }
  console.log(`[dvp] holdings moved by both leg amounts`);

  await printHoldings(client);
  console.log(`DVP REAL ALLOCATION OK ref=${settlementRef}`);
};

main().catch((e) => {
  console.error("DVP REAL ALLOCATION FAILED:", e);
  process.exit(1);
});