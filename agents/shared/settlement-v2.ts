import { randomUUID } from "node:crypto";
import { CantonClient, findCreatedByTemplate } from "./client.js";
import type { TokenInstrument } from "./config.js";
import {
  buildAllocationTransferCommands,
  findAllocationLegsByCid,
  type AllocationLeg,
} from "./token-allocation.js";
import {
  PACKAGE_ID_V2,
  TPL_V2,
  type AllocationLegRef,
  type Party,
  type RegistryInstrumentId,
  type SettlementPlanV2,
  type SettlementReceiptV2,
} from "./types.js";

/**
 * V2 settlement: mandate-governed delivery versus payment over real Token
 * Standard instruments.
 *
 * The pipeline is deliberately split into three steps:
 *
 * 1. Both registry allocations are created. They move nothing yet; each holder
 *    still has to authorise its leg.
 * 2. The ShadowDesk SettlementPlan is created, pinning both allocation ids.
 * 3. Both Allocation_ExecuteTransfer exercises and the SettlementPlan Record
 *    exercise are submitted as one Ledger API update.
 *
 * Only step 3 settles anything. Daml cannot fetch a registry allocation, so
 * Record revalidates what it can (instruments, parties, amounts, the awarded
 * quote, the approved mandate) and the shared transaction guarantees that a
 * receipt never exists unless both legs moved. If either leg fails the whole
 * update is rejected and no receipt is created.
 *
 * The plan, not the caller, decides which allocations run. settleV2 re-reads
 * the plan from the ledger and resolves its allocation ids before executing, so
 * an agent bug cannot substitute a leg the buyer and dealer never approved.
 */

/** The registry instrument pair that Daml records and the registry validates. */
export const registryInstrument = (instrument: TokenInstrument): RegistryInstrumentId => ({
  id: instrument.id,
  admin: instrument.issuer,
});

const asDecimal = (value: string): number => Number(value);

/** Daml Decimals travel as JSON strings, so keep both sides textual. */
const assertSameAmount = (expected: string, actual: string, what: string): void => {
  if (asDecimal(expected) !== asDecimal(actual)) {
    throw new Error(`${what} mismatch: plan says ${expected}, allocation says ${actual}`);
  }
};

export interface CreateSettlementPlanRequest {
  buyer: Party;
  dealer: Party;
  executor: Party;
  reference: string;
  sealedQuote: string;
  securityInstrument: TokenInstrument;
  settlementInstrument: TokenInstrument;
  quantity: string;
  unitPrice: string;
  securityLeg: AllocationLeg;
  paymentLeg: AllocationLeg;
  expiry: string;
}

const legRef = (role: AllocationLegRef["role"], leg: AllocationLeg): AllocationLegRef => ({
  role,
  allocationCid: leg.contractId,
  // Taken from the allocation the registry actually created rather than from
  // the request, so the plan cannot disagree with the leg it pins.
  instrument: { id: leg.instrumentId, admin: leg.admin },
  sender: leg.sender,
  receiver: leg.receiver,
  amount: leg.amount,
});

/**
 * Create the plan that authorizes the settlement. Creating a plan moves no
 * tokens: it records which two allocations will run so the buyer and dealer can
 * check the shape of the trade before anything becomes irreversible.
 */
export const createSettlementPlanV2 = async (
  client: CantonClient,
  request: CreateSettlementPlanRequest,
): Promise<string> => {
  const securityLeg = legRef("SecurityLeg", request.securityLeg);
  const paymentLeg = legRef("PaymentLeg", request.paymentLeg);

  if (securityLeg.allocationCid === paymentLeg.allocationCid) {
    throw new Error("security and payment legs must not reference the same allocation");
  }

  const tx = await client.submitMany(
    [
      {
        CreateCommand: {
          templateId: TPL_V2.SettlementPlan,
          createArguments: {
            reference: request.reference,
            buyer: request.buyer,
            dealer: request.dealer,
            executor: request.executor,
            securityInstrument: registryInstrument(request.securityInstrument),
            settlementInstrument: registryInstrument(request.settlementInstrument),
            quantity: request.quantity,
            unitPrice: request.unitPrice,
            securityLeg,
            paymentLeg,
            sealedQuote: request.sealedQuote,
            expiry: request.expiry,
          },
        },
      },
    ],
    [request.buyer, request.dealer],
    { packageIdSelectionPreference: [PACKAGE_ID_V2] },
    randomUUID(),
  );

  const created = findCreatedByTemplate(tx, ":ShadowDesk.V2.Settlement:SettlementPlan");
  if (!created) throw new Error("settlement plan was not created");
  return created.cid;
};

/** Read a plan the given party can see. Signatories are buyer and dealer. */
export const readSettlementPlanV2 = async (
  client: CantonClient,
  party: Party,
  planContractId: string,
): Promise<SettlementPlanV2> => {
  const offset = await client.ledgerEnd();
  const rows = await client.queryActiveContracts(
    party,
    ["ShadowDesk.V2.Settlement:SettlementPlan"],
    offset,
  );
  const row = rows.find((r) => r.contractId === planContractId);
  if (!row) {
    throw new Error(`settlement plan ${planContractId} is not visible to ${party}`);
  }
  return row.createArgument as unknown as SettlementPlanV2;
};

