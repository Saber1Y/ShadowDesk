import { randomUUID } from "node:crypto";
import { CantonError, type CantonClient } from "./client.js";
import { CBTC_DEVNET, type TokenInstrument } from "./config.js";

/**
 * Token Standard (CIP-56) allocation adapter.
 *
 * Everything here addresses contracts by registry interface id rather than by
 * a template in the ShadowDesk package, so it goes through the raw command and
 * interface-query paths on CantonClient.
 *
 * The registry itself is an unauthenticated HTTP service that mints the choice
 * contexts and tells the participant which contracts to disclose. ShadowDesk
 * never constructs that context itself.
 */

export const HOLDING_INTERFACE =
  "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
export const ALLOCATION_INTERFACE =
  "#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation";
export const ALLOCATION_FACTORY_INTERFACE =
  "#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationFactory";

/** Interface versions are negotiated, not assumed, so these are fallbacks. */
const FALLBACK_INTERFACES = {
  holding: HOLDING_INTERFACE,
  allocation: ALLOCATION_INTERFACE,
  allocationFactory: ALLOCATION_FACTORY_INTERFACE,
};

const ALLOCATION_TEMPLATE_SUFFIX = ":Utility.Registry.V0.Holding.Allocation:DvpLegAllocation";

export interface Holding {
  contractId: string;
  instrumentId: string;
  admin: string;
  amount: string;
}

export interface AllocationLeg {
  contractId: string;
  templateId: string;
  legId: string;
  instrumentId: string;
  admin: string;
  sender: string;
  receiver: string;
  amount: string;
  /** Registry base that mints this leg's transfer context. */
  registryUrl?: string;
}

export interface AllocationLegRequest {
  instrument: TokenInstrument;
  sender: string;
  receiver: string;
  amount: string;
  /** Stable label such as "security" or "payment" so a settlement reads clearly. */
  legId: string;
}

export interface DvpRequest {
  executor: string;
  settlementRef: string;
  security: AllocationLegRequest;
  payment: AllocationLegRequest;
  requestedAt?: string;
  allocateBeforeHours?: number;
  settleBeforeHours?: number;
}

const instrumentMatches = (view: any, instrument: TokenInstrument): boolean => {
  const id = view?.instrumentId;
  return Boolean(id) && id.id === instrument.id && id.admin === instrument.issuer;
};

/**
 * Call the token registry. It is a separate, unauthenticated service, so this
 * deliberately lives with the allocation adapter rather than on the ledger
 * client.
 */
