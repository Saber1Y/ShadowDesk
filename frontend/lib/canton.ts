import { CantonAuthError, getCantonAuth } from "@/lib/canton-auth";

export interface ParticipantEndpoint {
  name: string;
  jsonApi: string;
}

const participantUrl = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
};

const participant1Url = participantUrl("SHADOWDESK_PARTICIPANT1_URL", "http://127.0.0.1:6864");
const participant2Fallback = process.env.SHADOWDESK_NETWORK === "devnet"
  ? participant1Url
  : "http://127.0.0.1:18003";

export const PARTICIPANTS: Record<string, ParticipantEndpoint> = {
  participant1: { name: "participant1", jsonApi: participant1Url },
  participant2: { name: "participant2", jsonApi: participantUrl("SHADOWDESK_PARTICIPANT2_URL", participant2Fallback) },
};

interface CreatedRecord {
  offset: number;
  contractId: string;
  templateId: string;
  createdAt: string;
  createArgument: Record<string, unknown>;
  signatories: string[];
  observers: string[];
}

type JsonMap = Record<string, any>;

export class CantonClient {
  readonly baseUrl: string;
  userId = "shadowdesk-dashboard";

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async req(path: string, init?: RequestInit): Promise<JsonMap> {
    const auth = await getCantonAuth();
    if (auth.ledgerUserId) this.userId = auth.ledgerUserId;
    const resp = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(auth.accessToken ? { Authorization: `Bearer ${auth.accessToken}` } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const body = await resp.text();
    let json: any = null;
    try {
      json = body ? JSON.parse(body) : null;
    } catch {
      json = body;
    }
    if (!resp.ok) {
      throw new Error(`GET ${path} failed: ${resp.status} ${JSON.stringify(json)}`);
    }
    return json;
  }

  async ping(): Promise<boolean> {
    try {
      const j = await this.req("/v2/version");
      return typeof j.version === "string";
    } catch {
      return false;
    }
  }

  async verifyLedgerIdentity(): Promise<void> {
    try {
      await this.req("/v2/version");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/\b(401|403)\b/.test(message)) {
        throw new CantonAuthError(
          "configuration",
          "The Canton Ledger API rejected this identity. Confirm the account is onboarded to the HackCanton participant and that its ledger user ID matches the signed-in identity.",
        );
      }
      throw err;
    }
  }

  async ledgerEnd(): Promise<number> {
    const j = await this.req("/v2/state/ledger-end");
    return j.offset as number;
  }

  async listParties(): Promise<string[]> {
    const j = await this.req("/v2/parties");
    return (j.partyDetails ?? []).map((d: any) => d.party as string);
  }

  /**
   * Active contracts for a party, walked to completion.
   *
   * The endpoint caps how many elements one response carries and answers 413
   * once a party's active set exceeds it (checked against the total rather than
   * the page), so a single wildcard request works on a fresh sandbox and fails
   * once the same ledger has been used for a while. Paging covers the response
   * cap, and narrowing the wildcard to the money templates a ShadowDesk party
   * can actually hold is the only way through the node's total match limit.
   */
  async queryActiveContracts(party: string, offset: number): Promise<CreatedRecord[]> {
    const wildcardBody = (): Record<string, any> => ({
      activeAtOffset: offset,
      eventFormat: {
        filtersByParty: {
          [party]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: {} } } }] },
        },
        verbose: false,
      },
    });

    const MONEY_TEMPLATES = [
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
    const narrowBody = (): Record<string, any> => ({
      ...wildcardBody(),
      eventFormat: {
        ...wildcardBody().eventFormat,
        filtersByParty: {
          [party]: {
            cumulative: MONEY_TEMPLATES.map((templateId) => ({
              templateFilter: { value: { templateId } },
            })),
          },
        },
      },
    });

    const raw: any[] = [];
    let body = wildcardBody();
    let pageToken: string | undefined;
    const seenTokens = new Set<string>();
    for (;;) {
      let rows: any;
      try {
        rows = await this.req("/v2/state/active-contracts", {
          method: "POST",
          body: JSON.stringify({ ...body, ...(pageToken ? { pageToken } : {}) }),
        });
      } catch (e: any) {
        const status = e?.status;
        const text = String(e?.causeJson?.cause ?? e?.message ?? e);
        const tooMany = status === 413 || /MAXIMUM_LIST_ELEMENTS|number of matching elements/i.test(text);
        if (!tooMany) throw e;
        body = narrowBody();
        pageToken = undefined;
        seenTokens.clear();
        continue;
      }
      if (Array.isArray(rows)) raw.push(...rows);
      const next: string | undefined = rows?.pageToken ?? undefined;
      if (!next || seenTokens.has(next)) break;
      seenTokens.add(next);
      pageToken = next;
    }

    const created: CreatedRecord[] = [];
    for (const entry of raw) {
      const ce = entry?.contractEntry;
      if (!ce || !ce.JsActiveContract || !ce.JsActiveContract.createdEvent) continue;
      const c = ce.JsActiveContract.createdEvent;
      created.push({
        offset: c.offset as number,
        contractId: c.contractId as string,
        templateId: c.templateId as string,
        createdAt: (c.createdAt as string) ?? "",
        createArgument: (c.createArgument as Record<string, unknown>) ?? {},
        signatories: (c.signatories ?? []) as string[],
        observers: (c.observers ?? []) as string[],
      });
    }
    return created;
  }
}

export { shortCid, templateSuffix, partyHint, fmtTime, fmtAmount, fmtPrice } from "@/lib/format";
