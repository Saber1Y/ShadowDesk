# ShadowDesk

A policy-controlled treasury execution layer for institutional rebalancing, built on the Canton Network.

An institutional treasury needs to rebalance without giving an execution agent unlimited discretion. ShadowDesk records a buyer mandate approved by the buyer and a risk officer, constrains the allowed dealers, assets, amount, price, and expiry, then opens a private RFQ and settles the approved trade atomically.

## Live demo

[Open the deployed ShadowDesk landing page](https://shadowdesk-inky.vercel.app) · [Enter the dashboard](https://shadowdesk-inky.vercel.app/dashboard)

The Vercel project deploys the Next.js application from `frontend/`.

## What is proven

- **Quote secrecy.** Competing dealers never see each other's prices. Each `QuoteProposal` is signatory to one dealer and observed only by the buyer; a losing dealer on another participant sees **zero** of the winner's quotes on the shared synchronizer.
- **Atomic DvP.** The `Deal` contract exchanges asset for payment in a single `Settle` step: the buyer receives the security and the winning dealer receives payment atomically, or neither happens.
- **Mandate enforcement.** `TreasuryMandate` requires buyer and risk-officer approval. `ApprovedMandate` constrains RFQ opening and is carried through the sealed quote and settlement receipt.
- **Live federation.** Two Canton participants on one synchronizer run real buyer and dealer agents; the dashboard is a live projection of actual ledger state, not a mock.

## How it works

1. The **buyer and risk officer** approve a `TreasuryMandate` with the allowed dealers, assets, maximum amount, maximum price, reference, and expiry.
2. The **buyer agent** opens a `BlockTradeRFQ` from the approved mandate. The ledger rejects RFQs that exceed the mandate.
3. Each **dealer agent** submits one `QuoteProposal` with its own price and bid id. A dealer sees only its own proposals, never the others.
4. When the buyer's collection window closes, the buyer agent picks the deterministic winner using the rule the RFQ declared: lowest price within the mandate limit, ties broken by bid id.
5. The buyer `AcceptProposal`s the winning quote into a `SealedQuote` - now binding on both parties, carrying the approved mandate link and the rule it was awarded under. Awarding consumes the RFQ, so a request can be awarded at most once.
6. Both parties authorize the `Deal` against that `SealedQuote`, then `Settle` runs DvP atomically. Settlement rechecks the mandate limits and writes a `SettlementReceipt` linking the trade to the mandate, RFQ, winning bid, and selection policy.

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
The default local demo uses `cTBILL` and `cUSDC`, and users can enter other local wrapped `Asset` symbols.
The local ledger creates those demo assets with issuer `ShadowDesk`; this is not yet a DevNet/CIP-025 registry lookup.
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
dpm script --participant-config participants.json     --dar .daml/dist/shadowdesk-treasury-1.0.0.dar --upload-dar=true --script-name ShadowDesk.Test:noop
dpm script --participant-config participants-p2.json  --dar .daml/dist/shadowdesk-treasury-1.0.0.dar --upload-dar=true --script-name ShadowDesk.Test:noop

# 3. Rebuild the DAR if a Daml source changed (fast, deterministic)
dpm build -o .daml/dist/shadowdesk-treasury-1.0.0.dar

# 4. Run the agents demo
cd ../agents
npm install
npm run demo

# 5. Start the dashboard
cd ../frontend
npm install
npm run dev   # http://localhost:3001
```

## HackCanton shared DevNet

The HackCanton DevNet uses a shared participant node.
Follow the [NODERS quickstart](https://hackmd.io/e3XQxMggRw2m5N7nxzQYZA?view) to onboard your AppsFactory account, create parties in the Node Console, and upload the DAR through Collections.

Set `SHADOWDESK_NETWORK=devnet` and copy the DevNet participant and OIDC values from `.env.example` into `frontend/.env.local`.
Register or confirm `http://localhost:3001/api/auth/callback` as the OIDC redirect URI before testing the browser login.
The browser login uses Authorization Code + PKCE through the NODERS wallet, calls the OIDC userinfo endpoint, and keeps access and refresh tokens in server-side session files.
The browser receives only an `HttpOnly`, `SameSite=Lax` session cookie that is marked `Secure` outside local development.
Rotated refresh tokens and active sessions are stored with user-only permissions under `~/.config/shadowdesk/` by default.
Session files are local to one server process, so run a single ShadowDesk instance per session directory and move to a shared store before scaling horizontally.
Set both participant URL variables to the shared JSON Ledger API endpoint from the NODERS guide.

The dashboard then reports one unique participant endpoint and marks cross-participant privacy as unverified.
The shared-node guide grants the ledger user `CanActAs` and `CanReadAs` on parties created by that user, so the DevNet setup does not currently prove the LocalNet dealer-isolation boundary.
The legacy `SHADOWDESK_CANTON_ACCESS_TOKEN` and `SHADOWDESK_CANTON_REFRESH_TOKEN` variables remain supported for non-browser tooling, but the dashboard should use the wallet login flow.
When one of them is configured, the header shows a server-token badge instead of a sign-out control, because that credential belongs to the deployment rather than to the browser session.

A DevNet round is gated on a signed-in session and a configured party for each role, not on a hard disable.
It settles the same locally seeded `ShadowDesk.Asset` contracts as the local round, so it is not a registry-backed settlement.
Command submission additionally requires the active `shadowdesk-treasury` package to be vetted by the shared node's validator; an uploaded but unvetted package is rejected.
The authenticated DevNet status view can read the configured party projections.

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
- **The `Deal` must reference the awarded `SealedQuote`.** The ledger rejects any settlement whose dealer, price, size, or instruments differ from the award, and the receipt records the originating RFQ, the winning bid id, and the selection policy.
- A request is awarded at most once. The buyer panel shows `AWARDED` rather than `OPEN` afterwards, because the RFQ is consumed by the award.

To test a custom round from the UI, set the security and settlement instruments, enter a positive amount, and enter a positive maximum price before selecting **Run round**.
Dealer prices in the local demo are fixed at 100.20 and 100.50, so a maximum price below 100.20 intentionally produces no eligible quote.
The round reports a readable explanation in the dashboard while the technical details remain available in the expandable error section.

## Privacy evidence

The demo asserts, and the dashboard surfaces, a party-scoped query: the losing dealer asks its participant's JSON Ledger API for the winner's quote and observes zero contracts. On LocalNet, the dealers use separate participant endpoints, so this also demonstrates cross-participant isolation for the configured parties.
On the shared HackCanton DevNet, both roles use one participant endpoint and the configured ledger identity can read as all three parties. The party-scoped view remains distinct, but that setup does not demonstrate isolation from a credential authorized for both dealers.
Canton routes transaction views to authorized participants; synchronizers order encrypted messages and cannot decrypt private payloads. The dashboard's sanitized public projection is an application view, not a network-wide ledger feed.

## Tests and type checks

```bash
cd daml && dpm test               # contract scenarios, including award/settlement mismatch
cd agents && npm run typecheck    # TypeScript strict
cd agents && npm run demo         # full end-to-end two-participant demo
cd frontend && npm run typecheck
cd frontend && npm run build
```

`cd agents && npm run e2e:award-chain` exercises the award chain against a real single-node ledger and needs no Docker: start one with `cd daml && dpm sandbox --dar .daml/dist/shadowdesk-treasury-1.0.0.dar`. It creates an RFQ, quotes, seals, settles, and asserts that a `Deal` which disagrees with the approved mandate or awarded quote is rejected without moving the security.

The landing page is at `http://localhost:3001`; the live UI flow is at `http://localhost:3001/dashboard` after the localnet bootstrap.
Verify both participants are live, run a custom RFQ, confirm the requested amount and instruments in the Institutional view, and confirm the privacy result reports zero winner quotes to the losing dealer.

For a repeatable API/UI smoke check without resetting the ledger, run `./scripts/localnet/smoke-test.sh` while the sandbox and dashboard are already running.

## Known limitations

- **Demo assets.** The demo settles in-ledger `Asset` contracts (cTBILL / cUSDC) minted for the demo. The DevNet asset standard (NameService / CIP-025-style registries) is not integrated yet; see `docs/pilot-plan.md`.
- **Local single-synchronizer federation.** The demo runs two participants on one local synchronizer. Cross-synchronizer (DevNet) operation is the next milestone.
- **Settlement party topology.** Cross-participant `actAs` submission is rejected by the script runner, so the winning dealer in the demo is co-hosted on participant1 where the `Deal`/`Settle` executes. Quote secrecy across participants is unaffected and is proven independently.
- **Fixed selection policy.** Each RFQ declares its award rule on-ledger (`LowestPriceThenBidId`). The buyer agent ranks proposals with that same rule, and the settlement receipt records which rule and bid id produced the award. The ranking itself still runs client-side, because Daml cannot enumerate every proposal contract to compute a global minimum. Additional policies and bilateral negotiation are future extensions.
- **Buyer is the awarder.** The contract enforces that an award matches a real dealer-signed proposal and that a request yields at most one award, but it does not check that the buyer picked the *cheapest* quote. Enforcing the global minimum would need the ledger to see all proposals at once, which the current authorization model does not allow.
- **Treasury mandate scope.** The current mandate constrains one RFQ round. A future version will track cumulative spend and remaining allocation across multiple settlements.

## Submission pack

- `PRD.md` - product requirements.
- `PROJECT_CONTEXT.md` - decisions, topology, session log, and verified lessons.
- `docs/architecture.md` - system and privacy architecture.
- `docs/business-brief.md` - one-page business brief.
- `docs/pilot-plan.md` - pilot plan and metrics.
- `docs/demo-script.md` - the five-minute walkthrough script.
