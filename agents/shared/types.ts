export const PACKAGE_NAME = "shadowdesk-treasury";
export const PACKAGE_ID = "50a21ee1be71aeae5c56c90db20491dd870004f1cd4fb47efcf7d3aa292d7c22";

export type Party = string;

export type SelectionPolicy = "LowestPriceThenBidId";

export interface TreasuryMandate {
  buyer: Party;
  riskOfficer: Party;
  approvedDealers: Party[];
  assetToBuy: string;
  settlementAsset: string;
  maxAmount: string;
  maxPrice: string;
  reference: string;
  expiry: string;
}

export interface ApprovedMandate extends TreasuryMandate {
  approvedAt: string;
}

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
  mandate: string | null;
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
  rfqReference: string;
  maxPrice: string;
  invitedDealers: Party[];
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
  mandate: string | null;
  settledAt: string;
}

export const TPL = {
  BlockTradeRFQ: `#${PACKAGE_NAME}:ShadowDesk.Rfq:BlockTradeRFQ`,
  QuoteProposal: `#${PACKAGE_NAME}:ShadowDesk.Rfq:QuoteProposal`,
  SealedQuote: `#${PACKAGE_NAME}:ShadowDesk.Rfq:SealedQuote`,
  TreasuryMandate: `#${PACKAGE_NAME}:ShadowDesk.Rfq:TreasuryMandate`,
  ApprovedMandate: `#${PACKAGE_NAME}:ShadowDesk.Rfq:ApprovedMandate`,
  Asset: `#${PACKAGE_NAME}:ShadowDesk.Asset:Asset`,
  Deal: `#${PACKAGE_NAME}:ShadowDesk.Settlement:Deal`,
  SettlementReceipt: `#${PACKAGE_NAME}:ShadowDesk.Settlement:SettlementReceipt`,
} as const;

export type TemplateKey = keyof typeof TPL;

/**
 * V2 settles real Token Standard instruments. It is a separate package because
 * InstrumentId replaces the synthetic symbol pair, and a changed template cannot
 * be replaced in place on a ledger.
 */
export const PACKAGE_NAME_V2 = "shadowdesk-treasury-v2";
export const PACKAGE_ID_V2 =
  "9e41d0b5b46ea3b63775e6e6c9f9dde5b4ce08a5280f9e721c6dd093a427a5fd";

export const TPL_V2 = {
  TreasuryMandate: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Rfq:TreasuryMandate`,
  ApprovedMandate: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Rfq:ApprovedMandate`,
  BlockTradeRFQ: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Rfq:BlockTradeRFQ`,
  QuoteProposal: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Rfq:QuoteProposal`,
  SealedQuote: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Rfq:SealedQuote`,
  SettlementPlan: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Settlement:SettlementPlan`,
  SettlementReceipt: `#${PACKAGE_NAME_V2}:ShadowDesk.V2.Settlement:SettlementReceipt`,
} as const;

export type TemplateKeyV2 = keyof typeof TPL_V2;

/**
 * A registry instrument is an id together with the admin party that issued it.
 * Binding the admin is what stops a second issuer reusing the same id.
 */
export interface RegistryInstrumentId {
  id: string;
  admin: Party;
}

export type LegRole = "SecurityLeg" | "PaymentLeg";

/**
 * The registry allocation a settlement leg will execute. Allocation contracts
 * live outside this package, so Daml cannot fetch them and the id is text.
 */
export interface AllocationLegRef {
  role: LegRole;
  allocationCid: string;
  instrument: RegistryInstrumentId;
  sender: Party;
  receiver: Party;
  amount: string;
}

export interface SettlementPlanV2 {
  reference: string;
  buyer: Party;
  dealer: Party;
  executor: Party;
  securityInstrument: RegistryInstrumentId;
  settlementInstrument: RegistryInstrumentId;
  quantity: string;
  unitPrice: string;
  securityLeg: AllocationLegRef;
  paymentLeg: AllocationLegRef;
  sealedQuote: string;
  expiry: string;
}

/**
 * Only the buyer is a signatory, so the receipt stays buyer-visible and the
 * seller's ledger never holds a copy of it.
 */
export interface SettlementReceiptV2 {
  reference: string;
  buyer: Party;
  dealer: Party;
  executor: Party;
  securityInstrument: RegistryInstrumentId;
  settlementInstrument: RegistryInstrumentId;
  quantity: string;
  unitPrice: string;
  totalValue: string;
  securityAllocationCid: string;
  paymentAllocationCid: string;
  rfq: string;
  sealedQuote: string;
  bidId: string;
  selectionPolicy: SelectionPolicy;
  mandate: string | null;
  settledAt: string;
}

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

export interface InterfaceCreatedEvent {
  offset: number;
  contractId: string;
  templateId: string;
  interfaceId: string;
  viewValue: any;
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
