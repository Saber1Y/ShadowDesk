export interface ParticipantEndpoint {
  name: string;
  jsonApi: string;
}

const localParticipant1Url = "http://127.0.0.1:6864";
const localParticipant2Url = "http://127.0.0.1:18003";
const configuredParticipant1Url = process.env.SHADOWDESK_PARTICIPANT1_URL || localParticipant1Url;
const configuredParticipant2Url = process.env.SHADOWDESK_PARTICIPANT2_URL || (
  process.env.SHADOWDESK_NETWORK === "devnet" ? configuredParticipant1Url : localParticipant2Url
);

export const PARTICIPANTS: Record<string, ParticipantEndpoint> = {
  participant1: { name: "participant1", jsonApi: configuredParticipant1Url },
  participant2: { name: "participant2", jsonApi: configuredParticipant2Url },
};

export interface AssetIdSpec {
  issuer: string;
  symbol: string;
}

export interface TokenInstrument extends AssetIdSpec {
  id: string;
  registryUrl: string;
  decimals: number;
  supportedApis: string[];
}

export const CUSDC: AssetIdSpec = { issuer: "ShadowDesk", symbol: "cUSDC" };
export const CTBILL: AssetIdSpec = { issuer: "ShadowDesk", symbol: "cTBILL" };

export const CBTC_DEVNET: TokenInstrument = {
  issuer: "cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff",
  symbol: "CBTC",
  id: "CBTC",
  registryUrl: "https://api.utilities.digitalasset-dev.com",
  decimals: 10,
  supportedApis: [
    "splice-api-token-holding-v2",
    "splice-api-token-allocation-v2",
    "splice-api-token-allocation-instruction-v2",
    "splice-api-token-transfer-instruction-v2",
  ],
};

export type SettlementNetwork = "localnet" | "devnet";

export interface SettlementEnvironment {
  network: SettlementNetwork;
  participants: Record<string, ParticipantEndpoint>;
  registryUrl: string;
  bitsafeApiUrl?: string;
  decentralizedPartyId?: string;
  cbtc: TokenInstrument;
}

const environmentValue = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
};

export const settlementEnvironment = (): SettlementEnvironment => {
  const network: SettlementNetwork = environmentValue("SHADOWDESK_NETWORK") === "devnet" ? "devnet" : "localnet";
  if (network === "localnet") {
    return {
      network,
      participants: PARTICIPANTS,
      registryUrl: CBTC_DEVNET.registryUrl,
      cbtc: CBTC_DEVNET,
    };
  }

  const participant1 = environmentValue("SHADOWDESK_PARTICIPANT1_URL");
  const participant2 = environmentValue("SHADOWDESK_PARTICIPANT2_URL") ?? participant1;
  if (!participant1 || !participant2) {
    throw new Error("DevNet requires SHADOWDESK_PARTICIPANT1_URL");
  }
  return {
    network,
    participants: {
      participant1: { name: "participant1", jsonApi: participant1 },
      participant2: { name: "participant2", jsonApi: participant2 },
    },
    registryUrl: environmentValue("SHADOWDESK_REGISTRY_URL") ?? CBTC_DEVNET.registryUrl,
    bitsafeApiUrl: environmentValue("SHADOWDESK_BITSAFE_API_URL"),
    decentralizedPartyId: environmentValue("SHADOWDESK_DECENTRALIZED_PARTY_ID"),
    cbtc: CBTC_DEVNET,
  };
};

export const SUPPORTED_ASSETS: Record<string, AssetIdSpec> = {
  cTBILL: CTBILL,
  cUSDC: CUSDC,
};
