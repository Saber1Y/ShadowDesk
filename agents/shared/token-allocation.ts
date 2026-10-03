import { randomUUID } from "node:crypto";
import { CantonError, envValue, type CantonClient } from "./client.js";
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

export const HOLDING_INTERFACE_V2 =
  "#splice-api-token-holding-v2:Splice.Api.Token.HoldingV2:Holding";
export const ALLOCATION_INTERFACE_V2 =
  "#splice-api-token-allocation-v2:Splice.Api.Token.AllocationV2:Allocation";
export const ALLOCATION_FACTORY_INTERFACE_V2 =
  "#splice-api-token-allocation-instruction-v2:Splice.Api.Token.AllocationInstructionV2:AllocationFactory";

/** Interface versions are negotiated, not assumed, so these are fallbacks. */
const FALLBACK_INTERFACES = {
  holding: HOLDING_INTERFACE,
  allocation: ALLOCATION_INTERFACE,
  allocationFactory: ALLOCATION_FACTORY_INTERFACE,
};

type InterfaceKind = keyof typeof FALLBACK_INTERFACES;

/** Newest registry version first, because that is what a current registry mints. */
const INTERFACES_BY_KIND: Record<InterfaceKind, ReadonlyArray<readonly [string, string]>> = {
  holding: [
    ["splice-api-token-holding-v2", HOLDING_INTERFACE_V2],
    ["splice-api-token-holding-v1", HOLDING_INTERFACE],
  ],
  allocation: [
    ["splice-api-token-allocation-v2", ALLOCATION_INTERFACE_V2],
    ["splice-api-token-allocation-v1", ALLOCATION_INTERFACE],
  ],
  allocationFactory: [
    ["splice-api-token-allocation-instruction-v2", ALLOCATION_FACTORY_INTERFACE_V2],
    ["splice-api-token-allocation-instruction-v1", ALLOCATION_FACTORY_INTERFACE],
  ],
};

/**
 * Interfaces to query for an instrument, newest registry version first.
 *
 * An instrument advertises every API version it supports, and a party can hold
 * contracts from more than one of them, so reading only one version reports a
 * funded party as empty. The registry is the only authority on which versions
 * exist for a given instrument, so these come from its advertised
 * `supportedApis` rather than a hardcoded assumption.
 */
