import { randomUUID } from "node:crypto";
import { TPL, PACKAGE_ID, type TemplateKey, type Party, type CreatedEvent, type InterfaceCreatedEvent, type TransactionResponse } from "./types.js";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const subjectFromToken = (token: string | undefined): string | undefined => {
  const payload = token?.split(".")[1];
  if (!payload) return undefined;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof claims.sub === "string" ? claims.sub : undefined;
  } catch {
    return undefined;
  }
};

export const envValue = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

/** HTTP 413 from the JSON Ledger API: the query matched more elements than the node allows. */
const isTooManyElements = (e: unknown): boolean => {
  const status = (e as any)?.status;
  const text = String((e as any)?.causeJson?.cause ?? (e as any)?.message ?? e);
  return status === 413 || /MAXIMUM_LIST_ELEMENTS|number of matching elements/i.test(text);
};

/**
 * Replace a wildcard identifier filter with the templates a ShadowDesk party can
 * actually hold.
 *
 * This is the narrowing that makes an unbounded query survivable: the wildcard is
 * what trips the node limit, and a template-scoped query returns the same
 * contracts for the callers that want them. Registry holdings and allocations are
 * included because the real-token paths read those through this same scan.
 */
const WILDCARD_TO_TEMPLATES = [
  "ShadowDesk.Rfq:BlockTradeRFQ",
  "ShadowDesk.Rfq:QuoteProposal",
  "ShadowDesk.Rfq:SealedQuote",
  "ShadowDesk.Rfq:TreasuryMandate",
  "ShadowDesk.Rfq:ApprovedMandate",
  "ShadowDesk.Settlement:Deal",
  "ShadowDesk.Settlement:SettlementReceipt",
  "ShadowDesk.Asset:Asset",
  ":Utility.Registry.Holding.V0.Holding:Holding",
  ":Utility.Registry.V0.Holding.Allocation:DvpLegAllocation",
];

const narrowWildcardFilters = (
  body: Record<string, unknown>,
  templates: readonly string[] = WILDCARD_TO_TEMPLATES,
): Record<string, unknown> | undefined => {
  const eventFormat = body.eventFormat as any;
  const filtersByParty = eventFormat?.filtersByParty;
  if (!filtersByParty) return undefined;
  const parties = Object.keys(filtersByParty);
  if (parties.length === 0) return undefined;
  const rebuilt: Record<string, unknown> = {};
  for (const party of parties) {
    rebuilt[party] = {
      cumulative: templates.map((template) => ({
        templateFilter: { value: { templateId: template } },
      })),
    };
  }
  return { ...body, eventFormat: { ...eventFormat, filtersByParty: rebuilt } };
};

export class CantonClient {
  readonly baseUrl: string;
  readonly participantName: string;
  readonly userId: string;

