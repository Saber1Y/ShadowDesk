import { CantonClient, PARTICIPANTS, partyHint, shortCid, templateSuffix } from "@/lib/canton";
import { getCantonAuth } from "@/lib/canton-auth";

interface RawCreated {
  offset: number;
  contractId: string;
  templateId: string;
  createdAt: string;
  createArgument: Record<string, any>;
  signatories: string[];
  observers: string[];
}

export interface PublicEvent {
  kind: string;
  template: string;
  ref: string;
  cid: string;
  at: string;
  payload: "METADATA_ONLY" | "ENC_QUOTE" | "ENC_DVP";
}

export interface PublicProjection {
  events: PublicEvent[];
  counts: { rfqs: number; proposals: number; sealed: number; deals: number; receipts: number; assets: number };
}

export interface InstitutionalProjection {
  buyerParty: string | null;
  assets: any[];
  rfqs: any[];
  proposals: any[];
  sealedQuotes: any[];
  deals: any[];
  receipts: any[];
}

export interface DashboardState {
  updatedAt: string;
  participants: { name: string; jsonApi: string; reachable: boolean; ledgerEnd: number | null }[];
  parties: { buyer: string | null; dealerA: string | null; dealerB: string | null };
  public: PublicProjection;
  institutional: InstitutionalProjection;
  privacy: {
    checked: boolean;
    winnerDealer: string | null;
    losingDealer: string | null;
    losingSeesWinnerQuotes: number | null;
  };
}

const P1 = new CantonClient(PARTICIPANTS.participant1.jsonApi);
const P2 = new CantonClient(PARTICIPANTS.participant2.jsonApi);

export const loadDashboardState = async (): Promise<DashboardState> => {
  if (process.env.SHADOWDESK_NETWORK === "devnet") {
    await getCantonAuth();
    await P1.verifyLedgerIdentity();
  }
  const [p1Ok, p2Ok] = [await P1.ping(), await P2.ping()];
  const participants = [
    {
      name: PARTICIPANTS.participant1.name,
      jsonApi: PARTICIPANTS.participant1.jsonApi,
      reachable: p1Ok,
      ledgerEnd: p1Ok ? await P1.ledgerEnd() : null,
    },
    {
      name: PARTICIPANTS.participant2.name,
      jsonApi: PARTICIPANTS.participant2.jsonApi,
      reachable: p2Ok,
      ledgerEnd: p2Ok ? await P2.ledgerEnd() : null,
    },
  ];

  const parties: DashboardState["parties"] = { buyer: null, dealerA: null, dealerB: null };
  if (process.env.SHADOWDESK_NETWORK === "devnet") {
    parties.buyer = process.env.SHADOWDESK_BUYER_PARTY ?? null;
    parties.dealerA = process.env.SHADOWDESK_DEALER_A_PARTY ?? null;
    parties.dealerB = process.env.SHADOWDESK_DEALER_B_PARTY ?? null;
  } else {
    const map = new Map<string, string>();
    if (p1Ok) {
      for (const p of await allPartiesSafe(P1, ["buyer", "dealerA"])) map.set(p, partyHint(p));
    }
    if (p2Ok) {
      for (const p of await allPartiesSafe(P2, ["dealerB"])) map.set(p, partyHint(p));
    }
    for (const [party, hint] of map) {
      if (hint === "buyer") parties.buyer = party;
      if (hint === "dealerA") parties.dealerA = party;
      if (hint === "dealerB") parties.dealerB = party;
    }
  }

  const empty: DashboardState["public"] = { events: [], counts: { rfqs: 0, proposals: 0, sealed: 0, deals: 0, receipts: 0, assets: 0 } };
  const emptyInst: DashboardState["institutional"] = { buyerParty: null, assets: [], rfqs: [], proposals: [], sealedQuotes: [], deals: [], receipts: [] };

  if (!parties.buyer) {
    return {
      updatedAt: new Date().toISOString(),
      participants,
      parties,
      public: empty,
      institutional: emptyInst,
      privacy: { checked: false, winnerDealer: null, losingDealer: null, losingSeesWinnerQuotes: null },
    };
  }

  const p1Contracts = await P1.queryActiveContracts(parties.buyer, await P1.ledgerEnd());
  const records = p1Contracts.sort((a, b) => a.offset - b.offset);

  const publicProj = projectPublic(records);
  const instProj = projectInstitutional(parties.buyer, records);

  const privacy = await checkPrivacy(parties, records);

  return {
    updatedAt: new Date().toISOString(),
    participants,
    parties,
    public: publicProj,
    institutional: instProj,
    privacy,
  };
};

const allPartiesSafe = async (client: CantonClient, hints: string[]): Promise<string[]> => {
  const all = await client.listParties();
  return all.filter((p) => hints.includes(partyHint(p)));
};

