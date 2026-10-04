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

/**
 * A registry holding, as the ledger actually holds it.
 *
 * `locked` matters as much as the amount: a holding reserved by an unsettled
 * allocation is not spendable, and the registry rejects it, so reporting the
 * raw balance alone would overstate what a party can trade.
 */
export interface RealHoldingView {
  holder: string;
  role: string;
  instrument: string;
  amount: string;
  locked: boolean;
  lockContext: string | null;
  cid: string;
}

/**
 * One leg of a registry allocation, the unit that actually moves tokens.
 *
 * A settled trade is two of these committed in a single update alongside the
 * ShadowDesk receipt, so the legs are what tie the on-chain workflow to real
 * balances rather than the workflow's own asset contracts.
 */
export interface RealLegView {
  settlementRef: string;
  legId: string;
  instrument: string;
  sender: string;
  receiver: string;
  amount: string;
  cid: string;
  at: string;
}

export interface InstitutionalProjection {
  buyerParty: string | null;
  assets: any[];
  rfqs: any[];
  proposals: any[];
  sealedQuotes: any[];
  deals: any[];
  receipts: any[];
  mandates: any[];
  realHoldings: RealHoldingView[];
  realLegs: RealLegView[];
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
  const emptyInst: DashboardState["institutional"] = {
    buyerParty: null, assets: [], rfqs: [], proposals: [], sealedQuotes: [], deals: [], receipts: [],
    mandates: [], realHoldings: [], realLegs: [],
  };

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

  // Real registry state is read per party because a holding belongs to its owner
  // and a party only sees its counterparty's holdings as an observer. A failure
  // here must not blank the ShadowDesk projection, which comes from `records`.
  const byParty: Array<[string, RawCreated[]]> = [["buyer", records]];
  for (const [role, party] of [
    ["dealerA", parties.dealerA],
    ["dealerB", parties.dealerB],
  ] as const) {
    if (!party) continue;
    try {
      const client = role === "dealerB" ? P2 : P1;
      if (!(await client.ping())) continue;
      byParty.push([role, await client.queryActiveContracts(party, await client.ledgerEnd())]);
    } catch {
      // Keep the buyer view even if a counterparty's node cannot be read.
    }
  }

  const publicProj = projectPublic(records);
  const instProj = projectInstitutional(parties.buyer, records, byParty);

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
  // An awarded RFQ is archived, so it is no longer in the active set. Count it
  // and emit its creation from the surviving award rather than dropping the
  // request from the public execution history.
  for (const r of records) {
    if (r.templateId.split(":").pop() !== "SealedQuote") continue;
    const a = r.createArgument;
    if (a?.rfq && !records.some((o) => o.contractId === a.rfq)) {
      counts.rfqs += 1;
      events.push({
        kind: "RFQ_CREATED",
        template: templateSuffix("BlockTradeRFQ"),
        ref: (a.rfqReference as string) || shortCid(a.rfq as string),
        cid: shortCid(a.rfq as string),
        at: r.createdAt,
        payload: "METADATA_ONLY",
      });
    }
  }
  events.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { events: events.reverse(), counts };
};

