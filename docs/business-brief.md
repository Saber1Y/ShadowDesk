# ShadowDesk - One-Page Business Brief

## What it is

ShadowDesk is a policy-controlled treasury execution layer on the Canton Network for institutional rebalancing of tokenized assets.

Institutional funds need competitive execution without giving an agent unlimited discretion. Today treasury instructions, dealer quotes, risk approval, and settlement are split across email, trading terminals, and operations systems. ShadowDesk records the buyer mandate and risk approval on Canton, then constrains private dealer execution and settlement against that policy.

## The problem

A fund buying 1M of tokenized T-bills cannot show the market its intent.

- Public blockchains expose order size, timing, counterparties, and execution price to observers.
- That information lets counterparties widen spreads and front-runs arbitrage the flow.
- Existing "private" RFQ demos protect data only in the app layer; the data is still visible to the platform.

Regulated institutions need a venue where price competition happens without any dealer seeing a competitor's price.

## How ShadowDesk solves it

1. The buyer and risk officer approve a `TreasuryMandate` with approved dealers, assets, maximum amount, maximum price, and expiry.
2. The buyer agent opens a private `BlockTradeRFQ` from the approved mandate. The ledger rejects requests outside policy.
3. Each dealer agent submits a `QuoteProposal` - signatory to that dealer alone, observed only by the buyer. No dealer sees a competitor's price.
4. The buyer agent selects the best executable quote and seals it into a binding `SealedQuote` linked to the approved mandate.
5. `Deal` and `Settle` perform atomic delivery-versus-payment and recheck the mandate limits before moving either asset.
6. A `SettlementReceipt` links the mandate, RFQ, sealed quote, winning bid, and settlement result for private audit.

Privacy is proven, not promised: the demo asserts on the live ledger that a losing dealer on a separate participant observes **zero** of the winner's quotes, and the dashboard surfaces that check continuously.

## Why Canton

- Privacy is a ledger primitive: contract data is encoded for and visible only to involved parties, across participants on the same synchronizer.
- Atomic multi-party settlement runs in a single transaction, which is exactly what DvP needs.
- Regulated-market institutional capabilities (synthetic privacy via the Global Synchronizer) map directly to how banks are already piloting the network.

## Business value

| Pain today | ShadowDesk outcome |
| --- | --- |
| Treasury policy scattered across systems | Mandate-controlled execution with on-ledger limits |
| Dealers can infer each other's pricing | Prices visible only to buyer + quoting dealer |
| Settlement risk between separate systems | Atomic DvP in one ledger transaction |
| Platform can see your flow | Confidentiality enforced at the contract layer |

Addressable flow: tokenized treasuries first (largest on-chain RWA category), then commercial paper, private credit, fund units, and stablecoin treasury operations - anywhere liquidity providers must quote privately.

## Where we are today

A working three-week-built MVP: Daml contract templates, buyer/dealer agent services on two Canton participants, a live institutional dashboard (buyer view + public metadata projection), and a one-shot clean-environment reproduction script. Each round runs real concurrent two-participant ledger transactions and asserts quote isolation end-to-end.

## Ask

- Pilot with one asset manager, one risk officer, and two liquidity providers on the Canton DevNet, using the Canton Token Standard.
- Two weeks: DevNet deployment with a real asset registry, three dealers, and an auditor view.
- Add a compliance/audit party and RFQ amendment workflow for the regulated-fund sales cycle.
