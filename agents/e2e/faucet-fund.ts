/**
 * Fund the settlement parties from the BitSafe DevNet faucet.
 *
 * Holdings are read first and only the shortfall is requested, because the
 * faucet mints on every call and repeating a claim would inflate the balances
 * that the settlement assertions depend on. Both registry API versions are
 * searched, since a holding minted by a current registry is a v2 contract and
 * a v1-only query reports a funded party as empty.
 *
 * Run through the credential loader so the holdings read is authenticated:
 *   scripts/env/with-devnet-auth.sh npm run faucet:fund
 */

import { CantonClient } from "../shared/client.js";
import {
  CBTC_DEVNET,
  BETH_DEVNET,
  settlementEnvironment,
  type TokenInstrument,
} from "../shared/config.js";
import { listHoldings } from "../shared/token-allocation.js";
import { getFaucetToken, requestFaucetTransfer } from "../shared/faucet.js";

const FAUCET_API_URL =
  process.env.SHADOWDESK_FAUCET_API_URL ?? "https://cbtc-faucet.devnet.bitsafe.finance/api";

/** The smallest claim the faucet will make, so topping up stays cheap. */
const TOP_UP = { cbtc: "0.01", beth: "0.02" } as const;

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to fund the settlement parties`);
  return value;
};

const heldBaseUnits = async (
  client: CantonClient,
  party: string,
  instrument: TokenInstrument,
): Promise<bigint> => {
  const holdings = await listHoldings(client, party, instrument);
  return holdings.reduce((sum, holding) => sum + BigInt(holding.amount.replace(/\.\d+$/, "")), 0n);
};

const main = async (): Promise<void> => {
  const environment = settlementEnvironment();
  if (environment.network !== "devnet") {
    throw new Error("the faucet only exists on DevNet; set SHADOWDESK_NETWORK=devnet");
  }

  const buyer = requiredEnv("SHADOWDESK_BUYER_PARTY");
  const dealer = requiredEnv("SHADOWDESK_DEALER_A_PARTY");
  const targets = [
    { party: dealer, role: "dealerA", token: "cbtc", instrument: CBTC_DEVNET },
    { party: buyer, role: "buyer", token: "beth", instrument: BETH_DEVNET },
  ] as const;

  const client = new CantonClient(environment.participants.participant1.jsonApi, "participant1");

  for (const target of targets) {
    const spec = await getFaucetToken(FAUCET_API_URL, environment.network, target.token);
    if (spec.instrument_id.admin !== target.instrument.issuer) {
      throw new Error(
        `faucet ${target.token} is ${spec.instrument_id.admin} but the settlement config expects ${target.instrument.issuer}`,
      );
    }

    const held = await heldBaseUnits(client, target.party, target.instrument);
    const scale = 10n ** BigInt(target.instrument.decimals);
    const heldDecimal = Number(held) / Number(scale);
    console.log(
      `[faucet] ${target.role} holds ${heldDecimal.toFixed(target.instrument.decimals)} ${target.token.toUpperCase()}`,
    );

    if (held > 0n) {
      console.log(`[faucet] ${target.role} already funded; skipping to avoid inflating balances`);
      continue;
    }

    const amount = TOP_UP[target.token as keyof typeof TOP_UP];
    const result = await requestFaucetTransfer({
      apiUrl: FAUCET_API_URL,
      network: environment.network,
      token: target.token,
      recipientParty: target.party,
      amount,
    });
    console.log(`[faucet] ${target.role} <- ${amount} ${target.token.toUpperCase()}: ${result.message ?? "accepted"}`);
  }

  console.log("[faucet] done; re-read holdings to confirm the transfers settled");
};

main().catch((error: unknown) => {
  console.error(`FAUCET FUNDING FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});