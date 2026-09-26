import { CantonClient } from "../shared/client.js";
import { PACKAGE_ID } from "../shared/types.js";
import { BuyerAgent, defaultRfq, SELECTION_POLICY } from "../buyer/buyer.js";
import { settleDeal } from "../shared/settlement.js";
import { CTBILL, CUSDC } from "../shared/config.js";

const baseUrl = process.env.SHADOWDESK_LEDGER_URL ?? "http://127.0.0.1:6864";

const assertPackageUploaded = async (): Promise<void> => {
  const resp = await fetch(`${baseUrl}/v2/packages`);
  const body = (await resp.json()) as { packageIds?: string[] };
  const ids = body.packageIds ?? [];
  if (!ids.includes(PACKAGE_ID)) {
    throw new Error(`ledger does not have package ${PACKAGE_ID}; upload the current DAR first`);
  }
  console.log(`[e2e] ledger serves pinned package ${PACKAGE_ID.slice(0, 16)}...`);
};

const main = async (): Promise<void> => {
  const buyer = new BuyerAgent(baseUrl, "participant1");
  const buyerParty = await buyer.provision();
  await assertPackageUploaded();
  const client = new CantonClient(baseUrl, "participant1", "shadowdesk-agent");
  const dealerParty = `${buyerParty}`;

  const now = Date.now();
  const expiry = new Date(now + 24 * 3600 * 1000).toISOString();
  const amount = 1_000_000;
  const unitPrice = 100.5;

  const cashTx = await client.create(
    "Asset",
    {
      holder: buyerParty,
      id: { issuer: "ShadowDesk", symbol: CUSDC.symbol },
      quantity: String(amount * unitPrice),
      reference: "E2E-CASH",
    },
    [buyerParty],
    `e2e-cash-${now}`,
  );
  const cashCid = (cashTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Asset:Asset"))!.contractId;

  const bondTx = await client.create(
    "Asset",
    {
      holder: dealerParty,
      id: { issuer: "ShadowDesk", symbol: CTBILL.symbol },
      quantity: String(amount),
      reference: "E2E-BOND",
    },
    [dealerParty],
    `e2e-bond-${now}`,
  );
  const bondCid = (bondTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Asset:Asset"))!.contractId;

  const spec = defaultRfq(1, [dealerParty], { amount, maxPrice: 101 });
  spec.reference = `RFQ-E2E-${now}`;
  spec.expiry = expiry;
  const rfqCid = await buyer.createRfq(spec);
  console.log(`[e2e] rfq created policy=${SELECTION_POLICY} cid=${rfqCid.slice(0, 24)}...`);

  const rfqs = await client.queryActiveContracts(buyerParty, ["ShadowDesk.Rfq:BlockTradeRFQ"], await client.ledgerEnd());
  const onLedgerPolicy = (rfqs[0] as any).createArgument.selectionPolicy;
  if (onLedgerPolicy !== SELECTION_POLICY) {
    throw new Error(`ledger stored policy ${onLedgerPolicy}, expected ${SELECTION_POLICY}`);
  }
  console.log(`[e2e] ledger round-tripped policy as ${JSON.stringify(onLedgerPolicy)}`);

  const proposalTx = await client.exercise(
    "BlockTradeRFQ",
    rfqCid,
    "SubmitQuoteProposal",
    { dealer: dealerParty, offeredPrice: String(unitPrice), bidId: "BID-E2E-1" },
    [dealerParty],
    `e2e-quote-${now}`,
  );
  const proposalCid = ((proposalTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent ?? e.ExercisedEvent?.exerciseResult)
    .filter(Boolean)
    .find((e: any) => typeof e.contractId === "string" && !e.templateId?.includes("SealedQuote")) as any)
    ?.contractId;
  if (!proposalCid) throw new Error("could not resolve proposal contract id");
  console.log(`[e2e] proposal submitted`);

  const acceptTx = await client.exercise(
    "QuoteProposal",
    proposalCid,
    "AcceptProposal",
    { maxPrice: "101.0" },
    [buyerParty],
    `e2e-accept-${now}`,
  );
  const sealedEvent = (acceptTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Rfq:SealedQuote"));
  if (!sealedEvent) throw new Error("no sealed quote");
  const sealedCid: string = sealedEvent.contractId;
  if (sealedEvent.createArgument.rfqReference !== spec.reference) {
    throw new Error(
      `Award records request ${sealedEvent.createArgument.rfqReference}, expected ${spec.reference}`,
    );
  }
  if (Number(sealedEvent.createArgument.maxPrice) !== spec.maxPrice) {
    throw new Error(
      `Award records max price ${sealedEvent.createArgument.maxPrice}, expected ${spec.maxPrice}`,
    );
  }
  console.log(
    `[e2e] sealed quote policy=${sealedEvent.createArgument.selectionPolicy} ref=${sealedEvent.createArgument.rfqReference} maxPrice=${sealedEvent.createArgument.maxPrice} invited=${sealedEvent.createArgument.invitedDealers?.length}`,
  );

  let secondAwardRejected = false;
  try {
    await client.exercise(
      "QuoteProposal",
      proposalCid,
      "AcceptProposal",
      { maxPrice: String(spec.maxPrice) },
      [buyerParty],
      `e2e-second-award-${now}`,
    );
  } catch (e) {
    secondAwardRejected = true;
    console.log(`[e2e] second award rejected: ${String(e).split("\n")[0].slice(0, 110)}`);
  }
  if (!secondAwardRejected) throw new Error("ledger accepted a second award for the same RFQ");

  const awards = await client.queryActiveContracts(buyerParty, ["ShadowDesk.Rfq:SealedQuote"], await client.ledgerEnd());
  if (awards.length !== 1) throw new Error(`expected exactly one award, found ${awards.length}`);

  const { receiptCid, receipt } = await settleDeal(client, {
    reference: `DEAL-E2E-${now}`,
    buyer: buyerParty,
    dealer: dealerParty,
    securitySymbol: CTBILL.symbol,
    quantity: amount,
    unitPrice,
    paymentCid: cashCid,
    securityCid: bondCid,
    settlementAsset: CUSDC,
    sealedQuoteCid: sealedCid,
    expectedBidId: "BID-E2E-1",
    expectedPolicy: SELECTION_POLICY,
    expiry,
  });
  console.log(`[e2e] settled receipt=${receiptCid.slice(0, 24)}...`);
  console.log(`[e2e] receipt bidId=${receipt.bidId} policy=${receipt.selectionPolicy} value=${receipt.totalValue}`);

  const cash2Tx = await client.create(
    "Asset",
    {
      holder: buyerParty,
      id: { issuer: "ShadowDesk", symbol: CUSDC.symbol },
      quantity: String(amount * unitPrice),
      reference: "E2E-CASH-2",
    },
    [buyerParty],
    `e2e-cash2-${now}`,
  );
  const cash2Cid = (cash2Tx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Asset:Asset"))!.contractId;

  const bond2Tx = await client.create(
    "Asset",
    {
      holder: dealerParty,
      id: { issuer: "ShadowDesk", symbol: CTBILL.symbol },
      quantity: String(amount),
      reference: "E2E-BOND-2",
    },
    [dealerParty],
    `e2e-bond2-${now}`,
  );
  const bond2Cid = (bond2Tx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Asset:Asset"))!.contractId;

  const badDealTx = await client.create(
    "Deal",
    {
      reference: `DEAL-E2E-BAD-${now}`,
      buyer: buyerParty,
      dealer: dealerParty,
      security: { issuer: "ShadowDesk", symbol: CTBILL.symbol },
      quantity: String(amount),
      unitPrice: "99.00",
      settlementAsset: CUSDC,
      paymentCid: cash2Cid,
      securityCid: bond2Cid,
      sealedQuote: sealedCid,
      expiry,
    },
    [buyerParty, dealerParty],
    `e2e-bad-deal-${now}`,
  );
  const badDealCid = (badDealTx.transaction.events as any[])
    .map((e: any) => e.CreatedEvent)
    .filter(Boolean)
    .find((e: any) => e.templateId.endsWith(":ShadowDesk.Settlement:Deal"))!.contractId;

  let rejected = false;
  try {
    await client.exercise("Deal", badDealCid, "Settle", {}, [buyerParty, dealerParty], `e2e-bad-settle-${now}`);
  } catch (e) {
    rejected = true;
    console.log(`[e2e] mismatched deal rejected: ${String(e).split("\n")[0].slice(0, 140)}`);
  }
  if (!rejected) throw new Error("ledger accepted a Deal that did not match the awarded quote");

  const bond2Alive = await client.queryActiveContracts(dealerParty, ["ShadowDesk.Asset:Asset"], await client.ledgerEnd());
  const stillHeld = bond2Alive.some((c: any) => c.contractId === bond2Cid);
  if (!stillHeld) throw new Error("security asset moved despite the rejected settlement");
  console.log("[e2e] security asset untouched after rejection");

  console.log("E2E AWARD CHAIN OK");
};

main().catch((e) => {
  console.error("E2E FAILED:", e);
  process.exit(1);
});