export const interfacesForInstrument = (
  instrument: TokenInstrument,
  kind: InterfaceKind,
): string[] => {
  const resolved = INTERFACES_BY_KIND[kind]
    .filter(([api]) => instrument.supportedApis.includes(api))
    .map(([, iface]) => iface);
  return resolved.length > 0 ? resolved : [FALLBACK_INTERFACES[kind]];
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
 * Call the token registry.
 *
 * On DevNet the registry is authenticated with the same bearer token as the
 * Ledger API, and the `daml_ledger_api` scope covers it. A choice-context call
 * is made on behalf of the instrument admin, so an unauthenticated request is
 * rejected before it can reveal whether the allocation exists.
 */
const registryPost = async (registryUrl: string, path: string, body: unknown): Promise<any> => {
  const accessToken = envValue("SHADOWDESK_CANTON_ACCESS_TOKEN");
  const resp = await fetch(`${registryUrl.replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!resp.ok) {
    if (resp.status === 401 || resp.status === 403) {
      throw new CantonError(
        resp.status,
        json,
        `registry rejected the caller on ${path}. ` +
          (accessToken
            ? "The token is present but is not authorized to act as this instrument's admin. " +
              "Minting an execute-transfer choice context runs as the registrar, so the login must be able to act as the admin party."
            : "No SHADOWDESK_CANTON_ACCESS_TOKEN was sent. Use scripts/env/with-devnet-auth.sh to run against DevNet."),
      );
    }
    throw new CantonError(resp.status, json, `POST ${path} failed`);
  }
  return json;
};

/** All holdings of an instrument held by a party, across every API version. */
export const listHoldings = async (
  client: CantonClient,
  party: string,
  instrument: TokenInstrument,
  holdingInterface?: string,
): Promise<Holding[]> => {
  const offset = await client.ledgerEnd();
  const interfaces = holdingInterface
    ? [holdingInterface]
    : interfacesForInstrument(instrument, "holding");

  const byContract = new Map<string, Holding>();
  for (const iface of interfaces) {
    const rows = await client.queryByInterface(party, iface, offset);
    for (const row of rows) {
      if (!instrumentMatches(row.viewValue, instrument)) continue;
      byContract.set(row.contractId, {
        contractId: row.contractId,
        instrumentId: row.viewValue.instrumentId.id,
        admin: row.viewValue.instrumentId.admin,
        amount: row.viewValue.amount,
      });
    }
  }
  return [...byContract.values()];
};

/** The single holding an allocation leg will spend. Throws when absent. */
export const requireHolding = async (
  client: CantonClient,
  party: string,
  instrument: TokenInstrument,
  holdingInterface?: string,
): Promise<Holding> => {
  const holdings = await listHoldings(client, party, instrument, holdingInterface);
  const usable = holdings.filter((h) => Number(h.amount) > 0);
  if (usable.length === 0) {
    throw new Error(
      `${party} holds no ${instrument.id} to allocate; searched ${instrument.supportedApis.filter((a) => a.startsWith("splice-api-token-holding-")).join(", ") || "no advertised holding API"}`,
    );
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

  const factoryInterfaces = options.allocationFactoryInterface
    ? [options.allocationFactoryInterface]
    : interfacesForInstrument(request.instrument, "allocationFactory");

  let tx: Awaited<ReturnType<CantonClient["exerciseRaw"]>> | undefined;
  let lastError: unknown;
  for (const iface of factoryInterfaces) {
    try {
      tx = await client.exerciseRaw(
        iface,
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
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!tx) {
    throw new Error(
      `allocation leg ${request.legId} could not exercise AllocationFactory_Allocate over ${factoryInterfaces.join(", ")}: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }

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
  options: { allocationInterface?: string; registryUrl?: string; instrument?: TokenInstrument } = {},
): Promise<AllocationLeg[]> => {
  const offset = await client.ledgerEnd();
  const interfaces = options.allocationInterface
    ? [options.allocationInterface]
    : options.instrument
      ? interfacesForInstrument(options.instrument, "allocation")
      : [FALLBACK_INTERFACES.allocation];

  const legs = new Map<string, AllocationLeg>();
  for (const iface of interfaces) {
    const rows = await client.queryByInterface(party, iface, offset, {
      includeCreatedEventBlob: true,
    });
    for (const row of rows) {
      if (legs.has(row.contractId)) continue;
      const view = row.viewValue;
      const allocation = view?.allocation;
      if (allocation?.settlement?.settlementRef?.id !== settlementRef) continue;
      const leg = allocation.transferLeg;
      legs.set(row.contractId, {
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
  }
  return [...legs.values()];
};

/**
 * Ask the registry to mint a transfer context for each leg and build the
 * matching ExerciseCommand list.
 *
 * This is separated from submission because a real settlement has to commit
 * these commands in the same transaction as the ShadowDesk receipt, and the
 * receipt command comes from a different package. Daml cannot observe a
 * registry transfer, so the shared transaction is the whole atomicity argument.
 */
export const buildAllocationTransferCommands = async (
  legs: AllocationLeg[],
  options: { executor: string },
): Promise<{ commands: unknown[]; disclosedContracts: unknown[]; actAs: string[] }> => {
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

  return { commands, disclosedContracts: [...disclosedById.values()], actAs };
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
  const { commands, disclosedContracts, actAs } = await buildAllocationTransferCommands(legs, options);

  const tx = await client.submitMany(
    commands,
    actAs,
    { disclosedContracts, packageIdSelectionPreference: null },
    randomUUID(),
  );
  return { eventCount: tx.transaction?.events?.length ?? 0 };
};

/**
 * Look up specific allocation contracts by id, across every party that can see
 * them.
 *
 * A settlement must execute the exact allocations its plan pinned. Resolving
 * them by id rather than trusting a caller's list is what prevents the agent
 * from substituting a different leg at execution time.
 */
export const findAllocationLegsByCid = async (
  client: CantonClient,
  parties: string[],
  contractIds: string[],
  options: {
    allocationInterface?: string;
    registryUrl?: string;
    instrument?: TokenInstrument;
  } = {},
): Promise<Map<string, AllocationLeg>> => {
  const wanted = new Set(contractIds);
  if (wanted.size === 0) return new Map();

  const offset = await client.ledgerEnd();
  const interfaces = options.allocationInterface
    ? [options.allocationInterface]
    : options.instrument
      ? interfacesForInstrument(options.instrument, "allocation")
      : [FALLBACK_INTERFACES.allocation];

  const found = new Map<string, AllocationLeg>();
  for (const party of parties) {
    for (const iface of interfaces) {
      const rows = await client.queryByInterface(party, iface, offset, {
        includeCreatedEventBlob: true,
      });
      for (const row of rows) {
        if (!wanted.has(row.contractId) || found.has(row.contractId)) continue;
        const allocation = (row.viewValue as any)?.allocation;
        const leg = allocation?.transferLeg;
        if (!leg) continue;
        found.set(row.contractId, {
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
    }
  }
  return found;
};

/**
 * Convenience: create both legs of a settlement under one reference.
 */
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