export interface PublicEventView {
  kind: string;
  template: string;
  ref: string;
  cid: string;
  at: string;
  payload: "METADATA_ONLY" | "ENC_QUOTE" | "ENC_DVP";
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
    rfqs: { reference: string; assetToBuy: string; settlementAsset: string; amount: string; maxPrice: string; expiry: string; dealers: string[]; cid: string; at: string }[];
    proposals: { rfqCid: string; rfqRef: string; dealer: string; offeredPrice: string; bidId: string; cid: string; at: string }[];
    sealedQuotes: { rfqCid: string; dealer: string; offeredPrice: string; bidId: string; cid: string; at: string }[];
    deals: { reference: string; security: string; quantity: string; unitPrice: string; cid: string; at: string }[];
    receipts: { reference: string; security: string; quantity: string; unitPrice: string; totalValue: string; settledAt: string; cid: string }[];
  };
  privacy: {
    checked: boolean;
    winnerDealer: string | null;
    losingDealer: string | null;
    losingSeesWinnerQuotes: number | null;
  };
}

export interface StreamLine {
  line?: string;
  done?: boolean;
  snapshot?: DashboardState;
  snapshotError?: string;
}