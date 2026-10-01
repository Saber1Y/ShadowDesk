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
      throw new CantonError(resp.status, json, `POST ${path} failed`);
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
    commandId = randomUUID(),
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
    commandId = randomUUID(),
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
    const identifierFilter = {
      InterfaceFilter: {
        value: {
          interfaceId,
          includeInterfaceView: true,
          ...(options.includeCreatedEventBlob ? { includeCreatedEventBlob: true } : {}),
        },
      },
    };
    const j = await this.req("/v2/state/active-contracts", {
      method: "POST",
      body: JSON.stringify({
        activeAtOffset,
        filter: { filtersByParty: { [party]: { cumulative: [identifierFilter] } } },
        verbose: true,
      }),
    });
    const out: InterfaceCreatedEvent[] = [];
    for (const entry of Array.isArray(j) ? j : []) {
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

  async ledgerEnd(): Promise<number> {
    const j = await this.req("/v2/state/ledger-end");
    return j.offset as number;
  }

  async packageIds(): Promise<string[]> {
    const j = await this.req("/v2/packages");
    return (j.packageIds ?? []) as string[];
  }

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
    const j = await this.req("/v2/state/active-contracts", {
      method: "POST",
      body: JSON.stringify({
        activeAtOffset,
        eventFormat: {
          filtersByParty,
          verbose: false,
        },
      }),
    });
    const out: CreatedEvent[] = [];
    for (const entry of j) {
      const ce = entry.contractEntry;
      if (!ce || !ce.JsActiveContract || !ce.JsActiveContract.createdEvent) continue;
      const created = ce.JsActiveContract.createdEvent;
      const matches = templateSuffixes.some((s) => created.templateId.endsWith(`:${s}`));
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

export const decimal = (n: number): string => n.toFixed(0);
