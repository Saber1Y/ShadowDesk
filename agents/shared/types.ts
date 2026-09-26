export const PACKAGE_NAME = "shadowdesk-rfq";
export const PACKAGE_ID = "0450b46f9ccfaab4fc4730394d7dc38ba36a379827a16881b82c7431b677f979";

export type Party = string;

export type SelectionPolicy = "LowestPriceThenBidId";

export interface AssetId {
  issuer: string;
  symbol: string;
}

export interface BlockTradeRFQ {
  buyer: Party;
  dealers: Party[];
  assetToBuy: string;
  settlementAsset: string;
  amount: string;
  maxPrice: string;
  selectionPolicy: SelectionPolicy;
  reference: string;
  expiry: string;
}

export interface QuoteProposal {
  rfq: string;
  buyer: Party;
  dealer: Party;
  assetToBuy: string;
  settlementAsset: string;
  amount: string;
  offeredPrice: string;
  bidId: string;
  expiry: string;
}

export interface SealedQuote {
  rfq: string;
  buyer: Party;
  dealer: Party;
  assetToBuy: string;
  settlementAsset: string;
  amount: string;
  offeredPrice: string;
  bidId: string;
  selectionPolicy: SelectionPolicy;
  expiry: string;
}

export interface Asset {
  holder: Party;
  id: AssetId;
  quantity: string;
  reference: string;
}

export interface Deal {
  reference: string;
  buyer: Party;
  dealer: Party;
  security: AssetId;
  quantity: string;
  unitPrice: string;
  settlementAsset: AssetId;
  paymentCid: string;
  securityCid: string;
  sealedQuote: string;
  expiry: string;
}

export interface SettlementReceipt {
  reference: string;
  buyer: Party;
  dealer: Party;
  security: AssetId;
  quantity: string;
  unitPrice: string;
  totalValue: string;
  rfq: string;
  sealedQuote: string;
  bidId: string;
  selectionPolicy: SelectionPolicy;
  settledAt: string;
}

export const TPL = {
  BlockTradeRFQ: `#${PACKAGE_NAME}:ShadowDesk.Rfq:BlockTradeRFQ`,
  QuoteProposal: `#${PACKAGE_NAME}:ShadowDesk.Rfq:QuoteProposal`,
  SealedQuote: `#${PACKAGE_NAME}:ShadowDesk.Rfq:SealedQuote`,
  Asset: `#${PACKAGE_NAME}:ShadowDesk.Asset:Asset`,
  Deal: `#${PACKAGE_NAME}:ShadowDesk.Settlement:Deal`,
  SettlementReceipt: `#${PACKAGE_NAME}:ShadowDesk.Settlement:SettlementReceipt`,
} as const;

export type TemplateKey = keyof typeof TPL;

export const suffixOf = (templateId: string) => templateId.split(":").slice(1).join(":");

export interface CreatedEvent {
  offset: number;
  nodeId: number;
  contractId: string;
  templateId: string;
  createArgument: Record<string, unknown>;
  signatories: Party[];
  observers: Party[];
  witnessParties: Party[];
}

export interface ArchivedEvent {
  offset: number;
  nodeId: number;
  contractId: string;
  templateId: string;
}

export interface ExercisedEvent {
  offset: number;
  nodeId: number;
  contractId: string;
  parentingContractId: string;
  templateId: string;
  choice: string;
  choiceArgument: Record<string, unknown>;
  exerciseResult: unknown;
}

export type LedgerEvent = CreatedEvent | ArchivedEvent | ExercisedEvent;

export interface TransactionResponse {
  transaction: {
    updateId: string;
    commandId: string;
    effectiveAt: string;
    offset: number;
    events: Record<string, unknown>[];
  };
}

export interface PartyDetails {
  party: Party;
  isLocal: boolean;
}