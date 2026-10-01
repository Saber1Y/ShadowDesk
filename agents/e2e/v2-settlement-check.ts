import { CantonClient, findCreatedByTemplate } from "../shared/client.js";
import { PARTICIPANTS, CBTC_DEVNET, BETH_DEVNET } from "../shared/config.js";
import { PACKAGE_ID_V2, TPL_V2, type Party } from "../shared/types.js";
import type { AllocationLeg } from "../shared/token-allocation.js";
import {
  createSettlementPlanV2,
  findReceiptV2,
  readSettlementPlanV2,
  settleV2,
  verifyLegAgainstAllocation,
} from "../shared/settlement-v2.js";

/**
 * Verifies the v2 settlement contract against a real ledger.
 *
 * SCOPE, stated plainly: this proves the v2 schema, the plan round-trip, the
 * receipt policy and the refusal paths on an actual Canton ledger. It does NOT
 * prove a registry delivery-versus-payment settlement. Localnet has no Token
 * Standard registry, so no real Allocation_ExecuteTransfer can run here, and
 * the allocation ids pinned below are placeholders. The registry legs are only
 * exercised by e2e/real-dvp.ts against DevNet.
 *
 * What it does assert about the legs:
 *  - settleV2 refuses to settle when the plan's allocations are not resolvable,
 *    so a plan can never be recorded against legs the agent made up.
 *  - verifyLegAgainstAllocation refuses a leg whose instrument, routing or
 *    amount disagrees with the plan, which is what stops leg substitution.
 */

const baseUrl = process.env.SHADOWDESK_LEDGER_URL ?? PARTICIPANTS.participant1.jsonApi;

const placeholderLeg = (
  role: "security" | "payment",
  instrument: { id: string; admin: string },
  sender: Party,
  receiver: Party,
  amount: string,
): AllocationLeg => ({
  contractId: `LOCALNET-PLACEHOLDER-${role.toUpperCase()}`,
  templateId: `#${PACKAGE_ID_V2}:ShadowDesk.V2.Settlement:SettlementPlan`,
  legId: role,
  instrumentId: instrument.id,
  admin: instrument.admin,
  sender,
  receiver,
  amount,
  registryUrl: CBTC_DEVNET.registryUrl,
});

