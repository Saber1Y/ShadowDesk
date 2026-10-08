# ShadowDesk

A policy-controlled treasury execution layer on the Canton Network: a fund mandate and risk approval bound what an agent may trade, competing dealers price the block in private sealed quotes, and the winning trade settles against real token holdings atomically.

Built for HackCanton Season 3 on the Canton DevNet.

## The problem

A fund buying a large block of tokenized government securities must not show the market its intent.

Public blockchains expose order size, timing, counterparties, and execution price to observers, so counterparties can widen their spreads around the flow.

Existing "private" RFQ demos protect data only in the application layer; the data is still visible to the platform.

Regulated institutions need a venue where price competition happens without any dealer seeing a competitor's price, and where agent discretion stays inside an approved policy.

## How it works

1. The **buyer and risk officer** approve a `TreasuryMandate` that limits the dealers, assets, amount, maximum price, and expiry.
2. The **buyer agent** opens a private `BlockTradeRFQ` from the approved mandate.
   `OpenRfq` is the mandate's real control point: the ledger refuses any request that exceeds the cap amount or price.
3. Each **dealer agent** submits one `QuoteProposal` - signatory to that dealer alone, observed only by the buyer.
   A competing dealer never sees another dealer's price.
4. The **buyer agent** ranks the proposals with the deterministic `LowestPriceThenBidId` policy and seals the winning quote.
   Sealing consumes the RFQ, so a request yields at most one award, and the sealed quote records the mandate link, the bid id, and the rule it was awarded under.
5. Both parties authorize the `Deal` against the sealed quote, then `Settle` executes delivery-versus-payment atomically.
   Each step's authorization and visibility are enforced by the Daml templates, not by the agents.
6. A `SettlementReceipt` links the mandate, RFQ, sealed quote, winning bid, and selection policy for private audit.

On DevNet, settlement is a single ledger update: `Deal.Settle` and both registry `Allocation_ExecuteTransfer` commands commit in one `submitMany` transaction.

The receipt cannot exist unless the real tokens moved, and the tokens cannot move unless the receipt was written, so the atomicity guarantee spans the ShadowDesk package and the Canton Token Standard registry in one update.

## What is live right now