const registryPost = async (registryUrl: string, path: string, body: unknown): Promise<any> => {
  const resp = await fetch(`${registryUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!resp.ok) throw new CantonError(resp.status, json, `POST ${path} failed`);
  return json;
};

/** All holdings of an instrument held by a party. */
export const listHoldings = async (
  client: CantonClient,
  party: string,
  instrument: TokenInstrument,
  holdingInterface = FALLBACK_INTERFACES.holding,
): Promise<Holding[]> => {
  const offset = await client.ledgerEnd();
  const rows = await client.queryByInterface(party, holdingInterface, offset);
  return rows
    .filter((row) => instrumentMatches(row.viewValue, instrument))
    .map((row) => ({
      contractId: row.contractId,
      instrumentId: row.viewValue.instrumentId.id,
      admin: row.viewValue.instrumentId.admin,
      amount: row.viewValue.amount,
    }));
};

/** The single holding an allocation leg will spend. Throws when absent. */
export const requireHolding = async (
  client: CantonClient,
  party: string,
  instrument: TokenInstrument,
  holdingInterface = FALLBACK_INTERFACES.holding,
): Promise<Holding> => {
  const holdings = await listHoldings(client, party, instrument, holdingInterface);
  const usable = holdings.filter((h) => Number(h.amount) > 0);
  if (usable.length === 0) {
    throw new Error(`${party} holds no ${instrument.id} to allocate`);
  }
  if (usable.length > 1) {
    throw new Error(
      `${party} holds ${usable.length} ${instrument.id} holdings; the adapter will not guess which to spend`,
    );
  }
  return usable[0]!;
};

const allocationBody = (
  request: AllocationLegRequest,
  settlement: Record<string, unknown>,
): Record<string, unknown> => ({
  settlement,
  transferLegId: request.legId,
  transferLeg: {
    sender: request.sender,
    receiver: request.receiver,
    amount: request.amount,
    instrumentId: { admin: request.instrument.issuer, id: request.instrument.id },
    meta: { values: {} },
  },
});

/**
 * Create one DvP allocation leg. The leg is created but not transferred: the
 * holder must still authorise the transfer, which is what makes settlement
 * revocable until both legs exist.
 */
export const createAllocationLeg = async (
  client: CantonClient,
  request: AllocationLegRequest,
  options: {
    executor: string;
    settlementRef: string;
    requestedAt: string;
    allocateBefore: string;
    settleBefore: string;
    allocationFactoryInterface?: string;
    holdingInterface?: string;
  },
): Promise<string> => {
  const holding = await requireHolding(client, request.sender, request.instrument, options.holdingInterface);
  const settlement = {
    executor: options.executor,
    settlementRef: { id: options.settlementRef },
    requestedAt: options.requestedAt,
    allocateBefore: options.allocateBefore,
    settleBefore: options.settleBefore,
    meta: { values: {} },
  };
  const allocation = allocationBody(request, settlement);
  const choiceArguments = {
    expectedAdmin: request.instrument.issuer,
    allocation,
    requestedAt: options.requestedAt,
    inputHoldingCids: [holding.contractId],
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  };

  const factory = await registryPost(
    request.instrument.registryUrl,
    `/api/token-standard/v0/registrars/${request.instrument.issuer}/registry/allocation-instruction/v1/allocation-factory`,
    { choiceArguments, excludeDebugFields: true },
  );

  const tx = await client.exerciseRaw(
    options.allocationFactoryInterface ?? FALLBACK_INTERFACES.allocationFactory,
    factory.factoryId,
    "AllocationFactory_Allocate",
    {
      ...choiceArguments,
      extraArgs: {
        context: factory.choiceContext.choiceContextData,
        meta: { values: {} },
      },
    },
    [request.sender],
    { disclosedContracts: factory.choiceContext.disclosedContracts },
    randomUUID(),
  );

  const created = (tx.transaction?.events ?? [])
    .map((event: any) => event.CreatedEvent)
    .find((event: any) => event?.templateId?.endsWith(ALLOCATION_TEMPLATE_SUFFIX));
  if (!created) {
    const seen = (tx.transaction?.events ?? [])
      .map((event: any) => event.CreatedEvent?.templateId)
      .filter(Boolean);
    throw new Error(
      `allocation leg ${request.legId} created no ${ALLOCATION_TEMPLATE_SUFFIX}; ledger created: ${seen.join(", ") || "nothing"}`,
    );
  }
  return created.contractId;
};

/** Both legs of a settlement reference, as seen by a party involved in it. */
export const listAllocationLegs = async (
  client: CantonClient,
  party: string,
  settlementRef: string,
  options: { allocationInterface?: string; registryUrl?: string } = {},
): Promise<AllocationLeg[]> => {
  const offset = await client.ledgerEnd();
  const rows = await client.queryByInterface(
    party,
    options.allocationInterface ?? FALLBACK_INTERFACES.allocation,
    offset,
    { includeCreatedEventBlob: true },
  );
  const legs: AllocationLeg[] = [];
  for (const row of rows) {
    const view = row.viewValue;
    const allocation = view?.allocation;
    if (allocation?.settlement?.settlementRef?.id !== settlementRef) continue;
    const leg = allocation.transferLeg;
    legs.push({
      contractId: row.contractId,
      templateId: row.templateId,
      legId: allocation.transferLegId,
      instrumentId: leg.instrumentId.id,
      admin: leg.instrumentId.admin,
      sender: leg.sender,
      receiver: leg.receiver,
      amount: leg.amount,
      registryUrl: options.registryUrl,
    });
  }
  return legs;
};

/**
 * Execute every leg of a settlement in one Ledger API transaction.
 *
 * All legs move together or none do, which is the atomicity property the whole
 * product rests on. Authorization must cover the executor plus every leg sender
 * and receiver: the registry mints a transfer context per leg and the holders
 * must each consent.
 */
export const executeAllocationsAtomically = async (
  client: CantonClient,
  legs: AllocationLeg[],
  options: { executor: string },
): Promise<{ eventCount: number }> => {
  if (legs.length === 0) throw new Error("no allocation legs to execute");

  const disclosedById = new Map<string, unknown>();
  const commands: unknown[] = [];
  for (const leg of legs) {
    const registryUrl = leg.registryUrl ?? process.env.SHADOWDESK_REGISTRY_URL ?? CBTC_DEVNET.registryUrl;
    if (!registryUrl) throw new Error(`no registry URL known for ${leg.instrumentId}`);
    const context = await registryPost(
      registryUrl,
      `/api/token-standard/v0/registrars/${leg.admin}/registry/allocations/v1/${leg.contractId}/choice-contexts/execute-transfer`,
      { meta: { values: "" } },
    );
    for (const contract of context.disclosedContracts ?? []) {
      disclosedById.set(contract.contractId, contract);
    }
    commands.push({
      ExerciseCommand: {
        templateId: leg.templateId,
        contractId: leg.contractId,
        choice: "Allocation_ExecuteTransfer",
        choiceArgument: {
          extraArgs: { context: context.choiceContextData, meta: { values: {} } },
        },
      },
    });
  }

  const actAs = Array.from(
    new Set([options.executor, ...legs.flatMap((leg) => [leg.sender, leg.receiver])]),
  );

  const tx = await client.submitMany(
    commands,
    actAs,
    { disclosedContracts: [...disclosedById.values()], packageIdSelectionPreference: null },
    randomUUID(),
  );
  return { eventCount: tx.transaction?.events?.length ?? 0 };
};

/** Convenience: create both legs of a settlement under one reference. */
export const createDvpLegs = async (
  client: CantonClient,
  request: DvpRequest,
): Promise<{ securityLegId: string; paymentLegId: string; settlementRef: string }> => {
  const now = new Date();
  const requestedAt = request.requestedAt ?? now.toISOString();
  const allocateBefore = new Date(
    now.getTime() + (request.allocateBeforeHours ?? 24) * 3600 * 1000,
  ).toISOString();
  const settleBefore = new Date(
    now.getTime() + (request.settleBeforeHours ?? 48) * 3600 * 1000,
  ).toISOString();

  const securityLegId = await createAllocationLeg(client, request.security, {
    executor: request.executor,
    settlementRef: request.settlementRef,
    requestedAt,
    allocateBefore,
    settleBefore,
  });
  const paymentLegId = await createAllocationLeg(client, request.payment, {
    executor: request.executor,
    settlementRef: request.settlementRef,
    requestedAt,
    allocateBefore,
    settleBefore,
  });
  return { securityLegId, paymentLegId, settlementRef: request.settlementRef };
};