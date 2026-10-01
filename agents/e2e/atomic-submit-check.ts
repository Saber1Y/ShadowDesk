import { CantonClient } from "../shared/client.js";
import { PACKAGE_ID, TPL } from "../shared/types.js";
import { PARTICIPANTS } from "../shared/config.js";
import { BuyerAgent } from "../buyer/buyer.js";

/**
 * Verifies the two CantonClient capabilities the real Token Standard DvP path
 * depends on, against whichever ledger the environment points at:
 *
 *  1. submitMany applies several commands in a single transaction, which is the
 *     atomicity guarantee both settlement legs rely on.
 *  2. queryByInterface builds an interface-filtered query the participant
 *     accepts, which is the only way to read registry holdings and allocations.
 *
 * Runs on localnet with no credentials, so it can gate the adapter before
 * anyone spends real tokens.
 */

const baseUrl = process.env.SHADOWDESK_LEDGER_URL ?? PARTICIPANTS.participant1.jsonApi;
const userId = process.env.SHADOWDESK_LEDGER_USER_ID ?? "shadowdesk-agent";

const main = async (): Promise<void> => {
  const buyer = new BuyerAgent(baseUrl, "participant1");
  const party = await buyer.provision();
  const client = new CantonClient(baseUrl, "participant1", userId);

  const ids = await client.packageIds();
  if (!ids.includes(PACKAGE_ID)) {
    throw new Error(`ledger does not have package ${PACKAGE_ID}; upload the current DAR first`);
  }
  console.log(`[atomic] ledger serves package ${PACKAGE_ID.slice(0, 16)}...`);

  const run = Date.now();
  const templateId = TPL.Asset;
  const build = (symbol: string, quantity: string) => ({
    CreateCommand: {
      templateId,
      createArguments: {
        holder: party,
        id: { issuer: "ShadowDesk", symbol },
        quantity,
        reference: `ATOMIC-${run}`,
      },
    },
  });

  const tx = await client.submitMany(
    [build("cUSDC", "1000000"), build("cTBILL", "1000000")],
    [party],
    { packageIdSelectionPreference: null },
    `atomic-multi-${run}`,
  );

  const created = (tx.transaction?.events ?? [])
    .map((event: any) => event.CreatedEvent)
    .filter(Boolean)
    .filter((event: any) => event.templateId?.endsWith(":ShadowDesk.Asset:Asset"));
  if (created.length !== 2) {
    throw new Error(`one submitMany transaction created ${created.length} contracts, expected 2`);
  }
  const offsets = new Set(created.map((event: any) => event.offset));
  if (offsets.size !== 1) {
    throw new Error(`the two contracts landed at different offsets ${[...offsets]}, so they were not one transaction`);
  }
  console.log(`[atomic] one transaction created ${created.length} contracts at offset ${[...offsets][0]}`);

  const holdings = await client.queryByInterface(
    party,
    "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding",
    await client.ledgerEnd(),
  );
  if (!Array.isArray(holdings)) throw new Error("queryByInterface did not return an array");
  console.log(`[atomic] interface query accepted, ${holdings.length} registry holdings visible`);

  console.log("ATOMIC SUBMIT OK");
};

main().catch((e) => {
  console.error("ATOMIC SUBMIT FAILED:", e);
  process.exit(1);
});