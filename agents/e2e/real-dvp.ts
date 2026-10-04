import { CantonClient, envValue } from "../shared/client.js";
import { PARTICIPANTS, settlementEnvironment } from "../shared/config.js";
import {
  createDvpLegs,
  executeAllocationsAtomically,
  listAllocationLegs,
  listHoldings,
  type AllocationLegRequest,
} from "../shared/token-allocation.js";
import type { TokenInstrument } from "../shared/config.js";

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
  // The pair defaults to the intended product trade, but which instruments can
  // actually be allocated is a property of each registry: an instrument whose
  // AllocationFactory package is not installed on the signing participant cannot
  // be traded at all, so the pair is selectable to exercise an installable one.
  const securityInstrument = (envValue("SHADOWDESK_DVP_SECURITY_INSTRUMENT") ?? "CBTC").toUpperCase() === "BETH"
    ? beth
    : cbtc;
  const paymentInstrument = (envValue("SHADOWDESK_DVP_PAYMENT_INSTRUMENT") ?? "BETH").toUpperCase() === "BETH"
    ? beth
    : cbtc;
  const security: AllocationLegRequest = {
    instrument: securityInstrument,
    sender: required("SHADOWDESK_DVP_SECURITY_SENDER"),
    receiver: required("SHADOWDESK_DVP_SECURITY_RECIPIENT"),
    amount: required("SHADOWDESK_DVP_SECURITY_AMOUNT"),
    legId: "security",
  };
  const payment: AllocationLegRequest = {
    instrument: paymentInstrument,
    sender: required("SHADOWDESK_DVP_PAYMENT_SENDER"),
    receiver: required("SHADOWDESK_DVP_PAYMENT_RECIPIENT"),
    amount: required("SHADOWDESK_DVP_PAYMENT_AMOUNT"),
    legId: "payment",
  };
  const executor = envValue("SHADOWDESK_DVP_EXECUTOR") ?? parties.buyer;

  const total = async (party: string, instrument: TokenInstrument): Promise<number> =>
    (await listHoldings(client, party, instrument)).reduce((sum, h) => sum + Number(h.amount), 0);

  // Expected net change per party per instrument. When both legs settle in the
  // same instrument a party's send and receive cancel out, so the expectation has
  // to be the net rather than each leg in isolation.
  const sameInstrument =
    security.instrument.id === payment.instrument.id &&
    security.instrument.issuer === payment.instrument.issuer;
  const securityAmount = Number(security.amount);
  const paymentAmount = Number(payment.amount);

  const before = {
    securitySender: await total(security.sender, security.instrument),
    securityReceiver: await total(security.receiver, security.instrument),
    paymentSender: await total(payment.sender, payment.instrument),
    paymentReceiver: await total(payment.receiver, payment.instrument),
  };

  const legs = await createDvpLegs(client, { executor, settlementRef, security, payment });
  console.log(`[dvp] created ref=${settlementRef}`);
  console.log(`[dvp]   security ${partyLabel(security.sender)} -> ${partyLabel(security.receiver)} ${security.amount} ${security.instrument.id} cid=${legs.securityLegId.slice(0, 24)}...`);
  console.log(`[dvp]   payment  ${partyLabel(payment.sender)} -> ${partyLabel(payment.receiver)} ${payment.amount} ${payment.instrument.id} cid=${legs.paymentLegId.slice(0, 24)}...`);

  const listed = await listAllocationLegs(client, security.sender, settlementRef, {
    registryUrl: security.instrument.registryUrl,
    instrument: security.instrument,
  });
  const paymentListed = await listAllocationLegs(client, payment.sender, settlementRef, {
    registryUrl: payment.instrument.registryUrl,
    instrument: payment.instrument,
  });
  if (listed.length === 0 || paymentListed.length === 0) {
    throw new Error(
      `interface query did not find both legs under ${settlementRef}: security=${listed.length} payment=${paymentListed.length}`,
    );
  }
  console.log(`[dvp] interface query sees ${listed.length + paymentListed.length} legs before execution`);

  // Both parties can observe both allocations, so the two listings overlap and
  // must be de-duplicated: executing the same contract twice in one update fails
  // with CONTRACT_NOT_ACTIVE once the first execution consumes it.
  const allLegs = new Map<string, (typeof listed)[number]>();
  for (const leg of [...listed, ...paymentListed]) allLegs.set(leg.contractId, leg);
  const result = await executeAllocationsAtomically(client, [...allLegs.values()], { executor });
  console.log(`[dvp] both legs executed in one transaction (${result.eventCount} events)`);

  const after = {
    securitySender: await total(security.sender, security.instrument),
    securityReceiver: await total(security.receiver, security.instrument),
    paymentSender: await total(payment.sender, payment.instrument),
    paymentReceiver: await total(payment.receiver, payment.instrument),
  };

  // Expected change per party and instrument, accumulated from both legs. Deriving
  // it generically matters: in a same-instrument trade each party is typically the
  // sender of one leg and the receiver of the other, so the two amounts combine
  // into a net rather than appearing as separate movements.
  type Key = string;
  const keyOf = (party: string, instrument: TokenInstrument): Key => `${party}|${instrument.id}`;
  const expectedDeltas = new Map<Key, number>();
  const addDelta = (party: string, instrument: TokenInstrument, value: number): void => {
    const key = keyOf(party, instrument);
    expectedDeltas.set(key, (expectedDeltas.get(key) ?? 0) + value);
  };
  addDelta(security.sender, security.instrument, -securityAmount);
  addDelta(security.receiver, security.instrument, securityAmount);
  addDelta(payment.sender, payment.instrument, -paymentAmount);
  addDelta(payment.receiver, payment.instrument, paymentAmount);

  const observed = new Map<Key, number>();
  const observe = (party: string, instrument: TokenInstrument, was: number, now: number): void => {
    observed.set(keyOf(party, instrument), now - was);
  };
  observe(security.sender, security.instrument, before.securitySender, after.securitySender);
  observe(security.receiver, security.instrument, before.securityReceiver, after.securityReceiver);
  observe(payment.sender, payment.instrument, before.paymentSender, after.paymentSender);
  observe(payment.receiver, payment.instrument, before.paymentReceiver, after.paymentReceiver);

  // Holdings are summed from decimal strings, so the comparison is made with a
  // tolerance well below the instruments' smallest unit rather than for exact
  // float equality.
  const tolerance = 1e-9;
  const wrong = [...expectedDeltas.entries()].filter(([key, want]) => {
    const got = observed.get(key) ?? 0;
    return Math.abs(got - want) > tolerance;
  });
  if (wrong.length > 0) {
    throw new Error(
      `holdings did not move as the two legs require: ${wrong
        .map(([key, want]) => {
          const [party, instrument] = key.split("|");
          return `${partyLabel(party)} ${instrument} moved ${(observed.get(key) ?? 0).toFixed(10)}, expected ${want.toFixed(10)}`;
        })
        .join("; ")}`,
    );
  }
  console.log(`[dvp] holdings moved exactly as both legs require${sameInstrument ? " (net, single instrument)" : ""}`);

  await printHoldings(client);
  console.log(`DVP REAL ALLOCATION OK ref=${settlementRef}`);
};

main().catch((e) => {
  console.error("DVP REAL ALLOCATION FAILED:", e);
  process.exit(1);
});