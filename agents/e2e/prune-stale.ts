/**
 * Archive stale RFQ-round artifacts so the buyer party's active set stays
 * under the JSON API node limit.
 *
 * The DevNet node caps an `active-contracts` query at 200 matched elements and
 * answers 413 once a party's whole set exceeds it, which makes every
 * buyer-scoped read fail. The buyer's set accumulates unprunable round debris
 * (ApprovedMandate, SealedQuote, SettlementReceipt, Deal, Asset) plus stale
 * RFQs and quote proposals that DO have archiving choices, so this script
 * exercises the ones that exist:
 *
 *   - BlockTradeRFQ.CloseRfq                (controller buyer, archives the RFQ)
 *   - QuoteProposal.WithdrawProposal        (controller dealer, archives the quote)
 *   - ApprovedMandate.Archive               (implicit choice, signatories: buyer)
 *
 * The current round (the RFQ with the furthest expiry, plus the mandate with
 * the furthest expiry that backs it) is deliberately kept. Assets, holdings,
 * sealed quotes, deals and receipts are left alone.
 *
 * Run through the credential loader:
 *   scripts/env/with-devnet-auth.sh npm run prune:stale
 */

import { CantonClient } from "../shared/client.js";
import { settlementEnvironment } from "../shared/config.js";

const requiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required to prune stale contracts`);
  return value;
};

const isTooManyElements = (e: unknown): boolean =>
  e instanceof Error && e.message.includes("MAXIMUM_LIST_ELEMENTS") ||
  e instanceof Error && e.message.includes("node limit");

const isSoftFailure = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e);
  return /(contract|choice|already archived|not found|UNKNOWN|unarchived|absent)/i.test(msg);
};

const mandateCidOf = (rfq: any): string | null => {
  const m = rfq.createArgument?.mandate;
  if (typeof m === "string" && m.length > 0) return m;
  if (m && typeof m === "object") {
    const value = (m as any).value;
    if (typeof value === "string" && value.length > 0) return value;
    if (value && typeof value === "object" && typeof (value as any).contractId === "string") {
      return (value as any).contractId;
    }
  }
  return null;
};

const isoExpiry = (contract: any): string => {
  const raw = contract.createArgument?.expiry;
  return typeof raw === "string" ? raw : "";
};

const main = async (): Promise<void> => {
  const environment = settlementEnvironment();
  if (environment.network !== "devnet") {
    throw new Error("prune:stale only targets DevNet; set SHADOWDESK_NETWORK=devnet");
  }

  const buyer = requiredEnv("SHADOWDESK_BUYER_PARTY");
  const dealerA = requiredEnv("SHADOWDESK_DEALER_A_PARTY");
  const dealerB = requiredEnv("SHADOWDESK_DEALER_B_PARTY");
  const riskOfficer = requiredEnv("SHADOWDESK_RISK_OFFICER_PARTY");

  const client = new CantonClient(environment.participants.participant1.jsonApi, "participant1");
  const offset = await client.ledgerEnd();

  const [dealerAAll, dealerBAll, riskAll] = await Promise.all([
    client.queryAllContracts(dealerA, offset),
    client.queryAllContracts(dealerB, offset),
    client.queryAllContracts(riskOfficer, offset),
  ]);

  const rfqs = [...dealerAAll, ...dealerBAll]
    .filter((c) => c.templateId.endsWith(":ShadowDesk.Rfq:BlockTradeRFQ"))
    .filter((c, i, arr) => arr.findIndex((x) => x.contractId === c.contractId) === i);

  const quotes = [...dealerAAll, ...dealerBAll]
    .filter((c) => c.templateId.endsWith(":ShadowDesk.Rfq:QuoteProposal"))
    .filter((c, i, arr) => arr.findIndex((x) => x.contractId === c.contractId) === i);

  const mandates = riskAll
    .filter((c) => c.templateId.endsWith(":ShadowDesk.Rfq:ApprovedMandate"))
    .filter((c, i, arr) => arr.findIndex((x) => x.contractId === c.contractId) === i);

  const nowIso = new Date().toISOString();
  const liveRfq = [...rfqs].sort((a, b) => isoExpiry(b).localeCompare(isoExpiry(a)))[0];

  const rfqRef = (liveRfq?.createArgument?.reference as string) ?? "unknown";
  console.log(`[prune] current round RFQ: ${rfqRef} (keeping) with ${mandates.length} mandates visible`);
  console.log(`[prune] rfqs=${rfqs.length} quotes=${quotes.length} mandates=${mandates.length} buyer set is capped; pruning stale refs only`);

  const staleRfqs = rfqs.filter((c) => c.contractId !== liveRfq?.contractId);
  const staleQuotes = quotes.filter((c) => isoExpiry(c) < nowIso);
  // Keep the mandate that backs the live RFQ. If the serialized Optional did
  // not parse to a clean contract id, fall back to keeping the mandate with the
  // furthest expiry (the current round's), and never archive the parsed live
  // one plus the expiry floor: archiving the live RFQ's mandate would break
  // AcceptProposal's mandate fetch, so an extra kept contract is cheaper than a
  // wrongly archived one.
  const liveMandateCid = liveRfq ? mandateCidOf(liveRfq) : null;
  const maxExpiryMandate = [...mandates].sort((a, b) => isoExpiry(b).localeCompare(isoExpiry(a)))[0];
  const keepMandates = new Set([maxExpiryMandate?.contractId, liveMandateCid].filter(Boolean) as string[]);
  const staleMandates = mandates.filter((c) => !keepMandates.has(c.contractId));
  console.log(`[prune] keep ${keepMandates.size} mandate(s); archiving ${staleMandates.length}`);

  let ok = 0;
  let skipped = 0;
  let failed = 0;
  const run = async (label: string, fn: () => Promise<unknown>): Promise<void> => {
    try {
      await fn();
      ok += 1;
    } catch (e) {
      if (isSoftFailure(e)) {
        skipped += 1;
        console.log(`[prune] skip ${label}: ${e instanceof Error ? e.message : String(e)}`);
      } else {
        failed += 1;
        console.error(`[prune] FAIL ${label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  for (const rfq of staleRfqs) {
    const ref = (rfq.createArgument?.reference as string) ?? rfq.contractId.slice(0, 24);
    await run(`CloseRfq ${ref}`, () =>
      client.exerciseRaw(rfq.templateId, rfq.contractId, "CloseRfq", {}, [buyer], {}, `prune-rfq-${rfq.contractId.slice(-8)}`),
    );
  }

  for (const quote of staleQuotes) {
    const dealer = (quote.createArgument?.dealer as string) ?? dealerA;
    await run(`WithdrawProposal ${quote.contractId.slice(0, 24)}`, () =>
      client.exerciseRaw(quote.templateId, quote.contractId, "WithdrawProposal", {}, [dealer], {}, `prune-q-${quote.contractId.slice(-8)}`),
    );
  }

  for (const mandate of staleMandates) {
    await run(`Archive ${(mandate.createArgument?.reference as string) ?? mandate.contractId.slice(0, 24)}`, () =>
      client.exerciseRaw(mandate.templateId, mandate.contractId, "Archive", {}, [buyer, riskOfficer], {}, `prune-m-${mandate.contractId.slice(-8)}`),
    );
  }

  console.log(`[prune] ok=${ok} skipped(safe/absent)=${skipped} failed=${failed}`);

  // The set must be re-read at a fresh offset: a query pinned to the offset
  // captured before pruning still sees the pre-prune active set.
  const freshOffset = await client.ledgerEnd();
  try {
    const after = await client.queryAllContracts(buyer, freshOffset);
    console.log(`[prune] buyer active set AFTER: ${after.length}`);
  } catch (e) {
    if (isTooManyElements(e)) {
      console.log(`[prune] buyer active set AFTER: still over the node limit (${e instanceof Error ? e.message : String(e)})`);
    } else {
      throw e;
    }
  }
};

main().catch((error: unknown) => {
  console.error(`PRUNE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});