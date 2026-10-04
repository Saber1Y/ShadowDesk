import { randomUUID } from "node:crypto";
import { CantonError, envValue, type CantonClient } from "./client.js";
import { CBTC_DEVNET, type TokenInstrument } from "./config.js";

const sleep = (ms: number): Promise<void> => new Promise((res) => setTimeout(res, ms));

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

/**
 * The accept path for a faucet transfer offer.
 *
 * app-v0 >= 0.6.0 replaced the direct `TransferOffer_Accept` choice with a
 * `TransferInstructionV1.TransferInstruction` interface instance, so the offer
 * has no choice of its own to exercise. Addressing the interface instead of the
 * template is what the registry expects; the legacy choice name now fails with
 * "Invalid template ... or choice:TransferOffer_Accept".
 */
export const TRANSFER_INSTRUCTION_INTERFACE =
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";

export const TRANSFER_INSTRUCTION_INTERFACE_V2 =
  "#splice-api-token-transfer-instruction-v2:Splice.Api.Token.TransferInstructionV2:TransferInstruction";

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
  transferInstruction: TRANSFER_INSTRUCTION_INTERFACE,
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
  transferInstruction: [
    ["splice-api-token-transfer-instruction-v2", TRANSFER_INSTRUCTION_INTERFACE_V2],
    ["splice-api-token-transfer-instruction-v1", TRANSFER_INSTRUCTION_INTERFACE],
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

/**
 * Interface references for the registry's allocation choices.
 *
 * The registry's concrete allocation template exposes neither
 * `Allocation_ExecuteTransfer` nor `Allocation_Cancel` directly, so choices are
 * only reachable through an interface reference. The choice names and arguments
 * differ per interface: `ExecuteTransfer` lives on the V1 interface and takes no
 * `actors` field, while `Cancel` lives on the V2 interface and requires the
 * acting parties in `actors`. Measured against the DevNet registry.
 */
const ALLOCATION_INTERFACE_V1 =
  "#splice-api-token-allocation-v1:Splice.Api.Token.AllocationV1:Allocation";
const ALLOCATION_CANCEL_CHOICE = "Allocation_Cancel";

export interface Holding {
  contractId: string;
  instrumentId: string;
  admin: string;
  amount: string;
  /**
   * True when a pending allocation has reserved this holding.
   *
   * A holding reserved by an unsettled allocation looks like any other holding
   * in the owner's contract set, but the registry refuses to spend it: it is
   * already committed to that allocation's leg. Passing one to
   * `AllocationFactory_Allocate` fails the whole trade with "unexpected holding
   * lock state", so these must be filtered before a leg is built.
   */
  locked: boolean;
  /** What holds the reservation, for diagnostics. */
  lockContext?: string;
}

/**
 * Describe the lock on a holding, or undefined when it is free to spend.
 *
 * A lock names the party allowed to release it and the context that took it.
 * For an allocation that context carries the allocation id and leg, which is
 * enough to tell a stuck allocation apart from any other reservation.
 */
const holdingLock = (view: any): string | undefined => {
  const lock = view?.lock;
  if (lock === undefined || lock === null) return undefined;
  if (typeof lock === "string") return lock === "" ? undefined : lock;
  // A lock with no lockers and no context reserves nothing.
  const hasLockers = Array.isArray(lock.lockers?.map) ? lock.lockers.map.length > 0 : Boolean(lock.lockers);
  const context = lock.context ?? lock.contexts?.[0];
  if (!hasLockers && !context) return undefined;
  return context ?? "reserved";
};

/**
 * Parse a token amount into its integer base units.
 *
 * Registry and ledger amounts are fixed-point decimals such as "0.0100000000",
 * not integers, so they are scaled by the instrument's decimals. Rejecting a
 * value with more fractional digits than the instrument supports keeps a
 * silently truncated amount from being treated as a valid balance.
 */
export const parseTokenAmount = (value: string, decimals: number, label = "amount"): bigint => {
  const text = value.trim();
  const match = /^(-?)(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match || (!match[2] && !match[3])) {
    throw new Error(`${label} is not a valid token amount: ${JSON.stringify(value)}`);
  }
  const [, sign, whole = "", fraction = ""] = match;
  if (fraction.length > decimals) {
    throw new Error(`${label} has more than ${decimals} decimals: ${JSON.stringify(value)}`);
  }
  const scaled = BigInt(`${whole || "0"}${fraction.padEnd(decimals, "0")}`);
  return sign === "-" ? -scaled : scaled;
};

/** Render base units back to a fixed-point decimal for logs and errors. */
export const formatTokenAmount = (value: bigint, decimals: number): string => {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0");
  return `${whole}${decimals > 0 ? `.${fraction}` : ""}`;
};

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
  /**
   * Registry-native fixed-point decimal such as "0.0300000000", forwarded to
   * the registry as `transferLeg.amount` unchanged. Base units are *not*
   * accepted: the registry reads a bare integer as that many whole tokens, so
   * base units would silently over-deliver by 10^decimals. Use
   * `formatTokenAmount` to convert a base-unit amount.
   */
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

/**
 * Match a holding against an instrument.
 *
 * The v1 holding template names the field `instrument` and calls the issuer
 * `source`, while later shapes expose `instrumentId` with an `admin`. Both are
 * accepted so a holding is never silently dropped because of a field rename.
 */
const instrumentMatches = (view: any, instrument: TokenInstrument): boolean => {
  const ref = instrumentRef(view);
  return ref?.id === instrument.id && ref.admin === instrument.issuer;
};

/** Read the instrument reference from either field naming. */
const instrumentRef = (view: any): { id: string; admin: string } | undefined => {
  const ref = view?.instrumentId ?? view?.instrument;
  const id = ref?.id;
  const admin = ref?.admin ?? ref?.source;
  return id && admin ? { id, admin } : undefined;
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
    // DevNet reports registry failures under several different keys depending on
    // which layer rejected the call: `cause` from the ledger, `error` and
    // `errorDescription` from the registry's own decoder, `details` elsewhere.
    // Reading only one of them turns an actionable rejection into a bare status.
    const cause =
      json?.cause ??
      json?.errorDescription ??
      json?.error ??
      json?.details ??
      (typeof json === "string" ? json.slice(0, 200) : "");
    throw new CantonError(
      resp.status,
      json,
      `POST ${path} failed with HTTP ${resp.status}${cause ? `: ${String(cause).slice(0, 300)}` : ""}`,
    );
  }
  return json;
};

