export interface PublicEventView {
  kind: string;
  template: string;
  ref: string;
  cid: string;
  at: string;
  payload: "METADATA_ONLY" | "ENC_QUOTE" | "ENC_DVP";
}

export interface MandateView {
  status: "ACTIVE" | "PENDING";
  reference: string;
  buyer: string;
  riskOfficer: string;
  approvedDealers: string[];
  assetToBuy: string;
  settlementAsset: string;
  maxAmount: string;
  maxPrice: string;
  expiry: string;
  approvedAt: string | null;
  cid: string;
  at: string;
}

/**
 * A registry holding, as the ledger actually holds it.
 *
 * `locked` matters as much as the amount: a holding reserved by an unsettled
 * allocation cannot be spent, so reporting the balance alone would overstate
 * what a party can trade.
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
 * What a real-token settle actually returned.
 *
 * Registry allocations are consumed by their own execution, so they leave the
 * active contract set and cannot be read back. This is captured from the settle
 * response instead, which is also the only place the update id tying the receipt
 * to both transfers is available.
 */
export interface RealSettlementRecord {
  settlementRef: string;
  receiptCid: string;
  updateId: string;
  delivered: string;
  payment: string;
  legs: Array<{
    cid: string;
    legId: string;
    instrument: string;
    sender: string;
    receiver: string;
    amount: string;
  }>;
}

/** One leg of a registry allocation, the unit that actually moves tokens. */
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

export interface DashboardState {
  updatedAt: string;
  participants: { name: string; jsonApi: string; reachable: boolean; ledgerEnd: number | null }[];
  parties: { buyer: string | null; dealerA: string | null; dealerB: string | null };
  public: {
    events: PublicEventView[];
    counts: { rfqs: number; proposals: number; sealed: number; deals: number; receipts: number; assets: number };
  };
  institutional: {
    buyerParty: string | null;
    assets: { holder: string; symbol: string; issuer: string; quantity: string; reference: string; cid: string; at: string }[];
    rfqs: { reference: string; assetToBuy: string; settlementAsset: string; amount: string; maxPrice: string; expiry: string; dealers: string[]; mandated: boolean; mandateRef: string | null; cid: string; at: string; awarded: boolean }[];
    proposals: { rfqCid: string; rfqRef: string; dealer: string; offeredPrice: string; bidId: string; cid: string; at: string }[];
    sealedQuotes: { rfqCid: string; dealer: string; offeredPrice: string; bidId: string; cid: string; at: string }[];
    deals: { reference: string; security: string; quantity: string; unitPrice: string; cid: string; at: string }[];
    receipts: { reference: string; security: string; quantity: string; unitPrice: string; totalValue: string; settledAt: string; mandateRef: string | null; cid: string }[];
    mandates: MandateView[];
    realHoldings: RealHoldingView[];
    realLegs: RealLegView[];
  };
  /** Present only after a real-token round has run in this server's lifetime. */
  realSettlements?: RealSettlementRecord[];
  privacy: {
    checked: boolean;
    winnerDealer: string | null;
    losingDealer: string | null;
    losingSeesWinnerQuotes: number | null;
  };
}

export interface AuthUser {
  sub: string;
  email?: string;
  name?: string;
  preferredUsername?: string;
}

export interface AuthStatus {
  mode: "localnet" | "devnet";
  authenticated: boolean;
  user: AuthUser | null;
  source?: "wallet" | "environment" | "localnet";
  reason?: "expired" | "configuration";
}

export interface StreamLine {
  line?: string;
  done?: boolean;
  snapshot?: DashboardState;
  snapshotError?: string;
}