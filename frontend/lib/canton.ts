import { getCantonAuth } from "@/lib/canton-auth";

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

  async ledgerEnd(): Promise<number> {
    const j = await this.req("/v2/state/ledger-end");
    return j.offset as number;
  }

  async listParties(): Promise<string[]> {
    const j = await this.req("/v2/parties");
    return (j.partyDetails ?? []).map((d: any) => d.party as string);
  }

  async queryActiveContracts(party: string, offset: number): Promise<CreatedRecord[]> {
    const filtersByParty: Record<string, any> = {};
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
        activeAtOffset: offset,
        eventFormat: {
          filtersByParty,
          verbose: false,
        },
      }),
    });
    const rows = Array.isArray(j) ? j : [];
    const out: CreatedRecord[] = [];
    for (const entry of rows) {
      const ce = entry?.contractEntry;
      if (!ce || !ce.JsActiveContract || !ce.JsActiveContract.createdEvent) continue;
      const created = ce.JsActiveContract.createdEvent;
      out.push({
        offset: created.offset as number,
        contractId: created.contractId as string,
        templateId: created.templateId as string,
        createdAt: (created.createdAt as string) ?? "",
        createArgument: (created.createArgument as Record<string, unknown>) ?? {},
        signatories: (created.signatories ?? []) as string[],
        observers: (created.observers ?? []) as string[],
      });
    }
    return out;
  }
}

export const shortCid = (cid: string): string => cid.slice(0, 16);
export const templateSuffix = (templateId: string): string => templateId.split(":").slice(1).join(":");
export const partyHint = (party: string): string => party.split("::")[0];
export const fmtTime = (iso: string): string => {
  if (!iso) return "-";
  return new Date(iso).toISOString().slice(0, 19).replace("T", " ");
};
export const fmtAmount = (n: string): string => {
  const v = Number(n);
  if (!isFinite(v)) return n;
  return v.toLocaleString("en-US", { maximumFractionDigits: 10 });
};
export const fmtPrice = (n: string, digits = 2): string => {
  const v = Number(n);
  if (!isFinite(v)) return n;
  return v.toFixed(digits);
};