const projectInstitutional = (
  buyerParty: string,
  records: RawCreated[],
  byParty: Array<[string, RawCreated[]]>,
): InstitutionalProjection => {
  const byCid = new Map<string, RawCreated>(records.map((r) => [r.contractId, r]));
  const assets: any[] = [];
  const rfqs: any[] = [];
  const proposals: any[] = [];
  const sealedQuotes: any[] = [];
  const deals: any[] = [];
  const receipts: any[] = [];
  const mandates: any[] = [];

  // Mandates are resolved first so RFQs, sealed quotes, and receipts can be
  // labelled with the envelope they were authorised under. A TreasuryMandate
  // still on the ledger is one awaiting its second signature; Approving
  // consumes it and leaves the reusable ApprovedMandate behind.
  const mandateRefByCid = new Map<string, string>();
  for (const r of records) {
    const last = r.templateId.split(":").pop();
    if (last !== "TreasuryMandate" && last !== "ApprovedMandate") continue;
    const a = r.createArgument;
    mandateRefByCid.set(r.contractId, a.reference);
    mandates.push({
      status: last === "ApprovedMandate" ? "ACTIVE" : "PENDING",
      reference: a.reference,
      buyer: partyHint(a.buyer),
      riskOfficer: partyHint(a.riskOfficer),
      approvedDealers: (a.approvedDealers ?? []).map((d: string) => partyHint(d)),
      assetToBuy: a.assetToBuy,
      settlementAsset: a.settlementAsset,
      maxAmount: a.maxAmount,
      maxPrice: a.maxPrice,
      expiry: a.expiry,
      approvedAt: last === "ApprovedMandate" ? a.approvedAt : null,
      cid: shortCid(r.contractId),
      at: r.createdAt,
    });
  }
  mandates.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  // Awarding consumes the RFQ, so an awarded request leaves the active set.
  // The sealed quote is the surviving record of it, so rebuild those rows
  // from the award instead of letting the buyer's last round disappear.
  const rfqByCid = new Map<string, any>();
  for (const r of records) {
    if (r.templateId.split(":").pop() !== "BlockTradeRFQ") continue;
    const a = r.createArgument;
    rfqByCid.set(r.contractId, {
      reference: a.reference, assetToBuy: a.assetToBuy, settlementAsset: a.settlementAsset,
      amount: a.amount, maxPrice: a.maxPrice, expiry: a.expiry,
      dealers: (a.dealers ?? []).map((d: string) => partyHint(d)),
      mandated: Boolean(a.mandate),
      mandateRef: a.mandate ? mandateRefByCid.get(a.mandate) ?? null : null,
      cid: shortCid(r.contractId), at: r.createdAt, awarded: false,
    });
  }
  for (const r of records) {
    if (r.templateId.split(":").pop() !== "SealedQuote") continue;
    const a = r.createArgument;
    const rfqCid = a.rfq as string;
    if (rfqByCid.has(rfqCid)) continue;
    rfqByCid.set(rfqCid, {
      reference: a.rfqReference, assetToBuy: a.assetToBuy, settlementAsset: a.settlementAsset,
      amount: a.amount, maxPrice: a.maxPrice, expiry: a.expiry,
      dealers: (a.invitedDealers ?? []).map((d: string) => partyHint(d)),
      mandated: Boolean(a.mandate),
      mandateRef: a.mandate ? mandateRefByCid.get(a.mandate) ?? null : null,
      cid: shortCid(rfqCid), at: r.createdAt, awarded: true,
    });
  }
  rfqs.push(...rfqByCid.values());
  rfqs.sort((a, b) => String(a.at).localeCompare(String(b.at)));

  for (const r of records) {
    const last = r.templateId.split(":").pop();
    const a = r.createArgument;
    if (last === "Asset") {
      assets.push({
        holder: a.holder, symbol: a.id?.symbol, issuer: a.id?.issuer, quantity: a.quantity, reference: a.reference, cid: shortCid(r.contractId), at: r.createdAt,
      });
    } else if (last === "QuoteProposal") {
      proposals.push({
        rfqCid: a.rfq, rfqRef: byCid.get(a.rfq)?.createArgument?.reference ?? rfqByCid.get(a.rfq)?.reference ?? "",
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
        totalValue: a.totalValue, settledAt: a.settledAt,
        mandateRef: a.mandate ? mandateRefByCid.get(a.mandate) ?? null : null,
        cid: shortCid(r.contractId),
      });
    }
  }
  void buyerParty;
  return {
    buyerParty,
    assets,
    rfqs,
    proposals,
    sealedQuotes,
    deals,
    receipts,
    mandates,
    realHoldings: projectRealHoldings(byParty),
    realLegs: projectRealLegs(records),
  };
};