/**
 * All holdings of an instrument held by a party, across every API version.
 *
 * The ledger's interface filter is not applied by every participant: some
 * accept the request but return the party's whole active contract set with no
 * interface views attached. Interface results are therefore a best-effort
 * source, merged with a raw contract scan that is filtered here rather than on
 * the server.
 */
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
  const record = (contractId: string, view: any) => {
    if (!instrumentMatches(view, instrument)) return;
    const ref = instrumentRef(view)!;
    const lockContext = holdingLock(view);
    byContract.set(contractId, {
      contractId,
      instrumentId: ref.id,
      admin: ref.admin,
      amount: view.amount,
      locked: lockContext !== undefined,
      ...(lockContext !== undefined ? { lockContext } : {}),
    });
  };

  for (const iface of interfaces) {
    const rows = await client.queryByInterface(party, iface, offset);
    for (const row of rows) record(row.contractId, row.viewValue);
  }

  if (byContract.size === 0) {
    const raw = await client.queryAllContracts(party, offset);
    for (const created of raw) {
      if (!created.templateId.endsWith(":Holding")) continue;
      const view = created.createArgument as any;
      // An active-contract scan returns everything in the party's ACS, including
      // contracts it only observes, so ownership is required here.
      if (view?.owner !== party) continue;
      record(created.contractId, view);
    }
  }

  return [...byContract.values()];
};