  constructor(baseUrl: string, participantName: string, userId = envValue("SHADOWDESK_LEDGER_USER_ID") ?? "shadowdesk-agent") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.participantName = participantName;
    if (process.env.SHADOWDESK_NETWORK === "devnet") {
      const ledgerUserId = envValue("SHADOWDESK_LEDGER_USER_ID") ?? subjectFromToken(envValue("SHADOWDESK_CANTON_ACCESS_TOKEN"));
      if (!ledgerUserId) throw new Error("DevNet JWT subject is required as the Ledger API userId.");
      this.userId = ledgerUserId;
    } else {
      this.userId = userId;
    }
  }

  private async req(path: string, init?: RequestInit): Promise<any> {
    const accessToken = process.env.SHADOWDESK_NETWORK === "devnet"
      ? envValue("SHADOWDESK_CANTON_ACCESS_TOKEN")
      : undefined;
    if (process.env.SHADOWDESK_NETWORK === "devnet" && !accessToken) {
      throw new Error("DevNet requests require SHADOWDESK_CANTON_ACCESS_TOKEN.");
    }
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    const body = await resp.text();
    let json: any = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = body;
    }
    if (!resp.ok) {
      // A failed exercise reports the real reason in `cause` (an unresolved
      // registry template, an unauthorised choice, ...). Without it every
      // registry failure collapses into the same opaque "POST ... failed".
      const cause = json?.cause ?? json?.details ?? json?.reason;
      throw new CantonError(
        resp.status,
        json,
        `POST ${path} failed with HTTP ${resp.status}${cause ? `: ${String(cause).slice(0, 300)}` : ""}`,
      );
    }
    return json;
  }

  private submit(body: unknown, commandId: string): Promise<any> {
    const cmd = body as any;
    // Token Standard registry commands need `disclosedContracts` and do not
    // belong to the ShadowDesk package, so the preference list must be
    // overridable and omittable rather than always pinned to PACKAGE_ID.
    const hasPreference = "packageIdSelectionPreference" in cmd;
    const wrapped = {
      commands: {
        commands: cmd.commands,
        commandId,
        userId: this.userId,
        actAs: cmd.actAs,
        ...(cmd.readAs ? { readAs: cmd.readAs } : {}),
        ...(cmd.disclosedContracts ? { disclosedContracts: cmd.disclosedContracts } : {}),
        ...(hasPreference
          ? (cmd.packageIdSelectionPreference ? { packageIdSelectionPreference: cmd.packageIdSelectionPreference } : {})
          : { packageIdSelectionPreference: [PACKAGE_ID] }),
      },
    };
    return this.req("/v2/commands/submit-and-wait-for-transaction", {
      method: "POST",
      body: JSON.stringify(wrapped),
    });
  }

  /**
   * Submit several commands as one transaction. Either every command is
   * applied or none is, which is what makes a two-leg delivery-versus-payment
   * settlement atomic.
   */
  async submitMany(
    commands: unknown[],
    actAs: string[],
    options: { disclosedContracts?: unknown[]; packageIdSelectionPreference?: string[] | null } = {},
    commandId: string = randomUUID(),
  ): Promise<TransactionResponse> {
    const j = await this.submit(
      {
        commands,
        actAs,
        disclosedContracts: options.disclosedContracts,
        packageIdSelectionPreference: options.packageIdSelectionPreference,
      },
      commandId,
    );
    return j as TransactionResponse;
  }

  /**
   * Exercise a choice on any contract by its template identifier. Needed for
   * Token Standard contracts, which are addressed by registry interface ids
   * rather than by a template in this package.
   */
  async exerciseRaw(
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    actAs: string[],
    options: { disclosedContracts?: unknown[]; packageIdSelectionPreference?: string[] | null } = {},
    commandId: string = randomUUID(),
  ): Promise<TransactionResponse> {
    return this.submitMany(
      [{ ExerciseCommand: { templateId, contractId, choice, choiceArgument } }],
      actAs,
      options,
      commandId,
    );
  }

  /**
   * Find contracts by the interface they implement and return their interface
   * views. Token Standard holdings and allocations are only readable this way:
   * they are registry contracts with no template in this package.
   */
  async queryByInterface(
    party: string,
    interfaceId: string,
    activeAtOffset: number,
    options: { includeCreatedEventBlob?: boolean } = {},
  ): Promise<InterfaceCreatedEvent[]> {
    const interfaceFilter = {
      InterfaceFilter: {
        value: {
          interfaceId,
          includeInterfaceView: true,
          ...(options.includeCreatedEventBlob ? { includeCreatedEventBlob: true } : {}),
        },
      },
    };
    // The filters must be nested under `eventFormat`. A top-level `filter`
    // plus `verbose` is the older request shape and is accepted without error
    // while being ignored, which returns contracts with no interface views and
    // makes every interface query look like an empty result.
    const fallbackTemplates = interfaceId.includes(":Allocation")
      ? [":Utility.Registry.V0.Holding.Allocation:DvpLegAllocation"]
      : interfaceId.includes(":Holding")
        ? [":Utility.Registry.Holding.V0.Holding:Holding"]
        : WILDCARD_TO_TEMPLATES;
    const entries = await this.queryActiveContractsPaged({
      activeAtOffset,
      eventFormat: {
        filtersByParty: { [party]: { cumulative: [interfaceFilter] } },
        verbose: true,
      },
    }, fallbackTemplates);
    const out: InterfaceCreatedEvent[] = [];
    for (const entry of entries) {
      const created = entry?.contractEntry?.JsActiveContract?.createdEvent;
      if (!created) continue;
      for (const view of created.interfaceViews ?? []) {
        out.push({
          contractId: created.contractId,
          templateId: created.templateId,
          offset: created.offset,
          interfaceId: view.interfaceId,
          viewValue: view.viewValue,
        });
      }
    }
    return out;
  }

  /**
   * Walk `/v2/state/active-contracts` to completion.
   *
   * The endpoint caps how many contracts one response carries and answers 413
   * once a party's active set exceeds it, so an unpaged query works on a fresh
   * sandbox and fails once the same ledger has been used for a while. Paging is
   * what makes a query's result depend on the party rather than on how much
   * history has accumulated.
   */
  private async queryActiveContractsPaged(
    body: Record<string, unknown>,
    fallbackTemplates: readonly string[] = WILDCARD_TO_TEMPLATES,
  ): Promise<any[]> {
    const out: any[] = [];
    let pageToken: string | undefined;
    // Once a wildcard has been narrowed to templates, a further 413 means the
    // party's template-scoped set is itself too large (an observer-heavy party
    // can exceed the cap across all ten templates at once), so retrying the
    // identical narrowed body would loop forever. Per-template queries keep a
    // single request inside the node limit.
    let narrowedOnce = false;
    // A page that never advances would otherwise loop forever on a ledger that
    // keeps returning the same token.
    const seenTokens = new Set<string>();
    for (;;) {
      let j: any;
      try {
        j = await this.req("/v2/state/active-contracts", {
          method: "POST",
          body: JSON.stringify({ ...body, ...(pageToken ? { pageToken } : {}) }),
        });
      } catch (e) {
        // The node caps how many elements one query may match and answers 413
        // when the party's whole set exceeds it, checked against the total
        // rather than the page, so paging cannot rescue the request. Narrowing by
        // template is the only way through, and the caller knows which templates
        // it wants. Without that the wildcard scan would simply fail once a
        // sandbox accumulated enough contracts, which it always eventually does.
        if (!isTooManyElements(e)) throw e;
        if (narrowedOnce) {
          const eventFormat = body.eventFormat as any;
          const filtersByParty = eventFormat?.filtersByParty;
          if (!filtersByParty) throw e;
          const perTemplate: any[] = [];
          for (const party of Object.keys(filtersByParty)) {
            for (const template of fallbackTemplates) {
              const fragment = {
                ...body,
                eventFormat: {
                  ...eventFormat,
                  filtersByParty: {
                    [party]: { cumulative: [{ templateFilter: { value: { templateId: template } } }] },
                  },
                },
              };
              try {
                perTemplate.push(...(await this.reqActiveContractsPaged(fragment)));
              } catch (e2) {
                if (isTooManyElements(e2)) {
                  throw new Error(
                    `Party ${party.slice(0, 12)} matches more than the node limit in a single template (${template}); cannot list contracts.`,
                  );
                }
                throw e2;
              }
            }
          }
          return perTemplate;
        }
        const narrowed = narrowWildcardFilters(body, fallbackTemplates);
        if (!narrowed) throw e;
        body = narrowed;
        pageToken = undefined;
        seenTokens.clear();
        narrowedOnce = true;
        continue;
      }
      if (Array.isArray(j)) out.push(...j);
      const next: string | undefined = j?.pageToken ?? undefined;
      if (!next || seenTokens.has(next)) break;
      seenTokens.add(next);
      pageToken = next;
    }
    return out;
  }

  /**
   * Walk one fragment (a party- and template-scoped request) to completion,
   * following page tokens without any 413-driven narrowing. Used where the
   * caller cannot trust a wildcard or interface scan to stay under the node's
   * element cap, so each fragment is expected to fit in a single page.
   */
  private async reqActiveContractsPaged(body: Record<string, unknown>): Promise<any[]> {
    const out: any[] = [];
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();
    for (;;) {
      const j = await this.req("/v2/state/active-contracts", {
        method: "POST",
        body: JSON.stringify({ ...body, ...(pageToken ? { pageToken } : {}) }),
      });
      if (Array.isArray(j)) out.push(...j);
      const next: string | undefined = j?.pageToken ?? undefined;
      if (!next || seenTokens.has(next)) break;
      seenTokens.add(next);
      pageToken = next;
    }
    return out;
  }

  /**
   * Every active contract visible to a party, unfiltered.
   *
   * Used as a fallback when the ledger does not apply identifier filters: some
   * participants accept a filtered request but return the party's entire active
   * contract set, so callers filter the result themselves instead of trusting
   * an empty or unfiltered server response.
   */
  async queryAllContracts(party: string, activeAtOffset: number): Promise<CreatedEvent[]> {
    const filtersByParty: Record<string, unknown> = {};
    filtersByParty[party] = { cumulative: [{ wildcardFilter: { value: {} } }] };
    const entries = await this.queryActiveContractsPaged({
      activeAtOffset,
      eventFormat: { filtersByParty, verbose: false },
    });
    const out: CreatedEvent[] = [];
    for (const entry of entries) {
      const created = entry?.contractEntry?.JsActiveContract?.createdEvent;
      if (!created) continue;
      out.push({
        offset: created.offset,
        nodeId: created.nodeId,
        contractId: created.contractId,
        templateId: created.templateId,
        createArgument: (created.createArgument ?? {}) as Record<string, unknown>,
        signatories: created.signatories ?? [],
        observers: created.observers ?? [],
        witnessParties: created.witnessParties ?? [],
      });
    }
    return out;
  }

  async ledgerEnd(): Promise<number> {
    const j = await this.req("/v2/state/ledger-end");
    return j.offset as number;
  }

  async packageIds(): Promise<string[]> {
    const j = await this.req("/v2/packages");
    return (j.packageIds ?? []) as string[];
  }

  /**
   * Fail before an exercise when a template's package is not installed here.
   *
   * A missing package is reported by the Ledger as the same opaque
   * "Invalid template" 400 whether the template itself is unknown or merely one
   * of its dependencies is absent. Registry-supplied exercises are the trap:
   * they carry disclosed contracts created under whichever package was current
   * at the time, so an old contract makes the whole exercise fail even when the
   * registry's own package is installed. Naming the package first turns an
   * unactionable error into an installable one.
   */
  async requirePackages(templateIds: ReadonlyArray<string | undefined>, label: string): Promise<void> {
    // Only concrete `packageId:Module:Entity` references can be checked against
    // a list of package ids. An interface reference is written
    // `#packageName:Module:Entity` and resolves by *name*, so its first segment
    // is not a package id and comparing it to the installed set would report
    // every interface as missing. Those are resolved by the ledger itself.
    const needed = [...new Set(
      templateIds
        .filter((t): t is string => typeof t === "string" && t.includes(":") && !t.startsWith("#"))
        .map((t) => ({ packageId: t.split(":")[0]!, templateId: t })),
    )];
    if (needed.length === 0) return;

    this.installedPackages ??= this.packageIds();
    let installed: string[];
    try {
      installed = await this.installedPackages;
    } catch {
      // The preflight is a diagnostic, never a gate: if the known-package list
      // cannot be read, let the exercise itself decide rather than failing on
      // a guess.
      return;
    }
    if (installed.length === 0) return;
    const known = new Set(installed);
    const missing = new Map<string, string[]>();
    for (const { packageId, templateId } of needed) {
      if (known.has(packageId)) continue;
      missing.set(packageId, [...(missing.get(packageId) ?? []), templateId]);
    }
    if (missing.size === 0) return;

    const detail = [...missing]
      .map(([packageId, templates]) => `  ${packageId}\n    used by ${[...new Set(templates)].join("\n            ")}`)
      .join("\n");
    throw new Error(
      `${label} needs ${missing.size} package(s) that this participant does not have:\n${detail}\n` +
        "A registry keeps long-lived contracts, so an allocation factory or holding can be created under an " +
        "older package release than the one this participant holds, and the ledger then reports only " +
        "\"Invalid template\". Install the missing package on every participant that signs, or have the " +
        "registry re-create those contracts under a current release. On a hosted network where package " +
        "upload is rejected (HTTP 403), only the registry can retire the old package, so this instrument " +
        "cannot be settled from this participant until it does.",
    );
  }

  private installedPackages: Promise<string[]> | undefined;

  async listParties(): Promise<Party[]> {
    const j = await this.req("/v2/parties");
    return (j.partyDetails ?? []).map((d: any) => d.party as Party);
  }

  async allocateParty(hint: string): Promise<Party> {
    const j = await this.req("/v2/parties", {
      method: "POST",
      body: JSON.stringify({ partyIdHint: hint }),
    });
    return j.partyDetails.party as Party;
  }

  async ensureParty(hint: string): Promise<Party> {
    if (process.env.SHADOWDESK_NETWORK === "devnet") {
      const partyVariable = `SHADOWDESK_${hint.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()}_PARTY`;
      const party = process.env[partyVariable];
      if (!party) {
        throw new Error(`DevNet party is not configured. Set ${partyVariable} after creating it in the Node Console.`);
      }
      return party;
    }
    const existing = await this.listParties();
    const match = existing.find((p) => this.matchesHint(p, hint));
    if (match) return match;
    try {
      return await this.allocateParty(hint);
    } catch (e) {
      const after = await this.listParties();
      const found = after.find((p) => this.matchesHint(p, hint));
      if (found) return found;
      throw e;
    }
  }

  private matchesHint(party: Party, hint: string): boolean {
    if (party === hint) return true;
    if (party.startsWith(`${hint}::`)) return true;
    if (party.endsWith(`::${this.participantName}`)) return false;
    const truncated = party.split("::")[0];
    return truncated === hint;
  }

  /**
   * Active contracts for a party that match the given template suffixes.
   *
   * Routes through `queryActiveContractsPaged` rather than a single request:
   * the endpoint caps how many elements one response carries and answers 413
   * once a party's active set exceeds it, checked against the total rather than
   * the page, so the scan must either fit under the cap or be narrowed by
   * template on the server. The paged walk pages the response where possible
   * and, when the node still refuses, narrows the wildcard to the money
   * templates a ShadowDesk party can actually hold.
   */
  async queryActiveContracts(
    party: Party,
    templateSuffixes: string[],
    activeAtOffset: number,
  ): Promise<CreatedEvent[]> {
    const filtersByParty: Record<string, unknown> = {};
    filtersByParty[party] = {
      cumulative: [
        {
          identifierFilter: {
            WildcardFilter: { value: {} },
          },
        },
      ],
    };
    const entries = await this.queryActiveContractsPaged({
      activeAtOffset,
      eventFormat: {
        filtersByParty,
        verbose: false,
      },
    }, templateSuffixes);
    const out: CreatedEvent[] = [];
    for (const entry of entries) {
      const ce = entry.contractEntry;
      if (!ce || !ce.JsActiveContract || !ce.JsActiveContract.createdEvent) continue;
      const created = ce.JsActiveContract.createdEvent;
      const matches = templateSuffixes.some((s) =>
        created.templateId.endsWith(`:${s.startsWith(":") ? s.slice(1) : s}`),
      );
      if (!matches) continue;
      out.push({
        offset: created.offset,
        nodeId: created.nodeId,
        contractId: created.contractId,
        templateId: created.templateId,
        createArgument: created.createArgument as Record<string, unknown>,
        signatories: created.signatories ?? [],
        observers: created.observers ?? [],
        witnessParties: created.witnessParties ?? [],
      });
    }
    return out;
  }

  async create(
    templateKey: TemplateKey,
    createArguments: Record<string, unknown>,
    actAs: Party[],
    commandId: string,
  ): Promise<TransactionResponse> {
    const j = await this.submit(
      {
        commands: [
          {
            CreateCommand: {
              templateId: TPL[templateKey],
              createArguments,
            },
          },
        ],
        actAs,
      },
      commandId,
    );
    return j as TransactionResponse;
  }

  async exercise(
    templateKey: TemplateKey,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    actAs: Party[],
    commandId: string,
  ): Promise<TransactionResponse> {
    const j = await this.submit(
      {
        commands: [
          {
            ExerciseCommand: {
              templateId: TPL[templateKey],
              contractId,
              choice,
              choiceArgument,
            },
          },
        ],
        actAs,
      },
      commandId,
    );
    return j as TransactionResponse;
  }

  async waitForCondition(
    fn: () => Promise<boolean>,
    timeoutMs: number,
    pollMs = 750,
    label = "condition",
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await fn()) return true;
      await sleep(pollMs);
    }
    throw new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`);
  }
}

export class CantonError extends Error {
  readonly status: number;
  readonly causeJson: any;

  constructor(status: number, causeJson: any, msg: string) {
    super(msg);
    this.name = "CantonError";
    this.status = status;
    this.causeJson = causeJson;
  }

  get code(): string {
    return this.causeJson?.code ?? String(this.status);
  }
}

export const extractCreatedBytes = (tx: TransactionResponse, suffix: string): { cid: string; arg: any } | null => {
  const ev = tx.transaction.events
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(suffix));
  if (!ev) return null;
  return { cid: ev.contractId, arg: ev.createArgument };
};

/**
 * Find a created contract by module-qualified template suffix.
 *
 * The ledger reports template ids keyed by package hash, so a template id built
 * from the package name (`#shadowdesk-treasury-v2:...`) never equals what comes
 * back. Matching on the suffix is what actually holds across uploads.
 */
export const findCreatedByTemplate = (
  tx: TransactionResponse | null | undefined,
  moduleQualifiedSuffix: string,
): { cid: string; arg: any } | null => {
  const ev = (tx?.transaction?.events ?? [])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => typeof e.templateId === "string" && e.templateId.endsWith(moduleQualifiedSuffix));
  if (!ev) return null;
  return { cid: ev.contractId, arg: ev.createArgument };
};

export const decimal = (n: number): string => n.toFixed(0);