const projectPublic = (records: RawCreated[]): PublicProjection => {
  const counts = { rfqs: 0, proposals: 0, sealed: 0, deals: 0, receipts: 0, assets: 0 };
  const events: PublicEvent[] = [];
  for (const r of records) {
    const t = templateSuffix(r.templateId);
    const last = r.templateId.split(":").pop() ?? "";
    const ref = (r.createArgument?.reference as string) ?? "";
    let kind = last;
    let payload: PublicEvent["payload"] = "METADATA_ONLY";
    if (last === "BlockTradeRFQ") {
      counts.rfqs += 1;
      kind = "RFQ_CREATED";
    } else if (last === "QuoteProposal") {
      counts.proposals += 1;
      kind = "QUOTE_PROPOSAL";
      payload = "ENC_QUOTE";
    } else if (last === "SealedQuote") {
      counts.sealed += 1;
      kind = "QUOTE_SEALED";
      payload = "ENC_QUOTE";
    } else if (last === "Deal") {
      counts.deals += 1;
      kind = "DEAL_CREATED";
      payload = "ENC_DVP";
    } else if (last === "SettlementReceipt") {
      counts.receipts += 1;
      kind = "DVP_SETTLED";
      payload = "ENC_DVP";
    } else if (last === "Asset") {
      counts.assets += 1;
      kind = "ASSET_MOVED";
    }
    events.push({
      kind,
      template: t,
      ref: ref || (r.createArgument?.reference as string) || r.createArgument?.bidId || shortCid(r.contractId),
      cid: shortCid(r.contractId),
      at: r.createdAt,
      payload,
    });
  }
  return { events: events.reverse(), counts };
};

const projectInstitutional = (buyerParty: string, records: RawCreated[]): InstitutionalProjection => {
  const byCid = new Map<string, RawCreated>(records.map((r) => [r.contractId, r]));
  const assets: any[] = [];
  const rfqs: any[] = [];
  const proposals: any[] = [];
  const sealedQuotes: any[] = [];
  const deals: any[] = [];
  const receipts: any[] = [];

  for (const r of records) {
    const last = r.templateId.split(":").pop();
    const a = r.createArgument;
    if (last === "Asset") {
      assets.push({
        holder: a.holder, symbol: a.id?.symbol, issuer: a.id?.issuer, quantity: a.quantity, reference: a.reference, cid: shortCid(r.contractId), at: r.createdAt,
      });
    } else if (last === "BlockTradeRFQ") {
      rfqs.push({
        reference: a.reference, assetToBuy: a.assetToBuy, settlementAsset: a.settlementAsset,
        amount: a.amount, maxPrice: a.maxPrice, expiry: a.expiry,
        dealers: (a.dealers ?? []).map((d: string) => partyHint(d)),
        cid: shortCid(r.contractId), at: r.createdAt,
      });
    } else if (last === "QuoteProposal") {
      proposals.push({
        rfqCid: a.rfq, rfqRef: byCid.get(a.rfq)?.createArgument?.reference ?? "",
        dealer: partyHint(a.dealer), offeredPrice: a.offeredPrice, bidId: a.bidId,
        cid: shortCid(r.contractId), at: r.createdAt,
      });
    } else if (last === "SealedQuote") {
      sealedQuotes.push({
        rfqCid: a.rfq, dealer: partyHint(a.dealer), offeredPrice: a.offeredPrice, bidId: a.bidId,
        cid: shortCid(r.contractId), at: r.createdAt,
      });
    } else if (last === "Deal") {
      deals.push({
        reference: a.reference, security: a.security?.symbol, quantity: a.quantity, unitPrice: a.unitPrice,
        cid: shortCid(r.contractId), at: r.createdAt,
      });
    } else if (last === "SettlementReceipt") {
      receipts.push({
        reference: a.reference, security: a.security?.symbol, quantity: a.quantity, unitPrice: a.unitPrice,
        totalValue: a.totalValue, settledAt: a.settledAt, cid: shortCid(r.contractId),
      });
    }
  }
  void buyerParty;
  return { buyerParty, assets, rfqs, proposals, sealedQuotes, deals, receipts };
};

const checkPrivacy = async (
  parties: DashboardState["parties"],
  p1Records: RawCreated[],
): Promise<{ checked: boolean; winnerDealer: string | null; losingDealer: string | null; losingSeesWinnerQuotes: number | null }> => {
  if (P1.baseUrl === P2.baseUrl) {
    return { checked: false, winnerDealer: null, losingDealer: null, losingSeesWinnerQuotes: null };
  }
  const sealed = p1Records.filter((r) => r.templateId.split(":").pop() === "SealedQuote");
  if (sealed.length === 0) return { checked: true, winnerDealer: null, losingDealer: null, losingSeesWinnerQuotes: null };

  const winnerDealer = partyHint((sealed[0].createArgument?.dealer as string) ?? "");
  const losingDealer = winnerDealer === "dealerA" ? "dealerB" : "dealerA";
  const losingParty = losingDealer === "dealerB" ? parties.dealerB : parties.dealerA;
  if (!losingParty) return { checked: true, winnerDealer, losingDealer, losingSeesWinnerQuotes: null };

  const client = losingDealer === "dealerB" ? P2 : P1;
  if (!(await client.ping())) return { checked: true, winnerDealer, losingDealer, losingSeesWinnerQuotes: null };
  const records = await client.queryActiveContracts(losingParty, await client.ledgerEnd());
  const winnerSeen = records.filter((r) => {
    const last = r.templateId.split(":").pop();
    if (last !== "SealedQuote" && last !== "QuoteProposal") return false;
    return r.createArgument?.dealer === (sealed[0].createArgument?.dealer as string);
  });
  return { checked: true, winnerDealer, losingDealer, losingSeesWinnerQuotes: winnerSeen.length };
};
