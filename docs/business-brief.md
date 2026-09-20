# ShadowDesk - One-Page Business Brief

## What it is

ShadowDesk is a private institutional RFQ (request-for-quote) venue on the Canton Network for large block trades of tokenized assets.

Institutional funds avoid the public order book when building large positions, because size reveals strategy and invites front-running. Today those blocks are sourced by phone and email. ShadowDesk moves the whole workflow - private invite, blind competitive pricing, and settlement - onto Canton, where the confidentiality boundary is enforced by the ledger's contract stakeholders and participant privacy rather than by an application layer.

## The problem

A fund buying 1M of tokenized T-bills cannot show the market its intent.

- Public blockchains expose order size, timing, counterparties, and execution price to observers.
- That information lets counterparties widen spreads and front-runs arbitrage the flow.
- Existing "private" RFQ demos protect data only in the app layer; the data is still visible to the platform.

Regulated institutions need a venue where price competition happens without any dealer seeing a competitor's price.

## How ShadowDesk solves it

1. The fund's buyer agent creates a private `BlockTradeRFQ` with a max price, inviting only approved dealers.
2. Each dealer agent submits a `QuoteProposal` - signatory to that dealer alone, observed only by the buyer. No dealer sees a competitor's price.
3. The buyer agent selects the best executable quote (lowest in-limit price) and seals it into a binding `SealedQuote`.
4. `Deal` and `Settle` perform atomic delivery-versus-payment: the fund receives the asset and the dealer receives payment in one Canton transaction, or neither happens.
5. A `SettlementReceipt` gives both parties a private audit record. The wider network sees no order book, no competing prices, and no fund identity.

Privacy is proven, not promised: the demo asserts on the live ledger that a losing dealer on a separate participant observes **zero** of the winner's quotes, and the dashboard surfaces that check continuously.

## Why Canton

- Privacy is a ledger primitive: contract data is encoded for and visible only to involved parties, across participants on the same synchronizer.
- Atomic multi-party settlement runs in a single transaction, which is exactly what DvP needs.
- Regulated-market institutional capabilities (synthetic privacy via the Global Synchronizer) map directly to how banks are already piloting the network.

## Business value

| Pain today | ShadowDesk outcome |
| --- | --- |
| Blocks sourced by phone/email, leaky and slow | Structured, private RFQ with competitive blind pricing |
| Dealers can infer each other's pricing | Prices visible only to buyer + quoting dealer |
| Settlement risk between separate systems | Atomic DvP in one ledger transaction |
| Platform can see your flow | Confidentiality enforced at the contract layer |

Addressable flow: tokenized treasuries first (largest on-chain RWA category), then commercial paper, private credit, fund units, and stablecoin treasury operations - anywhere liquidity providers must quote privately.

## Where we are today

A working three-week-built MVP: Daml contract templates, buyer/dealer agent services on two Canton participants, a live institutional dashboard (buyer view + public metadata projection), and a one-shot clean-environment reproduction script. Each round runs real concurrent two-participant ledger transactions and asserts quote isolation end-to-end.

## Ask

- Pilot with one asset manager and two liquidity providers on the Canton DevNet, using the CIP-025-style asset standard once available.
- Two weeks: DevNet deployment with a real asset registry, three dealers, and an auditor view.
- Add a compliance/audit party and RFQ amendment workflow for the regulated-fund sales cycle.