/**
 * Holdings that back one allocation leg, largest first.
 *
 * A Token Standard leg names `inputHoldingCids` as a *list*, because a sender's
 * balance is fragmented as soon as it has accepted more than one faucet tranche
 * and a trade rarely matches a single holding exactly. Demanding one holding
 * therefore fails on any party that has been funded twice, even though the
 * registry can settle the leg.
 *
 * Holdings are taken largest-first purely to reach `amount` in the fewest
 * inputs; a surplus above `amount` stays with the sender, so the choice of
 * order cannot change what the leg delivers.
 */
export const requireHoldings = async (
  client: CantonClient,
  party: string,
  instrument: TokenInstrument,
  amount: bigint,
  holdingInterface?: string,
): Promise<Holding[]> => {
  const label = `${instrument.id} holding`;
  const holdings = await listHoldings(client, party, instrument, holdingInterface);
  // A holding reserved by an unsettled allocation cannot back a new leg, so it is
  // excluded here rather than failing deep inside the registry.
  const usable = holdings.filter((h) => parseTokenAmount(h.amount, instrument.decimals, label) > 0n && !h.locked);
  if (usable.length === 0) {
    const reserved = holdings.filter((h) => h.locked);
    if (reserved.length > 0) {
      throw new Error(
        `${party} holds ${formatTokenAmount(
          reserved.reduce((sum, h) => sum + parseTokenAmount(h.amount, instrument.decimals, label), 0n),
          instrument.decimals,
        )} ${instrument.id}, but all of it is reserved by an unsettled allocation and cannot fund a new leg. ` +
          reserved.map((h) => `${h.contractId.slice(0, 12)}… (${h.lockContext})`).join("; ") +
          ". The reservation is released when that allocation settles or is cancelled.",
      );
    }
    throw new Error(
      `${party} holds no ${instrument.id} to allocate; searched ${instrument.supportedApis.filter((a) => a.startsWith("splice-api-token-holding-")).join(", ") || "no advertised holding API"}`,
    );
  }
  const ordered = [...usable].sort((a, b) => {
    const difference =
      parseTokenAmount(b.amount, instrument.decimals, label) -
      parseTokenAmount(a.amount, instrument.decimals, label);
    return difference > 0n ? 1 : difference < 0n ? -1 : 0;
  });
  const total = ordered.reduce(
    (sum, holding) => sum + parseTokenAmount(holding.amount, instrument.decimals, label),
    0n,
  );
  if (total < amount) {
    throw new Error(
      `${party} holds ${formatTokenAmount(total, instrument.decimals)} ${instrument.id} ` +
        `across ${ordered.length} holding(s) but the leg needs ${formatTokenAmount(amount, instrument.decimals)}`,
    );
  }
  const chosen: Holding[] = [];
  let covered = 0n;
  for (const holding of ordered) {
    if (covered >= amount) break;
    chosen.push(holding);
    covered += parseTokenAmount(holding.amount, instrument.decimals, label);
  }
  return chosen;
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
 * Transfer offers that still need the receiving party to accept.
 *
 * A faucet transfer is minted into a registry-owned holding and offered to the
 * recipient, who is only an *observer* of that holding until it accepts. The
 * balance therefore does not move until `TransferInstruction_Accept` runs, so
 * funding has to be finished by this exercise rather than by reading balances
 * again.
 *
 * An accepted offer is archived, so "present in the active contract set" is the
 * pending test; the receiver is only an observer of the backing holding until
 * the accept choice runs.
 */
export const findPendingTransferOffers = async (
  client: CantonClient,
  receiver: string,
  instrument?: TokenInstrument,
): Promise<Array<{ contractId: string; templateId: string }>> => {
  const offset = await client.ledgerEnd();
  const contracts = await client.queryAllContracts(receiver, offset);
  return contracts
    .filter((contract) => String(contract.templateId).endsWith(":TransferOffer"))
    .filter((contract) => {
      if (!instrument) return true;
      // A party can be owed offers for several instruments at once. Each offer
      // has to be accepted against its own registry's choice context, so keep
      // only this instrument's offers. An offer whose instrument cannot be read
      // is kept rather than dropped, so an unfamiliar shape delays funding
      // loudly instead of silently skipping it.
      const view = (contract as any).createArgument;
      const ref = instrumentRef(view);
      return ref ? instrumentMatches(view, instrument) : true;
    })
    .map((contract) => ({ contractId: contract.contractId, templateId: contract.templateId }));
};

/**
 * Accept a transfer offer as the receiver, completing a faucet transfer.
 *
 * The offer exposes no `TransferOffer_Accept` choice of its own: app-v0 >= 0.6.0
 * implements the Token Standard `TransferInstructionV1.TransferInstruction`
 * interface instead, so the accept is exercised *through the interface* and the
 * choice is named `TransferInstruction_Accept`. Verified on DevNet against both
 * a CBTC and a BETH offer.
 *
 * The registry supplies the choice context and the contracts that must be
 * disclosed, so the argument is passed through verbatim rather than built here.
 */
export const acceptTransferOffer = async (
  client: CantonClient,
  instrument: TokenInstrument,
  offer: { contractId: string; templateId: string },
  receiver: string,
  options: { transferInstructionInterface?: string } = {},
): Promise<string> => {
  const context = await registryPost(
    instrument.registryUrl,
    `/api/token-standard/v0/registrars/${instrument.issuer}/registry/transfer-instruction/v1/${offer.contractId}/choice-contexts/accept`,
    { meta: { values: "" } },
  );
  const disclosed = context.disclosedContracts ?? context.choiceContext?.disclosedContracts ?? [];
  await client.requirePackages(
    [offer.templateId, ...disclosed.map((c: any) => c?.templateId)],
    `Accepting transfer offer ${offer.contractId.slice(0, 12)}`,
  );
  const interfaces = options.transferInstructionInterface
    ? [options.transferInstructionInterface]
    : interfacesForInstrument(instrument, "transferInstruction");

  // An interface identifier is `#<package>:<module>:<entity>`, and it resolves
  // by package name, so the ShadowDesk package preference must stay unset.
  let lastError: unknown;
  for (const iface of interfaces) {
    try {
      const tx = await client.exerciseRaw(
        iface,
        offer.contractId,
        "TransferInstruction_Accept",
        { extraArgs: { context: context.choiceContextData, meta: { values: {} } } },
        [receiver],
        { disclosedContracts: disclosed, packageIdSelectionPreference: null },
        randomUUID(),
      );
      return tx.transaction?.updateId ?? offer.contractId;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
};

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
  const holdings = await requireHoldings(
    client,
    request.sender,
    request.instrument,
    parseTokenAmount(request.amount, request.instrument.decimals, `${request.legId} amount`),
    options.holdingInterface,
  );
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
    inputHoldingCids: holdings.map((holding) => holding.contractId),
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

  // A ledger exercise needs a concrete template id. The registry discloses the
  // concrete template alongside the factory contract, so prefer that over the
  // interface id used only to describe which API versions are available.
  const disclosed = factory.choiceContext?.disclosedContracts ?? [];
  const concreteTemplate = disclosed.find((c: any) =>
    String(c?.templateId ?? "").endsWith(":AllocationFactory"),
  )?.templateId as string | undefined;

  const describe = (error: unknown): string => {
    const cause = (error as any)?.causeJson?.cause;
    return cause ? String(cause) : error instanceof Error ? error.message : String(error);
  };

let tx: Awaited<ReturnType<CantonClient["exerciseRaw"]>> | undefined;
  // Preflight only what is actually addressed. The concrete factory template
  // the registry discloses frequently lives in an older package release that
  // this participant does not list, yet the same choice resolves through the
  // interface, so gating on the disclosure rejects trades the ledger accepts.
  // A disclosed contract is resolved when the exercise runs and the ledger
  // reports it precisely if it cannot be.
  await client.requirePackages(
    factoryInterfaces,
    `Creating allocation leg ${request.legId}`,
  );

  // Address the interface, not the concrete template the registry discloses.
  // Exercising the disclosed `AllocationFactory` template directly fails with
  // "Invalid template ... or choice:AllocationFactory_Allocate" for the same
  // reason the transfer offer did: the choice belongs to the interface, and
  // only the interface resolves by package name. The concrete template stays
  // as a last resort in case a registry predates the interface.
  const candidates = [...factoryInterfaces, ...(concreteTemplate ? [concreteTemplate] : [])];
  let lastError: unknown;
  for (const templateId of candidates) {
    // The concrete template is the one case that genuinely needs its own package
    // present, so it is checked on the way in rather than up front.
    if (templateId === concreteTemplate) {
      await client.requirePackages([concreteTemplate], `Creating allocation leg ${request.legId}`);
    }
    try {
      tx = await client.exerciseRaw(
        templateId,
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
        // `null` is required: the default pins the selection to this project's
        // own package, which makes the registry's package unresolvable.
        { disclosedContracts: disclosed, packageIdSelectionPreference: null },
        randomUUID(),
      );
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!tx) {
    throw new Error(
      `allocation leg ${request.legId} could not exercise AllocationFactory_Allocate over ${candidates.join(", ")}: ${describe(lastError)}`,
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

/**
 * Read an allocation contract into the leg shape the callers work with.
 *
 * Both the interface view and the raw create argument nest the leg under
 * `allocation`, so one parser serves either source. The registry's allocation
 * template is not published under the standard `Allocation` interface on every
 * participant, which is why a raw scan is a required fallback rather than a
 * convenience.
 */
const parseAllocationLeg = (
  contractId: string,
  templateId: string,
  view: any,
  registryUrl?: string,
): AllocationLeg | undefined => {
  const allocation = view?.allocation;
  const leg = allocation?.transferLeg;
  if (!leg?.instrumentId) return undefined;
  return {
    contractId,
    templateId,
    legId: allocation.transferLegId,
    instrumentId: leg.instrumentId.id,
    admin: leg.instrumentId.admin,
    sender: leg.sender,
    receiver: leg.receiver,
    amount: leg.amount,
    registryUrl,
  };
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
  const record = (contractId: string, templateId: string, view: any): void => {
    if (legs.has(contractId)) return;
    if (view?.allocation?.settlement?.settlementRef?.id !== settlementRef) return;
    // No per-instrument interface is pinned here: `ExecuteTransfer` and `Cancel`
    // live on different allocation interfaces, so each command builder picks the
    // interface its own choice requires.
    const parsed = parseAllocationLeg(contractId, templateId, view, options.registryUrl);
    if (parsed) legs.set(contractId, parsed);
  };

  for (const iface of interfaces) {
    const rows = await client.queryByInterface(party, iface, offset, {
      includeCreatedEventBlob: true,
    });
    for (const row of rows) record(row.contractId, row.templateId, row.viewValue);
  }

  // Fall back to a direct scan when the interface query matched nothing, so a
  // freshly created leg is not reported as missing purely because the node does
  // not publish it under the expected interface name.
  if (legs.size === 0) {
    for (const created of await client.queryAllContracts(party, offset)) {
      const templateId = String(created.templateId);
      if (!templateId.endsWith(ALLOCATION_TEMPLATE_SUFFIX)) continue;
      record(created.contractId, templateId, created.createArgument);
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
  client: CantonClient,
  legs: AllocationLeg[],
  options: { executor: string },
): Promise<{ commands: unknown[]; disclosedContracts: unknown[]; actAs: string[] }> => {
  if (legs.length === 0) throw new Error("no allocation legs to execute");

  // Each allocation's package must be present before the registry is asked for a
  // transfer context. A registry keeps a long-lived factory, so a leg can be
  // created under a package release older than the one this participant has, and
  // the resulting "Invalid template" from the ledger says nothing about why.
  await client.requirePackages(
    legs.map((leg) => leg.templateId),
    `Executing ${legs.length} allocation leg(s)`,
  );

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
        // `Allocation_ExecuteTransfer` lives on the V1 allocation interface, not
        // on the registry's concrete allocation template, so an interface
        // reference is required for the choice to resolve at all.
        templateId: ALLOCATION_INTERFACE_V1,
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
  const { commands, disclosedContracts, actAs } = await buildAllocationTransferCommands(client, legs, options);

  const tx = await client.submitMany(
    commands,
    actAs,
    { disclosedContracts, packageIdSelectionPreference: null },
    randomUUID(),
  );
  return { eventCount: tx.transaction?.events?.length ?? 0 };
};

/** How long a settlement waits for freshly written allocations to become visible. */
export const ALLOCATION_RESOLVE_TIMEOUT_MS = 30_000;
const ALLOCATION_POLL_INTERVAL_MS = 1_000;

/**
 * Look up specific allocation contracts by id, across every party that can see
 * them.
 *
 * A settlement must execute the exact allocations its plan pinned. Resolving
 * them by id rather than trusting a caller's list is what prevents the agent
 * from substituting a different leg at execution time.
 *
 * A freshly created allocation is not necessarily visible to every querying
 * party at the instant it commits, so `waitTimeoutMs` re-reads the ledger until
 * every id resolves. It defaults to a single pass: only a caller that has just
 * written the allocations needs to wait, and paying a timeout on a genuinely
 * missing id would only delay the error.
 */
export const findAllocationLegsByCid = async (
  client: CantonClient,
  parties: string[],
  contractIds: string[],
  options: {
    allocationInterface?: string;
    registryUrl?: string;
    instrument?: TokenInstrument;
    waitTimeoutMs?: number;
  } = {},
): Promise<Map<string, AllocationLeg>> => {
  const wanted = new Set(contractIds);
  if (wanted.size === 0) return new Map();

  const interfaces = options.allocationInterface
    ? [options.allocationInterface]
    : options.instrument
      ? interfacesForInstrument(options.instrument, "allocation")
      : [FALLBACK_INTERFACES.allocation];

  const searchOnce = async (): Promise<Map<string, AllocationLeg>> => {
    const offset = await client.ledgerEnd();
    const found = new Map<string, AllocationLeg>();
    const record = (contractId: string, templateId: string, view: any): void => {
      if (!wanted.has(contractId) || found.has(contractId)) return;
      const parsed = parseAllocationLeg(contractId, templateId, view, options.registryUrl);
      if (parsed) found.set(contractId, parsed);
    };

    for (const party of parties) {
      for (const iface of interfaces) {
        const rows = await client.queryByInterface(party, iface, offset, {
          includeCreatedEventBlob: true,
        });
        for (const row of rows) record(row.contractId, row.templateId, row.viewValue);
      }
    }

    // The registry's allocation template is not guaranteed to publish the
    // standard `Allocation` interface under the name this client expects, and an
    // interface query that matches nothing is indistinguishable from a leg that
    // does not exist. Both the dealer and the buyer are parties to the trade,
    // so both can see the allocation even while it is unsettled, so fall back to
    // reading the contracts directly rather than reporting a false negative.
    if (found.size < wanted.size) {
      for (const party of parties) {
        for (const created of await client.queryAllContracts(party, offset)) {
          const templateId = String(created.templateId);
          if (!templateId.endsWith(ALLOCATION_TEMPLATE_SUFFIX)) continue;
          record(created.contractId, templateId, created.createArgument);
        }
      }
    }

    return found;
  };

  const deadline = Date.now() + (options.waitTimeoutMs ?? 0);
  for (;;) {
    const found = await searchOnce();
    if (found.size === wanted.size) return found;
    if (Date.now() >= deadline) return found;
    await sleep(ALLOCATION_POLL_INTERVAL_MS);
  }
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
/**
 * Abandon an allocation whose settlement never happened, releasing the holdings
 * it reserved.
 *
 * A created allocation locks its input holdings until it settles or is
 * cancelled. An allocation left behind by a failed run therefore keeps real
 * balances unusable for the next trade, and the registry rejects those holdings
 * with "unexpected holding lock state" until the reservation is gone.
 *
 * Cancellation is authorised per leg by a set the registry chooses, so the
 * receiver, the sender and the registry admin are tried in turn and the first
 * accepted set is used. Both parties are required to sign whichever set the
 * registry accepts.
 */
export const cancelAllocationLeg = async (
  client: CantonClient,
  leg: { contractId: string; sender: string; receiver: string; admin?: string },
  options: { registryUrl: string },
): Promise<{ updateId: string; actors: string[] }> => {
  const ctx = await registryPost(
    options.registryUrl,
    `/api/token-standard/v0/registrars/${encodeURIComponent(leg.admin ?? "")}/registry/allocations/v1/${leg.contractId}/choice-contexts/cancel`,
    {},
  );

  const candidates: string[][] = [
    [leg.receiver],
    [leg.sender],
    [leg.sender, leg.receiver],
    ...(leg.admin ? [[leg.admin]] : []),
  ].filter((actors) => actors.length > 0 && actors.every(Boolean));

  let lastError: unknown;
  for (const actors of candidates) {
    try {
      const tx = await client.exerciseRaw(
        ALLOCATION_INTERFACE_V2,
        leg.contractId,
        ALLOCATION_CANCEL_CHOICE,
        { actors, extraArgs: { context: ctx.choiceContextData, meta: { values: {} } } },
        actors,
        { disclosedContracts: ctx.disclosedContracts, packageIdSelectionPreference: null },
      );
      return { updateId: tx.transaction?.updateId ?? "", actors };
    } catch (e) {
      lastError = e;
    }
  }
  throw new Error(
    `no party on leg ${leg.contractId.slice(0, 12)}… was allowed to cancel it: ${String(
      (lastError as any)?.causeJson?.cause ?? (lastError as any)?.message ?? lastError,
    ).slice(0, 300)}`,
  );
};

/**
 * Cancel every allocation a settlement reference left behind.
 *
 * Used to recover after a failed run so the reserved holdings become spendable
 * again. Returns the legs that were still active, so a caller can report what
 * was actually released instead of assuming the cleanup ran.
 */
export const cancelDanglingAllocations = async (
  client: CantonClient,
  parties: string[],
  settlementRefPrefix: string,
  options: { registryUrl: string; admin?: string },
): Promise<{ contractId: string; updateId: string }[]> => {
  const offset = await client.ledgerEnd();
  const released: { contractId: string; updateId: string }[] = [];
  const seen = new Set<string>();

  for (const party of parties) {
    for (const created of await client.queryAllContracts(party, offset)) {
      const templateId = String(created.templateId);
      if (!templateId.endsWith(ALLOCATION_TEMPLATE_SUFFIX)) continue;
      if (seen.has(created.contractId)) continue;
      const allocation = (created.createArgument as any)?.allocation;
      const leg = allocation?.transferLeg;
      if (!leg) continue;
      // Scope the sweep to our own runs so a live settlement is never cancelled.
      const ref = allocation.settlement?.settlementRef?.id ?? allocation.settlement?.id;
      if (typeof ref !== "string" || !ref.startsWith(settlementRefPrefix)) continue;
      seen.add(created.contractId);
      try {
        const { updateId } = await cancelAllocationLeg(
          client,
          {
            contractId: created.contractId,
            sender: leg.sender,
            receiver: leg.receiver,
            ...(options.admin ? { admin: options.admin } : {}),
          },
          options,
        );
        released.push({ contractId: created.contractId, updateId });
      } catch {
        // A leg the registry will not release is reported by the caller's own
        // balance check; skipping it keeps the remaining legs recoverable.
      }
    }
  }
  return released;
};