/**
 * Confirm a plan's leg reference and the real registry allocation agree.
 *
 * Daml cannot do this: the allocation lives in the registry package. Doing it
 * here means Record's assertions are the second line of defence rather than the
 * only one.
 */
export const verifyLegAgainstAllocation = (
  ref: AllocationLegRef,
  allocation: AllocationLeg,
): void => {
  if (allocation.instrumentId !== ref.instrument.id) {
    throw new Error(
      `${ref.role} allocation ${allocation.contractId} trades ${allocation.instrumentId}, plan says ${ref.instrument.id}`,
    );
  }
  if (allocation.admin !== ref.instrument.admin) {
    throw new Error(
      `${ref.role} allocation ${allocation.contractId} admin mismatch: ${allocation.admin} vs ${ref.instrument.admin}`,
    );
  }
  if (allocation.sender !== ref.sender || allocation.receiver !== ref.receiver) {
    throw new Error(
      `${ref.role} allocation ${allocation.contractId} routes ${allocation.sender} -> ${allocation.receiver}, plan says ${ref.sender} -> ${ref.receiver}`,
    );
  }
  assertSameAmount(ref.amount, allocation.amount, `${ref.role} amount`);
};

export interface SettleV2Result {
  offset: number;
  eventCount: number;
  receiptContractId: string;
  legs: AllocationLeg[];
}

/**
 * Settle: move both registry legs and record the ShadowDesk receipt in one
 * transaction.
 *
 * The legs are resolved from the plan rather than supplied, then the Record
 * exercise is appended to the same update. This is the only step that can
 * produce a receipt.
 */
export const settleV2 = async (
  client: CantonClient,
  request: {
    buyer: Party;
    dealer: Party;
    executor: Party;
    planContractId: string;
    registryUrl?: string;
  },
): Promise<SettleV2Result> => {
  const plan = await readSettlementPlanV2(client, request.buyer, request.planContractId);
  if (plan.buyer !== request.buyer || plan.dealer !== request.dealer) {
    throw new Error("plan parties do not match the requested settlement parties");
  }

  const refs = [plan.securityLeg, plan.paymentLeg];
  const found = await findAllocationLegsByCid(
    client,
    [request.buyer, request.dealer, request.executor],
    refs.map((ref) => ref.allocationCid),
    { registryUrl: request.registryUrl },
  );

  const legs: AllocationLeg[] = [];
  for (const ref of refs) {
    const allocation = found.get(ref.allocationCid);
    if (!allocation) {
      throw new Error(
        `allocation ${ref.allocationCid} pinned by the plan is not visible to any settlement party`,
      );
    }
    verifyLegAgainstAllocation(ref, allocation);
    legs.push(allocation);
  }

  const { commands, disclosedContracts, actAs } = await buildAllocationTransferCommands(legs, {
    executor: request.executor,
  });

  const recordCommand = {
    ExerciseCommand: {
      templateId: TPL_V2.SettlementPlan,
      contractId: request.planContractId,
      choice: "Record",
      choiceArgument: {},
    },
  };

  const tx = await client.submitMany(
    [...commands, recordCommand],
    // Record is controlled by buyer and dealer, and the registry needs every
    // leg holder to consent, so authorization spans all of them.
    Array.from(new Set([...actAs, request.buyer, request.dealer])),
    {
      disclosedContracts,
      // These commands resolve registry allocation templates as well as v2
      // templates, so the preference must stay unset. Pinning a single package
      // here is exactly what stops the registry templates from resolving.
      packageIdSelectionPreference: null,
    },
    randomUUID(),
  );

  const events = tx.transaction?.events ?? [];
  const receipt = findCreatedByTemplate(tx, ":ShadowDesk.V2.Settlement:SettlementReceipt");
  if (!receipt) {
    const seen = events
      .map((event: any) => event.CreatedEvent?.templateId)
      .filter(Boolean);
    throw new Error(`settlement committed without a receipt; created: ${seen.join(", ") || "nothing"}`);
  }

  return {
    offset: tx.transaction?.offset ?? -1,
    eventCount: events.length,
    receiptContractId: receipt.cid,
    legs,
  };
};

/**
 * Read back the receipt the buyer can see.
 *
 * The receipt signs only for the buyer, so this is the authoritative check that
 * a settlement recorded the allocations it claimed to execute.
 */
export const findReceiptV2 = async (
  client: CantonClient,
  buyer: Party,
  reference: string,
): Promise<SettlementReceiptV2 | null> => {
  const offset = await client.ledgerEnd();
  const rows = await client.queryActiveContracts(
    buyer,
    ["ShadowDesk.V2.Settlement:SettlementReceipt"],
    offset,
  );
  for (const row of rows) {
    const arg = row.createArgument as unknown as SettlementReceiptV2;
    if (arg.reference === reference) return arg;
  }
  return null;
};