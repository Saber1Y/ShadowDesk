# ShadowDesk

A private institutional RFQ and atomic delivery-versus-payment venue, built on the Canton Network.

An institutional fund wants to buy a large block of an asset without moving the market. ShadowDesk invites a small set of dealers, collects their prices **blind** (no dealer sees another dealer's price), picks the best price within the fund's limit, and settles the trade atomically - delivery of the asset and payment of the proceeds exchange in one ledger transaction.

## What is proven

- **Quote secrecy.** Competing dealers never see each other's prices. Each `QuoteProposal` is signatory to one dealer and observed only by the buyer; a losing dealer on another participant sees **zero** of the winner's quotes on the shared synchronizer.
- **Atomic DvP.** The `Deal` contract exchanges asset for payment in a single `Settle` step: the buyer receives the security and the winning dealer receives payment atomically, or neither happens.
- **Live federation.** Two Canton participants on one synchronizer run real buyer and dealer agents; the dashboard is a live projection of actual ledger state, not a mock.

## How it works

1. The **buyer agent** creates a `BlockTradeRFQ` for a block size, a max price, and a list of invited dealers.
2. Each **dealer agent** submits one `QuoteProposal` with its own price and bid id. A dealer sees only its own proposals, never the others.
3. When the buyer's collection window closes, the buyer agent picks the deterministic winner: lowest price within the max-price limit, ties broken by bid id.
4. The buyer `AcceptProposal`s the winning quote into a `SealedQuote` - now binding on both parties.
5. Both parties authorize the `Deal`, then `Settle` runs DvP atomically: the buyer's locked security becomes the buyer's, and the dealer's payment asset becomes the dealer's. A `SettlementReceipt` records the trade.

Each step's authorization and visibility is enforced by the Daml contract templates, not by the agents.

## Repository layout

- `daml/` - Daml source (`ShadowDesk.Asset`, `ShadowDesk.Rfq`, `ShadowDesk.Settlement`, tests) and the two-participant distributed runner config.
- `agents/` - TypeScript buyer, dealer, and shared services speaking the JSON Ledger API v2. `npm run demo` runs the full two-participant demo.
- `frontend/` - Next.js dashboard (public projection + institutional buyer view) that reads both participants live. `npm run dev` serves it on port 3001.
- `scripts/localnet/` - one-shot environment bootstrap.
- `docs/` - architecture diagram, business brief, pilot plan, demo script.

## Prerequisites

- Node.js 20+ and npm.
- The `dpm` CLI (Canton Developer Preview build) and its bundled Daml SDK 3.5.x. Add `$HOME/.dpm/bin` to your PATH.

## Quick start

Boot the whole stack from a clean state in one command:

```bash
./scripts/localnet/run-all.sh
```

This kills any running sandbox, starts the two-participant distributed topology (participant1 + participant2 on one synchronizer), uploads the DAR to both participants, runs one full demo round on the fresh ledger, then starts (or reuses) the dashboard on `http://localhost:3001`.

The dashboard has a **Run round** button that streams a live agent round into a terminal console - the projections update from real ledger queries.

Before running a round, the dashboard lets the user choose the security instrument, settlement instrument, amount, and maximum price.
The current local demo provisions `cTBILL` and `cUSDC`, so those are the selectable instruments.
The security and settlement instruments must be different.
The default values remain 1,000,000 cTBILL at a maximum price of 101.

## Manual steps (what run-all.sh does)

```bash
# 1. Boot the two-participant sandbox (participant1: JSON API 6864, participant2: JSON API 18003)
export PATH="$HOME/.dpm/bin:$PATH"
cd daml
dpm sandbox -c distributed-run.conf &
# wait for "Canton sandbox is ready." in the log, then confirm both JSON APIs answer

# 2. Upload the DAR to each participant
dpm script --participant-config participants.json     --dar .daml/dist/shadowdesk-rfq-1.0.0.dar --upload-dar=true --script-name ShadowDesk.Test:noop
dpm script --participant-config participants-p2.json  --dar .daml/dist/shadowdesk-rfq-1.0.0.dar --upload-dar=true --script-name ShadowDesk.Test:noop

# 3. Rebuild the DAR if a Daml source changed (fast, deterministic)
dpm build -o .daml/dist/shadowdesk-rfq-1.0.0.dar

# 4. Run the agents demo
cd ../agents
npm install
npm run demo

# 5. Start the dashboard
cd ../frontend
npm install
npm run dev   # http://localhost:3001
```

## What happens during the agents demo

```
[buyer]     party=buyer    (participant1)
[dealerB]   party=dealerB  (participant2)   inventory cTBILL, quotes 100.5
[dealerA]   party=dealerA  (participant1)   inventory cUSDC,  quotes 100.2
```

- The buyer creates an RFQ: 1,000,000 cTBILL, max price 101, inviting both dealers.
- dealerB quotes 100.5; dealerA quotes 100.2. Neither sees the other's price.
- The venue selects dealerA deterministically (lowest price within the limit).
- The winning quote is sealed; the losing dealer on participant2 sees 0 of the winner's quotes (programmatically asserted).
- `Deal` is created and `Settle` runs atomically on participant1: buyer holds 1,000,000 cTBILL, dealerA holds 100,200,000 cUSDC. A `SettlementReceipt` is written.

To test a custom round from the UI, set the security and settlement instruments, enter a positive amount, and enter a positive maximum price before selecting **Run round**.
Dealer prices in the local demo are fixed at 100.20 and 100.50, so a maximum price below 100.20 intentionally produces no eligible quote.
The round reports a readable explanation in the dashboard while the technical details remain available in the expandable error section.

## Privacy evidence

The demo asserts, and the dashboard surfaces, a live cross-participant privacy check: the losing dealer (participant2) queries the synchronizer for the winner's sealed quote and observes zero contracts. Because `SealedQuote` and the quote payloads are visible only to their signatories/observers, a dealer on a different participant cannot see a competing dealer's price at rest.

## Tests and type checks

```bash
cd agents && npm run typecheck    # TypeScript strict
cd agents && npm run demo         # full end-to-end two-participant demo
cd frontend && npm run typecheck
cd frontend && npm run build
```

The live UI flow can be checked at `http://localhost:3001` after the localnet bootstrap.
Verify both participants are live, run a custom RFQ, confirm the requested amount and instruments in the Institutional view, and confirm the privacy result reports zero winner quotes to the losing dealer.

For a repeatable API/UI smoke check without resetting the ledger, run `./scripts/localnet/smoke-test.sh` while the sandbox and dashboard are already running.

## Known limitations

- **Demo assets.** The demo settles in-ledger `Asset` contracts (cTBILL / cUSDC) minted for the demo. The DevNet asset standard (NameService / CIP-025-style registries) is not integrated yet; see `docs/pilot-plan.md`.
- **Local single-synchronizer federation.** The demo runs two participants on one local synchronizer. Cross-synchronizer (DevNet) operation is the next milestone.
- **Settlement party topology.** Cross-participant `actAs` submission is rejected by the script runner, so the winning dealer in the demo is co-hosted on participant1 where the `Deal`/`Settle` executes. Quote secrecy across participants is unaffected and is proven independently.
- **Single price selection.** Winners are chosen automatically by lowest price within the buyer's max-price limit; manual negotiation is a future extension.

## Submission pack

- `PRD.md` - product requirements.
- `PROJECT_CONTEXT.md` - decisions, topology, session log, and verified lessons.
- `docs/architecture.md` - system and privacy architecture.
- `docs/business-brief.md` - one-page business brief.
- `docs/pilot-plan.md` - pilot plan and metrics.
- `docs/demo-script.md` - the five-minute walkthrough script.