const main = async (): Promise<void> => {
  const client = new CantonClient(baseUrl, "participant1", "shadowdesk-agent");
  const now = Date.now();
  const expiry = new Date(now + 24 * 3600 * 1000).toISOString();
  const suffix = String(now);

  const buyer = await client.ensureParty("v2buyer");
  const dealer = await client.ensureParty("v2dealer");
  const riskOfficer = await client.ensureParty("v2risk");
  console.log(`[v2] parties buyer=${buyer.slice(0, 18)}... dealer=${dealer.slice(0, 18)}...`);

  const cbtc = { id: CBTC_DEVNET.id, admin: CBTC_DEVNET.issuer };
  const beth = { id: BETH_DEVNET.id, admin: BETH_DEVNET.issuer };

  // Mandate -> approval -> RFQ -> proposal -> award, all in the v2 package.
  const mandateTx = await client.submitMany(
    [
      {
        CreateCommand: {
          templateId: TPL_V2.TreasuryMandate,
          createArguments: {
            buyer,
            riskOfficer,
            approvedDealers: [dealer],
            securityInstrument: cbtc,
            settlementInstrument: beth,
            maxAmount: "1000000",
            maxPrice: "101.0",
            reference: `MANDATE-V2-${suffix}`,
            expiry,
          },
        },
      },
    ],
    [buyer, riskOfficer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    `v2-mandate-${suffix}`,
  );
  const mandateCid = created(mandateTx, TPL_V2.TreasuryMandate);

  const approveTx = await client.submitMany(
    [exerciseCmd(TPL_V2.TreasuryMandate, mandateCid, "Approve")],
    [buyer, riskOfficer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    `v2-approve-${suffix}`,
  );
  const approvedCid = created(approveTx, TPL_V2.ApprovedMandate);

  const rfqTx = await client.submitMany(
    [
      {
        ExerciseCommand: {
          templateId: TPL_V2.ApprovedMandate,
          contractId: approvedCid,
          choice: "OpenRfq",
          choiceArgument: {
            dealers: [dealer],
            amount: "1000000",
            maxPrice: "101.0",
            reference: `RFQ-V2-${suffix}`,
            expiry,
          },
        },
      },
    ],
    [buyer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    `v2-rfq-${suffix}`,
  );
  const rfqCid = created(rfqTx, TPL_V2.BlockTradeRFQ);

  const proposalTx = await client.submitMany(
    [
      {
        ExerciseCommand: {
          templateId: TPL_V2.BlockTradeRFQ,
          contractId: rfqCid,
          choice: "SubmitQuoteProposal",
          choiceArgument: { dealer, offeredPrice: "100.5", bidId: "BID-V2-1" },
        },
      },
    ],
    [dealer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    `v2-proposal-${suffix}`,
  );
  const proposalCid = created(proposalTx, TPL_V2.QuoteProposal);

  const acceptTx = await client.submitMany(
    [
      {
        ExerciseCommand: {
          templateId: TPL_V2.QuoteProposal,
          contractId: proposalCid,
          choice: "AcceptProposal",
          choiceArgument: { maxPrice: "101.0" },
        },
      },
    ],
    [buyer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    `v2-accept-${suffix}`,
  );
  const sealedCid = created(acceptTx, TPL_V2.SealedQuote);
  console.log(`[v2] v2 award chain complete sealedQuote=${sealedCid.slice(0, 20)}...`);

  const quantity = "1000000";
  const unitPrice = "100.5";
  const reference = `SETTLE-V2-${suffix}`;

  // A plan whose payment leg under-funds the trade must be refused, and the
  // refusal must leave the plan usable rather than consuming it.
  const shortPlanCid = await createSettlementPlanV2(client, {
    buyer,
    dealer,
    executor: buyer,
    reference: `${reference}-SHORT`,
    sealedQuote: sealedCid,
    securityInstrument: CBTC_DEVNET,
    settlementInstrument: BETH_DEVNET,
    quantity,
    unitPrice,
    securityLeg: placeholderLeg("security", cbtc, dealer, buyer, quantity),
    paymentLeg: placeholderLeg("payment", beth, buyer, dealer, "1"),
    expiry,
  });
  await expectRejected(
    `underfunded payment leg`,
    client,
    TPL_V2.SettlementPlan,
    shortPlanCid,
    "Record",
    [buyer, dealer],
    suffix,
  );
  await readSettlementPlanV2(client, buyer, shortPlanCid);
  if (await findReceiptV2(client, buyer, `${reference}-SHORT`)) {
    throw new Error("a refused settlement still produced a receipt");
  }
  console.log("[v2] refused plan stayed active and produced no receipt");

  // settleV2 must refuse rather than record against placeholder allocations.
  let settleRefused = false;
  try {
    await settleV2(client, { buyer, dealer, executor: buyer, planContractId: shortPlanCid });
  } catch (e) {
    settleRefused = true;
    console.log(`[v2] settleV2 refused unresolvable legs: ${firstLine(e)}`);
  }
  if (!settleRefused) throw new Error("settleV2 settled against allocations that do not exist");
  if (await findReceiptV2(client, buyer, `${reference}-SHORT`)) {
    throw new Error("settleV2 produced a receipt despite refusing the legs");
  }

  // Leg substitution must be caught by the adapter's own cross-check.
  const ref = {
    role: "SecurityLeg" as const,
    allocationCid: "ALLOC-REAL",
    instrument: { id: CBTC_DEVNET.id, admin: CBTC_DEVNET.issuer },
    sender: dealer,
    receiver: buyer,
    amount: quantity,
  };
  const substitutions: Array<[string, Partial<AllocationLeg>]> = [
    ["a different instrument", { instrumentId: BETH_DEVNET.id }],
    ["a different admin", { admin: BETH_DEVNET.issuer }],
    ["a different sender", { sender: riskOfficer }],
    ["a different amount", { amount: "999" }],
  ];
  for (const [what, override] of substitutions) {
    const allocation: AllocationLeg = {
      contractId: ref.allocationCid,
      templateId: "t",
      legId: "security",
      instrumentId: ref.instrument.id,
      admin: ref.instrument.admin,
      sender: ref.sender,
      receiver: ref.receiver,
      amount: ref.amount,
      ...override,
    } as AllocationLeg;
    let threw = false;
    try {
      verifyLegAgainstAllocation(ref, allocation);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`leg substitution with ${what} was accepted`);
  }
  console.log(`[v2] leg substitution rejected for ${substitutions.map(([w]) => w).join(", ")}`);

  // The compliant plan records, and only the buyer can read the receipt.
  const goodPlanCid = await createSettlementPlanV2(client, {
    buyer,
    dealer,
    executor: buyer,
    reference,
    sealedQuote: sealedCid,
    securityInstrument: CBTC_DEVNET,
    settlementInstrument: BETH_DEVNET,
    quantity,
    unitPrice,
    securityLeg: placeholderLeg("security", cbtc, dealer, buyer, quantity),
    paymentLeg: placeholderLeg("payment", beth, buyer, dealer, String(Number(quantity) * Number(unitPrice))),
    expiry,
  });
  const onLedger = await readSettlementPlanV2(client, buyer, goodPlanCid);
  if (onLedger.securityLeg.role !== "SecurityLeg" || onLedger.paymentLeg.role !== "PaymentLeg") {
    throw new Error("ledger did not round-trip the leg roles");
  }
  if (onLedger.securityInstrument.id !== CBTC_DEVNET.id || onLedger.securityInstrument.admin !== CBTC_DEVNET.issuer) {
    throw new Error("ledger did not round-trip the instrument admin binding");
  }
  console.log("[v2] plan round-tripped with instrument id and admin bound");

  const recordTx = await client.submitMany(
    [exerciseCmd(TPL_V2.SettlementPlan, goodPlanCid, "Record")],
    [buyer, dealer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    `v2-record-${suffix}`,
  );
  const receiptCid = created(recordTx, TPL_V2.SettlementReceipt);
  const receipt = await findReceiptV2(client, buyer, reference);
  if (!receipt) throw new Error("buyer cannot read back the receipt it just recorded");
  if (receipt.securityAllocationCid !== onLedger.securityLeg.allocationCid) {
    throw new Error("receipt records a different security allocation than the plan pinned");
  }
  if (Number(receipt.totalValue) !== Number(quantity) * Number(unitPrice)) {
    throw new Error(`receipt totalValue ${receipt.totalValue} does not match quantity x price`);
  }
  if (receipt.sealedQuote !== sealedCid) throw new Error("receipt is not tied to the awarded quote");

  // A consumed plan cannot be recorded twice.
  await expectRejected(
    `second record of a consumed plan`,
    client,
    TPL_V2.SettlementPlan,
    goodPlanCid,
    "Record",
    [buyer, dealer],
    suffix,
  );
  const receipts = await client.queryActiveContracts(
    buyer,
    ["ShadowDesk.V2.Settlement:SettlementReceipt"],
    await client.ledgerEnd(),
  );
  const forThisRun = receipts.filter((r) => (r.createArgument as any).reference === reference);
  if (forThisRun.length !== 1) {
    throw new Error(`expected exactly one receipt for ${reference}, found ${forThisRun.length}`);
  }
  console.log(`[v2] recorded receipt=${receiptCid.slice(0, 20)}... exactly one, single-use enforced`);
  console.log("[v2] NOTE registry legs were NOT exercised; that requires DevNet (npm run e2e:real-dvp)");
  console.log("V2 SETTLEMENT CHECK OK");
};

const exerciseCmd = (templateId: string, contractId: string, choice: string, choiceArgument: unknown = {}) => ({
  ExerciseCommand: { templateId, contractId, choice, choiceArgument },
});

const created = (tx: any, templateId: string): string => {
  const found = findCreatedByTemplate(tx, templateId.replace("#shadowdesk-treasury-v2", ""));
  if (!found) throw new Error(`expected a ${templateId} created event`);
  return found.cid;
};

const firstLine = (e: unknown): string => String(e).split("\n")[0]!.slice(0, 120);

const expectRejected = async (
  what: string,
  client: CantonClient,
  templateId: string,
  contractId: string,
  choice: string,
  actAs: string[],
  suffix: string,
): Promise<void> => {
  try {
    await client.submitMany(
      [exerciseCmd(templateId, contractId, choice)],
      actAs,
      { packageIdSelectionPreference: [PACKAGE_ID_V2] },
      `v2-reject-${choice}-${suffix}`,
    );
  } catch (e) {
    console.log(`[v2] rejected ${what}: ${firstLine(e)}`);
    return;
  }
  throw new Error(`ledger accepted ${what}`);
};

main().catch((e) => {
  console.error("V2 SETTLEMENT CHECK FAILED:", e);
  process.exit(1);
});