/**
 * Registry holdings, read from each party's own active contract set.
 *
 * A holding is keyed by its owner rather than assumed from the querying party,
 * because one ACS read returns every contract that party merely observes, which
 * includes the counterparty's holdings. Ownership is what decides whose balance
 * it is.
 */
const projectRealHoldings = (byParty: Array<[string, RawCreated[]]>): RealHoldingView[] => {
  const out: RealHoldingView[] = [];
  for (const [role, records] of byParty) {
    for (const r of records) {
      const last = r.templateId.split(":").pop();
      if (last !== "Holding") continue;
      const a = r.createArgument;
      const holder = a.owner as string | undefined;
      const instrument = a.instrument?.id as string | undefined;
      if (!holder || !instrument) continue;
      // `lock` is absent on a free holding and carries { lockers, context } when a
      // pending allocation has reserved it.
      const lock = a.lock;
      const hasLock =
        lock !== undefined &&
        lock !== null &&
        (Boolean(lock.context) || (Array.isArray(lock.lockers?.map) ? lock.lockers.map.length > 0 : Boolean(lock.lockers)));
      out.push({
        holder,
        role,
        instrument,
        amount: String(a.amount ?? "0"),
        locked: hasLock,
        lockContext: hasLock ? String(lock.context ?? "reserved") : null,
        cid: shortCid(r.contractId),
      });
    }
  }
  return out.sort((a, b) => a.role.localeCompare(b.role) || a.instrument.localeCompare(b.instrument));
};

/**
 * Registry allocation legs, which are the units that actually move tokens.
 *
 * Read from the active contract set because the allocation interfaces are not
 * published on every participant: a query by interface returns nothing here even
 * for allocations a direct scan finds immediately.
 */
const projectRealLegs = (records: RawCreated[]): RealLegView[] => {
  const out: RealLegView[] = [];
  for (const r of records) {
    const last = r.templateId.split(":").pop();
    if (last !== "DvpLegAllocation") continue;
    const allocation = r.createArgument?.allocation;
    const leg = allocation?.transferLeg;
    if (!leg?.instrumentId) continue;
    out.push({
      settlementRef: String(allocation.settlement?.settlementRef?.id ?? ""),
      legId: String(allocation.transferLegId ?? ""),
      instrument: String(leg.instrumentId.id ?? ""),
      sender: String(leg.sender ?? ""),
      receiver: String(leg.receiver ?? ""),
      amount: String(leg.amount ?? "0"),
      cid: shortCid(r.contractId),
      at: r.createdAt,
    });
  }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
};

const checkPrivacy = async (
  parties: DashboardState["parties"],
  p1Records: RawCreated[],
): Promise<{ checked: boolean; winnerDealer: string | null; losingDealer: string | null; losingSeesWinnerQuotes: number | null }> => {
  const sealed = p1Records.filter((r) => r.templateId.split(":").pop() === "SealedQuote");
  if (sealed.length === 0) return { checked: false, winnerDealer: null, losingDealer: null, losingSeesWinnerQuotes: null };

  const winnerDealer = partyHint((sealed[0].createArgument?.dealer as string) ?? "");
  const losingDealer = winnerDealer === "dealerA" ? "dealerB" : "dealerA";
  const losingParty = losingDealer === "dealerB" ? parties.dealerB : parties.dealerA;
  if (!losingParty) return { checked: false, winnerDealer, losingDealer, losingSeesWinnerQuotes: null };

  const client = losingDealer === "dealerB" ? P2 : P1;
  if (!(await client.ping())) return { checked: false, winnerDealer, losingDealer, losingSeesWinnerQuotes: null };
  const records = await client.queryActiveContracts(losingParty, await client.ledgerEnd());
  const winnerSeen = records.filter((r) => {
    const last = r.templateId.split(":").pop();
    if (last !== "SealedQuote" && last !== "QuoteProposal") return false;
    return r.createArgument?.dealer === (sealed[0].createArgument?.dealer as string);
  });
  return { checked: true, winnerDealer, losingDealer, losingSeesWinnerQuotes: winnerSeen.length };
};