- Live dashboard: [landing page](https://shadowdesk-inky.vercel.app) and [institutional dashboard](https://shadowdesk-inky.vercel.app/dashboard).
- The Vercel project deploys the Next.js application from `frontend/`.
- A durable worker reruns real DevNet rounds on demand; the dashboard's **Run round** dispatches there and streams agent output into a terminal console while the projections update from live ledger queries.
- Verified on DevNet 2026-10-08 with real CBTC and BETH from the BitSafe faucet: two competitive rounds, both dealers delivered (the pricing swapped so each dealer was the awarded counterparty once), and each settlement wrote the receipt and both registry legs in one update.

Per round the runner makes the pricing explicit: the awarded quote sits below the competing quote, the saving is recorded on the bid set, and a dashboard panel re-derives the ranking and the saving from ledger data alone.

Privacy is proven, not promised.

The flow asserts on the live ledger that a losing dealer observes **zero** of the winner's quotes, and the dashboard surfaces that check continuously.

Quote isolation across participants is proven by the two-participant LocalNet topology.

The shared DevNet participant proves the winning party's scoped view; it does not prove isolation from a credential authorized for both dealer parties, because both roles share one participant endpoint there.

Real tokens and cross-participant quote secrecy live on different networks: DevNet has the registry but one participant, while LocalNet has two participants but no registry.

That structural split is stated honestly rather than papered over.

## What's real vs. roadmap

**Verified in the deployed demo:** the full venue workflow (mandate, private RFQ, sealed competitive quotes, deterministic award) against the deployed V1 Daml package on DevNet, settling real CBTC/BETH with a receipt and two registry legs in one update, plus the pre-award pricing evidence and the losing-dealer zero-view assertion.

**Roadmap (not in the demo):** a registry-native receipt via the V2 settlement package once it can be installed (the DevNet participant rejects application-token package uploads with 403, so that needs operator credentials); a third dealer; a compliance/audit party; RFQ amendment; cumulative mandate spend across multiple settlements; best-execution *enforcement* on the ledger rather than only evidence (the ledger cannot enumerate proposals, so today it records every bid before the award and re-derives the comparison after).

## Track alignment

ShadowDesk targets the HackCanton Season 3 Canton DevNet track.

It uses the Canton Token Standard for settlement, the JSON Ledger API v2 for the agents and dashboard, and Daml contract stakeholders for the confidentiality boundary.

## Requirements

- Node.js 20+ and npm.
- The `dpm` CLI (Canton Developer Preview build) and its bundled Daml SDK 3.5.x (add `$HOME/.dpm/bin` to your PATH).
- A DevNet `.env.local` in `frontend/` - copy from `.env.example`, set `SHADOWDESK_NETWORK=devnet`, point both participant URLs at the shared DevNet JSON Ledger API, register the OIDC redirect URI, and configure the four role parties (buyer, risk officer, dealer A, dealer B).
- Live token funding for DevNet comes from the BitSafe faucet (`npm run faucet:fund`); it is idempotent and tops up to a per-instrument floor.

## Repository layout

- `daml/` - Daml source (`ShadowDesk.Asset`, `ShadowDesk.Rfq`, `ShadowDesk.Settlement`, tests) and the two-participant distributed runner config. The deployed package is `shadowdesk-treasury` 1.0.0.
- `agents/` - TypeScript buyer, dealer, and shared services speaking the JSON Ledger API v2, including `e2e/real-flow-check.ts` (the DevNet real-token proof) and `e2e/faucet-fund.ts`.
- `frontend/` - Next.js dashboard (public projection + institutional buyer view). `npm run dev` serves it on port 3001. The browser only talks to dashboard APIs, never to a participant directly.
- `scripts/localnet/` - one-shot environment bootstrap for the two-participant LocalNet.
- `docs/` - `architecture.md`, `business-brief.md`, `pilot-plan.md`, and `demo-walkthrough/` media.
- `SECURITY.md` - operational security notes.

## Quick start - LocalNet (two-participant privacy proof)

Boot the whole stack from a clean state in one command:

```bash
./scripts/localnet/run-all.sh
```

This kills any running sandbox, starts the two-participant distributed topology (participant1 + participant2 on one synchronizer), uploads the DAR to both participants, runs one full demo round on the fresh ledger, then starts (or reuses) the dashboard on `http://localhost:3001`.

The dashboard has a **Run round** button that streams a live agent round into a terminal console; the projections update from real ledger queries.

The default local demo uses `cTBILL` and `cUSDC` and settles in-ledger `Asset` contracts.

The security and settlement instruments must be different.

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

## Verifying the DevNet real-token flow

```bash
cd agents
npm install
npm run typecheck
npm run faucet:fund      # top up CBTC/BETH from the BitSafe faucet (idempotent)
npm run e2e:real-flow    # mandate, RFQ, sealed quotes, award, atomic registry DvP
```

`npm run e2e:real-flow` runs the whole venue workflow against deployed packages only and commits `Deal.Settle` plus both registry transfers in a single update.

`npm run e2e:real-guard` asserts that a breaching `Deal` is refused, that no balance moves, and that the legs stay reserved afterwards - direct evidence of rollback.

## Tests and type checks

```bash
cd daml && dpm test               # contract scenarios, including award/settlement mismatch
cd agents && npm run typecheck    # TypeScript strict
cd agents && npm run demo         # full end-to-end two-participant LocalNet demo
cd frontend && npm run typecheck
cd frontend && npm run build
cd frontend && npm test           # projection and session-cookie unit tests
```

The landing page is at `http://localhost:3001`; the live UI flow is at `http://localhost:3001/dashboard` after the LocalNet bootstrap.

For a repeatable API/UI smoke check without resetting the ledger, run `./scripts/localnet/smoke-test.sh` while the sandbox and dashboard are already running.

## Known limitations

- **Settlement party topology.** The Daml script runner rejects cross-participant `actAs`, so the winning dealer in the LocalNet demo is co-hosted on participant1 where the `Deal`/`Settle` executes.
  Quote secrecy across participants is unaffected and is proven independently.
- **Structure split between environments.** DevNet has the registry but one participant (losing-dealer zero-view cannot fail structurally there); LocalNet has two participants but synthetic assets.
  Neither environment demonstrates both properties.
- **Best execution is evidenced, not enforced.** The ledger records every bid immutably before the award, but it cannot enumerate proposals to compute a global minimum, so enforcing the cheapest choice remains a buyer-side duty.
- **The V2 receipt is not deployable by the agent.** The DevNet participant rejects application-token package uploads with 403, so the registry-native `InstrumentId` receipt in `ShadowDesk.V2.Settlement` stays verified on LocalNet only until operator credentials install it.
- **Fauceted balances.** Trades settle real DevNet test tokens; amounts are small and not production capital.

## Submission pack

- `PRD.md` - product requirements and acceptance scenario.
- `PROJECT_CONTEXT.md` - decisions, topology, verified lessons, and session log.
- `BUILD_PLAN.md` - build and launch plan.
- `docs/architecture.md` - system, privacy, and contract architecture.
- `docs/business-brief.md` - one-page business brief.
- `docs/pilot-plan.md` - pilot plan and metrics.
- `SECURITY.md` - operational security notes.