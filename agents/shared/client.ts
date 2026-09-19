import { TPL, type TemplateKey, type Party, type CreatedEvent, type TransactionResponse } from "./types.js";

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export class CantonClient {
  readonly baseUrl: string;
  readonly participantName: string;
  readonly userId: string;

  constructor(baseUrl: string, participantName: string, userId = "shadowdesk-agent") {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.participantName = participantName;
    this.userId = userId;
  }

  private async req(path: string, init?: RequestInit): Promise<any> {
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
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
    const wrapped = {
      commands: {
        commands: cmd.commands,
        commandId,
        userId: this.userId,
        actAs: cmd.actAs,
        ...(cmd.readAs ? { readAs: cmd.readAs } : {}),
      },
    };
    return this.req("/v2/commands/submit-and-wait-for-transaction", {
      method: "POST",
      body: JSON.stringify(wrapped),
    });
  }

  async ledgerEnd(): Promise<number> {
    const j = await this.req("/v2/state/ledger-end");
    return j.offset as number;
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