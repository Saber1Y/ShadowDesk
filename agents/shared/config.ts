export interface ParticipantEndpoint {
  name: string;
  jsonApi: string;
}

export const PARTICIPANTS: Record<string, ParticipantEndpoint> = {
  participant1: { name: "participant1", jsonApi: "http://127.0.0.1:6864" },
  participant2: { name: "participant2", jsonApi: "http://127.0.0.1:18003" },
};

export interface AssetIdSpec {
  issuer: string;
  symbol: string;
}

export const CUSDC: AssetIdSpec = { issuer: "ShadowDesk", symbol: "cUSDC" };
export const CTBILL: AssetIdSpec = { issuer: "ShadowDesk", symbol: "cTBILL" };