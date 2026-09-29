# ShadowDesk Project Context

## Purpose

This file preserves the reasoning and decisions needed to continue ShadowDesk across OpenCode sessions.

Read this file before changing architecture, contract visibility, settlement logic, or demo claims.

## Current Status

- Repository state: git repo initialized at workspace root (branch `main`, remote origin `https://github.com/Saber1Y/ShadowDesk`), Daml package scaffolded at `/Users/mac/codes/Shadow Desk/daml`, TypeScript agents in `agents/`, Next.js dashboard in `frontend/`; runtime artifacts (node_modules, .daml, log/, .next) gitignored. History committed per logical file/unit; dashboard rebranded to the official Canton palette (yellow `#F3FF97`, black `#030206`, white `#FFFFFC`, lilac `#D5A5E3`, purple `#875CFF`, taupe `#A89F91`) with a segmented C-ring mark + `app/icon.svg` favicon.
- Implementation state: privacy templates compiling, agent services live, dashboard live.
- Daml state: the next package is `shadowdesk-treasury` 1.0.0 and builds to `.daml/dist/shadowdesk-treasury-1.0.0.dar` (current package id `50a21ee1be71aeae5c56c90db20491dd870004f1cd4fb47efcf7d3aa292d7c22`); `dpm test` passes ten scenarios plus `noop`, including the approved-mandate lifecycle.
- Canton state: local Canton 3.5.17 sandbox validated. `dpm sandbox` starts a full single-process network; Ledger API gRPC on 127.0.0.1:6865, HTTP on 6864. Party store persists per-node between runs; readiness must be keyed on the log line `Canton sandbox is ready.`, not on the port.
- Multi-participant state: `dpm sandbox -c daml/distributed-run.conf` brings up a second participant `participant2` (Ledger API gRPC 18001, admin 18002, HTTP 18003) on the same synchronizer, auto-connected. Cross-participant privacy and settlement proven live via `participants.json`/`participants-p2.json` runner configs (default participant hosts the DAR upload; `--upload-dar=true` uploads only to the default participant, so DAR must be uploaded once per participant).
- Agent state: buyer/dealer/dealer agent services scaffolded in `/Users/mac/codes/Shadow Desk/agents` (TypeScript + Node, JSON Ledger API v2). Waits proven live end-to-end across both participants: buyer creates RFQ, both dealers quote from their own participant, buyer deterministically selects the winner within maxPrice, seals the quote, and DvP settles atomically on participant1. The losing dealer on participant2 sees zero of the winner's quotes (asserted in the demo run).
- Frontend state: Next.js 15 (App Router, Tailwind v4, Motion, lucide) dashboard in `/Users/mac/codes/Shadow Desk/frontend`. Live command-center console UI: floating pill nav, dot-grid dark studio, lime accent, mono micro-labels. Two tabs: Public projection (sanitized execution-ledger metadata + cross-participant privacy banner) and Institutional (buyer view: holdings, live RFQ, independent quotes with sealed/lost states, settled DvP receipt). A "Run round" button streams the real two-participant agent run into a terminal console and the projections update live from actual ledger queries. Server-side projections read the JSON API on both participants; the browser never touches a participant directly.
- Settlement state: two-leg atomic DvP implemented. `Deal` template (signatory buyer+dealer) with `Settle` choice performs validated payment-for-security exchange in one transaction; `SettlementReceipt` issued. Guards: expiry, exact security quantity, settlement-asset match, payment coverage, agreement with the awarded `SealedQuote`, and approved-mandate amount, price, and asset limits. Both legs verify from ledger results in tests. The receipt records the originating RFQ, the sealed quote, the mandate, the winning bid id, and the selection policy, so policy-to-award-to-settlement is traceable on-ledger.
- Selection state: each `BlockTradeRFQ` declares a `SelectionPolicy` (`LowestPriceThenBidId`) that the sealed quote inherits. The buyer agent still ranks proposals client-side, because Daml cannot enumerate every proposal contract to compute a global minimum, and the ledger enforces only that settlement matches the award. A request is awarded at most once: `AcceptProposal` consumes the RFQ, so a second or concurrent acceptance can no longer resolve it. The sealed quote therefore also records the request's reference, max price, and invited dealers, which keeps the awarded round reconstructable after the RFQ is archived and lets the dashboard show it as `AWARDED` instead of `OPEN`. The ledger does not check that the buyer chose the cheapest quote; that remains a buyer-side duty.
- Deployment state: package `shadowdesk-treasury` 1.0.0 is uploaded to DevNet and is intentionally a fresh package name because the mandate fields and choices are a schema change. `scripts/localnet/run-demo.sh` derives the DAR filename from `daml/daml.yaml`.
- Verification state: `dpm test` passes ten Daml scenarios plus `noop`, including the mandate approval, mandate limit rejection, and max-price regression tests. Agent and frontend typechecks pass. Authenticated DevNet E2E serves package id `50a21ee1...` and completes RFQ creation, quote submission, sealing, duplicate-award rejection, settlement, and mismatched-Deal rejection. The authenticated DevNet treasury demo now also passes with a separate risk-officer party: mandate approval, RFQ opening, two quotes, sealed award, losing-dealer zero-view assertion, and DvP settlement.
- Real token state: BitSafe DevNet faucet transfers were accepted through the Token Standard V1 flow after threading the registry response's `disclosedContracts` into the receiver command. Dealer A and Dealer B each hold `0.01 CBTC`; the buyer holds `0.1 BETH`. The next real-settlement milestone is allocation-based DvP, not additional funding.
- Planning state: product concept, MVP requirements, and phase plan are documented.

## Product Decision

ShadowDesk will be presented as a policy-controlled treasury execution layer for institutional rebalancing.

The project will prove protocol-enforced privacy and real Canton settlement before adding advanced AI behavior.

The first demo will use one buyer, one risk officer, two dealers, one approved mandate, one RFQ, two quotes, one accepted quote, and one settlement.

## Real-World Product Story

The primary use case is an institutional fund purchasing a large block of tokenized short-term government securities.

The fund manager wants competitive dealer pricing but does not want to publish the order size or reveal the accumulation strategy.

The buyer and risk officer approve a mandate that limits the dealers, assets, amount, price, and expiry before the buyer agent can open an RFQ.

Each dealer sees the RFQ terms required to price the trade, but competing dealers do not see one another's quotes.

The buyer agent applies deterministic price, expiry, and dealer-policy checks before accepting the best quote, while the ledger independently enforces the approved mandate limits.

The selected quote triggers atomic delivery-versus-payment using the asset mechanism available on the Canton environment.

The fund receives the asset, the dealer receives the settlement asset, and the fund receives a private audit report.

The demo uses test assets and test amounts, but the workflow is intended to represent larger institutional trades in tokenized bonds, commercial paper, private credit, fund units, and stablecoin treasury operations.

The product value is controlled information disclosure, not merely a dark-themed frontend.

## Build Plan

The detailed execution plan is stored in `BUILD_PLAN.md`.

The implementation order is ledger first, agents second, settlement third, frontend fourth, and presentation last.

The first milestone is the private RFQ proof.

The first milestone is complete only when a buyer can create an RFQ, invited dealers can see it, and participant-level queries prove that unauthorized parties cannot see it.

The first implementation session must validate DPM, LocalNet, participant APIs, party allocation, and available test assets before application code expands.

The project will be built as three vertical slices.

1. Private RFQ creation and visibility.
2. Private quote collection and buyer selection.
3. Real settlement and judge-facing presentation.

Do not start polished frontend work before the first two slices operate through real Ledger API commands.

## Demo Narrative

The demo should begin with the fund manager's problem rather than with a technical architecture diagram.

The opening message is: "A fund needs to buy a block of tokenized government securities, but publishing the order would reveal its strategy and worsen execution."

The demo then proves four claims in order.

1. The buyer can create a private RFQ for approved dealers.
2. Dealers can quote independently without seeing competing quotes.
3. The buyer can select a quote under explicit institutional rules.
4. The selected trade can settle through a real Canton ledger workflow.

The public screen is only a metadata view.

It must not be described as a plaintext view of the Global Synchronizer.

The institutional screen is the buyer participant's authorized view.

The privacy proof should include an attempted unauthorized query or participant-level test result rather than relying only on visual separation.

## Current Feasibility Assessment

The project is feasible within the HackCanton Season 3 delivery window if the MVP remains narrow.

Canton is a strong fit because Daml stakeholders control contract visibility and participant nodes maintain localized ledger views.

The primary technical risk is not the RFQ concept.

The primary technical risk is implementing a valid multi-party quote authorization flow and connecting it to a real asset settlement mechanism.

## External Facts Used During Planning

The Canton documentation indicates that contract data is visible to signatories, observers, and relevant controllers.

The Canton documentation indicates that the synchronizer coordinates encrypted messages and does not expose plaintext contract payloads to general observers.

The Canton documentation describes gRPC and JSON Ledger API access to commands, queries, and update streams.

The Canton documentation describes the JSON Ledger API as suitable for browser and TypeScript integrations.

The Canton documentation describes token interfaces and allocation-based delivery-versus-payment patterns for multi-leg settlement.

The AppsFactory HackCanton Season 3 page describes a three-week delivery period from September 18 to October 9, 2026.

The same page describes an MVP expectation covering an end-to-end workflow, a lightweight role-based UI, a business brief, and a pilot plan.

These facts must be rechecked if the schedule, DevNet, or submission rules change.

## Important Architecture Corrections

### Quote Authorization

The original concept proposed a dealer-controlled choice that directly creates a quote signed by both buyer and dealer.

That flow may fail Daml authorization requirements because the dealer cannot automatically authorize a contract requiring the buyer's signature.

The implementation must compile and test the exact choice structure before treating it as valid.

The preferred fallback is a two-step flow.

1. The dealer creates a quote proposal signed by the dealer.
2. The buyer receives and authorizes the proposal.
3. The buyer and dealer become signatories of the sealed quote.

The final choice structure must be selected based on actual Daml tests rather than assumptions.

### Public View

The public UI must not claim to display raw plaintext transaction data from the Global Synchronizer.

The synchronizer does not function as a public block explorer for private contract payloads.

The public UI should display intentionally exposed application metadata, event IDs, timestamps, status changes, and encrypted-payload indicators.

The UI must clearly distinguish public metadata from the buyer participant's private view.

### Asset Selection

CBTC and cETH must not be assumed to exist on the target environment.

The team must inspect the target DevNet asset catalog before committing the settlement design.

The fallback asset should be Canton Coin or a clearly labeled demo token that produces real Canton ledger transactions.

The fallback must not be described as a production institutional asset.

### AI Boundary

The settlement path must remain reliable if an external AI provider is unavailable.

Dealer pricing and buyer quote selection should use deterministic code for the first demo.

An LLM can produce explanations or recommendations after the deterministic policy has computed the result.

Private RFQs, private quotes, credentials, and private keys must not be sent to an external model provider.

## Recommended Repository Shape

The intended repository layout is:

```text
PRD.md
PROJECT_CONTEXT.md
README.md
docs/
  architecture.md
  demo-script.md
  business-brief.md
  pilot-plan.md
daml/
  daml.yaml
  src/
  test/
agents/
  buyer/
  dealer/
  shared/
frontend/
  src/
scripts/
  localnet/
  devnet/
```

The exact layout may change after scaffolding, but the separation between ledger, agents, frontend, and documentation should remain clear.

## Proposed Runtime Components

### Buyer Participant

Hosts the buyer party.

Stores the buyer-visible RFQ, quote, and settlement contracts.

Serves the buyer agent and institutional dashboard backend.

### Dealer A Participant

Hosts Dealer A.

Stores RFQs where Dealer A is invited and Dealer A's own quotes.

Must not expose Dealer B's quote to Dealer A.

### Dealer B Participant

Hosts Dealer B.

Stores RFQs where Dealer B is invited and Dealer B's own quotes.

Must not expose Dealer A's quote to Dealer B.

### Application Backend

Connects to participant Ledger APIs.

Owns no private keys unless the chosen local demonstration requires an explicitly isolated service credential.

Projects authorized events for the frontend.

Must enforce role separation and avoid joining private projections into the public metadata projection.

### Frontend

Shows institutional state from the buyer-side backend.

Shows safe public metadata from a separate endpoint or projection.

Must never query participant APIs directly with privileged credentials from a browser.

## Initial Contract Plan

### `BlockTradeRFQ`

The buyer is the signatory.

Invited dealers are observers.

The contract contains only data required for authorized dealers to price the request.

The contract includes an expiry and unique reference.

### `QuoteProposal`

The dealer is the signatory.

The buyer is informed through the selected authorization pattern.

This template exists to avoid assuming that a dealer-only command can create a jointly signed quote.

### `SealedQuote`

The buyer and submitting dealer are signatories.

No competing dealer is an observer.

The quote has an explicit expiry and RFQ reference.

### `SettlementIntent`

The selected quote, buyer, dealer, amounts, and asset identifiers are bound together.

It cannot be substituted with a different quote after acceptance.

### `SettledTrade`

Records the final result after settlement.

Its visibility must follow the intended buyer, dealer, and auditor model.

## Agent Plan

### Buyer Agent State Machine

The buyer agent should implement these states:

```text
IDLE
RFQ_CREATED
COLLECTING_QUOTES
EVALUATING_QUOTES
QUOTE_ACCEPTED
SETTLEMENT_PENDING
SETTLED
EXPIRED
FAILED
```

Every transition must be tied to an observed ledger event or a validated command result.

### Dealer Agent State Machine

The dealer agent should implement these states:

```text
IDLE
RFQ_RECEIVED
RISK_CHECKING
QUOTE_PREPARED
QUOTE_SUBMITTED
QUOTE_EXPIRED
SETTLED
REJECTED
```

Dealer agents must not have a code path that queries another dealer's participant or credentials.

## Settlement Decision Order

The team must follow this order when implementing settlement.

1. Identify the exact available asset standard on the target environment.
2. Confirm how holdings and transfers are represented.
3. Confirm how allocations are created and executed.
4. Build a standalone two-leg settlement test.
5. Attach the tested settlement flow to quote acceptance.
6. Add dashboard reporting only after the ledger result is reliable.

Do not build a UI that reports settlement success before the actual ledger receipt has been verified.

## Privacy Test Plan

The privacy test suite must prove behavior from participant views, not only from Daml source inspection.

Required tests include:

- Buyer can query the RFQ.
- Invited Dealer A can receive the RFQ.
- Invited Dealer B can receive the RFQ.
- Uninvited Dealer C cannot receive the RFQ.
- Buyer can view Dealer A's quote.
- Dealer A can view its own quote.
- Dealer A cannot query Dealer B's quote.
- Dealer B cannot query Dealer A's quote.
- Only the buyer can accept the selected quote.
- A quote cannot be accepted twice.
- An expired RFQ cannot accept a quote.
- An expired quote cannot settle.
- A failed settlement does not leave only one leg transferred.

## Security Review Checklist

- Validate every signatory and observer expression.
- Validate every choice controller.
- Validate buyer authorization for jointly signed quotes.
- Add expiry and replay protection.
- Use idempotent command IDs.
- Restrict dealer notional and asset permissions.
- Reject arbitrary asset or recipient parameters.
- Verify both settlement legs from actual ledger results.
- Keep private credentials outside the repository.
- Keep external model calls outside the critical settlement path.
- Test duplicate commands and reconnect behavior.
- Test failure paths before recording the demo.

## Three-Week Execution Plan

### Days 1-3: Scaffold and Contract Spike

- Create the Daml project.
- Build the smallest RFQ template.
- Confirm the local Canton toolchain.
- Write a contract authorization spike.
- Decide whether the quote proposal step is required.

### Days 4-7: Privacy Proof

- Complete RFQ and quote templates.
- Add expiry and allowlist checks.
- Run participant-level privacy tests.
- Capture evidence for the demo.

### Days 8-11: Agent Integration

- Connect buyer and dealer services to Ledger APIs.
- Subscribe to updates.
- Add deterministic pricing.
- Add quote comparison.
- Add idempotent command submission.

### Days 12-15: Real Settlement

- Select available Canton assets.
- Implement and test the two-leg settlement.
- Add settlement failure and cancellation handling.
- Verify transaction results from the participant API.

### Days 16-18: Dashboard

- Build the institutional view.
- Build the public metadata view.
- Add privacy proof panels.
- Add error and pending states.

### Days 19-21: Submission

- Freeze scope.
- Run clean-checkout setup.
- Run the full demo scenario.
- Write the business brief and pilot plan.
- Record the walkthrough.
- Remove secrets and local environment data from the recording.

## Immediate Next Actions

The next coding session should complete these actions in order.

1. Confirm the HackCanton registration and selected track.
2. Confirm the team members and available roles.
3. Confirm the target DevNet and available assets.
4. Install or verify DPM and the Canton LocalNet toolchain.
5. Scaffold the Daml project.
6. Implement `BlockTradeRFQ`.
7. Write the first authorization and visibility tests.
8. Run the first real LocalNet transaction.

The first milestone is not the dashboard.

The first milestone is proving that a buyer can create a private RFQ and that only invited dealer parties can see it.

## Session Log

### Session 2026-09-18: Daml Privacy Proof Compiles and Passes

Date: 2026-09-18.

Files added or changed:
- `daml/daml.yaml`: package `shadowdesk-rfq` 1.0.0, source `src`, sdk-version 3.5.10, deps daml-prim, daml-stdlib, daml-script.
- `daml/src/ShadowDesk/Rfq.daml`: three templates. `BlockTradeRFQ` (buyer signatory, dealers observers, `SubmitQuoteProposal` nonconsuming choice, `CloseRfq`), `QuoteProposal` (dealer signatory, buyer observer, `AcceptProposal` creates the sealed quote, `WithdrawProposal`), `SealedQuote` (signatory buyer and dealer, consuming `AcceptQuote` returning `()` as a placeholder until settlement wiring).
- `daml/src/ShadowDesk/Test.daml`: three daml-script tests. `runPrivateRfqLifecycle`, `runAuthorizationAndReplayBoundaries`, `runQuoteConstraintValidation`.
- `PROJECT_CONTEXT.md`: status updated.

Commands run and results:
- `dpm build` succeeds; DAR created at `.daml/dist/shadowdesk-rfq-1.0.0.dar`.
- `dpm test` green: all three scripts ok with only the expected warning that a template package depends on daml-script (acceptable this phase; split packages later).
- `dpm sandbox` started Canton 3.5.17 in-process (Ledger API gRPC 6865, HTTP 6864), persisted state under the sandbox node, logging to `log/canton.log`.
- `dpm script --dar .daml/dist/shadowdesk-rfq-1.0.0.dar --script-name <Scenario> --ledger-host 127.0.0.1 --ledger-port 6865 --upload-dar=true --wall-clock-time`:
  - `runPrivateRfqLifecycle` SUCCESS against a live sandbox.
  - `runAuthorizationAndReplayBoundaries` SUCCESS against a fresh sandbox node.
  - `runQuoteConstraintValidation` SUCCESS against a fresh sandbox node.
- Live ledger evidence:
- `runPrivateRfqLifecycle`, `runAuthorizationAndReplayBoundaries`, `runQuoteConstraintValidation`, `runAtomicDvPSettlement`, `runDvPRejectsInvalidLeaves` - all SUCCESS on live Canton transactions (found via `grep "Canton sandbox is ready"` readiness; the port opens before the node finishes booting).
- DvP proof: buyer funds cUSDC, dealer holds cTBILL; atomic Settle swaps both legs; replay on the settled deal is rejected; undersized payment (covers < 100.5M for the 1M block) and mismatched security quantity (999,999 vs 1,000,000) both abort with `AssertionFailed` on the live ledger.
- Verified lesson: Daml Script `submitMustFail` can flake once immediately after a sandbox readiness race (observed one false positive in the very first batch right after boot), but the underlying choice guards are enforced (confirmed independently). Key readiness on the log line, wait a few seconds, and rerun to confirm.

Daml 3.5 syntax facts learned:
- `consuming` is not a keyword; choices are consuming by default.
- `Time` is a primitive exported by the Daml Prelude, not by `DA.Time`. `DA.Time` exports `addRelTime : Time -> RelTime -> Time` and `hours : Int -> RelTime`.
- `queryContractId` takes the party first and the contract id second; it returns `Script (Optional t)` and returns `None` for contracts the party is not a stakeholder on, which makes it the clean privacy assertion primitive.
- `submitMustFail` takes `Commands a` only, so visibility checks use `queryContractId`/`query` instead.
- Daml Script already exports a labelled `assertEq`, so importing `DA.Assert.assertEq` clashes; use `assertMsg "label" (pred)` instead.
- `(===)` is not in the Prelude; plain `==` suffices.
- `head` is not in the Prelude; use `foldl` over list comprehensions for balance sums.
- `getTime` inside a choice body binds via `<-` and returns `Time`; it cannot be used as a field expression.
- `submit (actAs [p1, p2])` gives multi-party atomic submission; both parties' authorizations are in the transaction, which is what makes `Deal` signatory buyer+dealer work and lets `Settle` archive each party's own asset atomically.

Settlement design facts:
- `Deal` is created by both parties jointly (`actAs`), so the dealer genuinely consents to price terms before settlement.
- `Settle` validates on-ledger data via a nonconsuming `Read` choice on each `Asset`; Daml cannot read contract payloads directly.
- A contract whose signatories are both parties cannot be created or settled by one party alone; this requires multi-party submission (legacy `submitMulti`, still exported in 3.5).

Canton sandbox operational facts:
- `dpm sandbox` persists the participant party store for the node, so re-running a script on the same node that allocates the same party hints fails with `Party already exists`. Daml script `allocateParty` is not find-or-reuse on a persistent participant.
- A genuinely fresh node is required to rerun the same scripts. Kill the java sandbox by PID (`lsof -nP -iTCP:6865 -sTCP:LISTEN`) - `pkill -f digitalasset` is not reliable because the process command line is `java -jar .../canton-open-source-3.5.17.jar`.
- When a second sandbox is started while the first is alive, it crashes with `Failed to bind to address /127.0.0.1:6868`; always verify ports are free first.
- Implication for the buyer/dealer services in a later phase: party provisioning must be idempotent (allocate-or-reuse) instead of blind `allocateParty`.

Decisions made:
- Two-step quote flow confirmed as implemented: dealer proposal observed by buyer only, buyer acceptance creates a seal with buyer and dealer as signatories, authorization inherits correctly.
- Visibility proof uses `queryContractId == None` and `query` length assertions rather than failed submit commands.
- Tests keep a template-plus-script single package for now; the split-package warning is tracked but not blocking for the hackathon.
- AI must stay out of the critical path; all movement is governed by deterministic in-contract checks.
- Real-ledger evidence gathering uses one sandbox node per script run until the agent layer implements allocate-or-reuse.

Next three actions:
1. Replace the placeholder payout inside the current demo flow with a `Deal`-based settle path end-to-end (the script already does this) and decide which Canton asset standard to present on DevNet; confirm whether HackCanton expects `NameService`/CIP-025 or a demo token.
2. Scaffold buyer/dealer agent services with idempotent party provisioning and connect them to the ledger before any frontend work.
3. Re-run the privacy scenario through either JSON API or a separate participant config to show multi-participant privacy in the demo.

### Session 2026-09-18 (second): Multi-Participant Privacy and Settlement Proven Live

Date: 2026-09-18.

Files added or changed:
- `daml/distributed-run.conf`: Canton config overlay adding a second participant `participant2` (gRPC 18001, admin 18002, HTTP 18003) on the same synchronizer.
- `daml/participants.json` and `daml/participants-p2.json`: Daml Script `--participant-config` files mapping `participant1` -> sandbox (6865) and `participant2` -> 18001; the `-p2` variant sets the default participant to participant2.
- `daml/src/ShadowDesk/Test.daml`: added `runMultiParticipantPrivacyAndSettlement` (buyer and winning dealer on `participant1`, losing dealer on `participant2`) and a `noop` script used for per-participant DAR upload.
- `PROJECT_CONTEXT.md`: status updated.

Commands run and results:
- `dpm build` succeeds; DAR created at `.daml/dist/shadowdesk-rfq-1.0.0.dar`.
- `dpm test` green: all seven scripts ok (six scenarios plus `noop`).
- Live multi-participant run against one sandbox process hosting two participants on one synchronizer:
  - `dpm script` with `--participant-config participants.json --upload-dar=true --script-name ShadowDesk.Test:noop` uploads the DAR to participant1 (`sandbox`).
  - `dpm script` with `--participant-config participants-p2.json --upload-dar=true --script-name ShadowDesk.Test:noop` uploads the DAR to participant2.
  - `dpm script --participant-config participants.json --script-name ShadowDesk.Test:runMultiParticipantPrivacyAndSettlement` => SUCCESS on the live two-participant ledger.
- Live multi-participant evidence:
  - Dealer on participant2 cannot query Dealer on participant1's quote proposal or sealed quote (returns None), even though both dealers are invited to the same RFQ, proving cross-participant quote secrecy.
  - The two-party `Deal` created and `Settle` exercised by buyer + winning dealer on the same participant settles atomically; both legs (buyer receives the block, winning dealer receives the 100.5M payment) are verified from ledger queries, and the losing dealer on participant2 can never see the sealed quote.

Verified lessons (runner internals found by inspecting `daml-script-binary_distribute.jar` bytecode):
- The Daml Script runner's `--participant-config` file is an object with exactly three fields: `default_participant` (object with `participant_id`, `host`, `port`), `participants` (map of name to `{host, port}`), and `party_participants` (map of party to participant name). Field names are `host`/`port`, not `ledger_host`/`ledger_port`. Missing `party_participants` fails deserialization.
- `--upload-dar=true` uploads the DAR only to the default participant, so with N participants the DAR must be uploaded once per participant (run `noop` with each participant as default) or the synchronizer rejects the command with `PACKAGE_SELECTION_FAILED` (package not vetted by all hosting participants).
- The runner's `submit`/`submitMulti` requires all `actAs` parties on the same participant ("All parties must be on the same participant"). So the two-party `Deal`/`Settle` in the multi-participant scenario keeps buyer and winning dealer on the same participant; the losing dealer on the second participant still proves cross-participant privacy. Real cross-participant joint submits would require the agent services submitting per-party instead of the script runner.

Decisions made:
- Multi-participant privacy is proven live and recorded as demo evidence: the losing dealer's participant cannot see the winning dealer's quote/proposal/seal even though both were invited to the same RFQ on another participant.
- Agent services (next phase) must allocate parties idempotently and submit commands per participating participant instead of relying on the single-participant script runner for cross-participant joint transactions.

### Session 2026-09-18 (third): Node Agent Services Proven Against JSON Ledger API

Date: 2026-09-18.

Files added or changed:
- `agents/package.json`: private `type: module` package; scripts `demo` (`tsx demo/demo.ts`) and `typecheck` (`tsc --noEmit`); devDeps `tsx ^4.19.2`, `typescript ^5.6.3`, `@types/node ^20`.
- `agents/tsconfig.json`: ES2022, NodeNext module resolution, strict, noEmit.
- `agents/shared/types.ts`: `PACKAGE_NAME` (`shadowdesk-rfq`), `PACKAGE_ID` (`6cf7d6a6...d8646`, current DAR package id), `TPL` map with `#`-prefixed package-name template references, contract interfaces (BlockTradeRFQ, QuoteProposal, SealedQuote, Asset, Deal, SettlementReceipt; `LedgerEvent`/`CreatedEvent`/`TransactionResponse`).
- `agents/shared/config.ts`: `PARTICIPANTS` map (participant1 -> `http://127.0.0.1:6864`, participant2 -> `http://127.0.0.1:18003`), asset specs (cUSDC 6dp, cTBILL 10dp).
- `agents/shared/client.ts`: `CantonClient` over native Node `fetch` (v2 endpoints): `ledgerEnd`, `listParties`, `allocateParty`, `ensureParty` (allocate-or-reuse by party hint), `create`, `exercise`, `submit` (single `commands.submit-and-wait-for-transaction` call), `queryActiveContracts` (ACS, filters by template suffix), `waitForCondition`; `CantonError` with parsed `causeJson`; helpers `extractCreatedBytes` and `decimal`.
- `agents/shared/settlement.ts`: settlement-intent registry plus `settleDeal(buyer, dealer, sealedQuote, price)` that creates `Deal` actAs [buyer, dealer] and exercises `Settle`, returning the created `SettlementReceipt`.
- `agents/buyer/buyer.ts`: `BuyerAgent` (provision, ensureCash, createRfq, collectProposals) and deterministic `selectWinner<T>` (lowest `offeredPrice` within `maxPrice`, tie-break by bidId); `RfqSpec` and `defaultRfq` defaults.
- `agents/dealer/dealer.ts`: `DealerAgent` (provision, ensureInventory, observeRfqs, alreadyQuoted, quoteOn) with `fixedPricePolicy` and `baseBidPolicy`.
- `agents/demo/demo.ts`: orchestrator running buyer on participant1, dealerA on participant1 (price 100.2), dealerB on participant2 (price 100.5), one RFQ for 1,000,000 cTBILL max@101, both dealers quote, buyer selects and seals, DvP settles, then asserts the losing dealer sees zero of the winner's quotes and both legs landed.
- `PROJECT_CONTEXT.md`: status updated.

Commands run and results:
- `cd agents && npm install` -> green (`tsx`, `typescript`, `@types/node`).
- `cd agents && npx tsc --noEmit` -> clean after three fixes: made `selectWinner` generic in `T` so `_cid` survives; typed `queryActiveContracts` to return `CreatedEvent[]`; used `#`-prefixed package-name template references in `TPL` (bare package-name form is rejected with `TEMPLATES_OR_INTERFACES_NOT_FOUND` on the v2 JSON API).
- `cd agents && npm run demo` executed twice against the live sandbox (DAR 6cf7d6a6... uploaded to both participants in a previous session). Second run output:
  - dealerB (participant2) quoted 100.5, dealerA (participant1) quoted 100.2.
  - buyer collected two proposals, selected dealerA deterministically (lowest price), sealed the quote.
  - losing dealer saw 0 of the winner's quotes (privacy assertion passes).
  - DvP settled on participant1; buyer holds 1,000,000 cTBILL, dealerA holds 100,200,000 cUSDC.
  - `=== DEMO COMPLETE: atomic DvP settled, cross-participant quote secrecy intact ===`

Verified lessons (JSON Ledger API v2):
- Template reference when using the package name must be `#shadowdesk-rfq:ShadowDesk.Asset:Asset` (the `#` prefix is required); the package-id form (`6cf7...:ShadowDesk.Asset:Asset`) also works. A bare package-name form without `#` returns `TEMPLATES_OR_INTERFACES_NOT_FOUND`.
- Party allocation via `POST /v2/parties` with `{"partyIdHint": "X"}` is not idempotent (allocating a party hint that already exists returns `PARTY_MISMATCH`/"Party already exists"). `ensureParty` therefore lists `GET /v2/parties`, matches by hint prefix, and only allocates when absent, so the demo is rerunnable on a persisted sandbox.
- Command submission is one request: `POST /v2/commands/submit-and-wait-for-transaction` with body `{"commands": {"commands": [...], "commandId", "userId", "actAs"}}` (nested `commands` wrapper is required).
- ACS query: `POST /v2/state/active-contracts` with `{"activeAtOffset": N, "eventFormat": {"filtersByParty": {party: {cumulative: [...]}}, "verbose": false}}`; result rows are `{workflowId, contractEntry: {JsActiveContract: {createdEvent}}}`.
- Decimals are JSON strings (`"100200000.0000000000"`); `submit` passes them through unchanged, and `readAt`/matching machinery handles them without conversion. NaN cannot appear (strings only).

Decisions made:
- Agents use Node 20 + native `fetch` against the JSON Ledger API v2 (port 6864/18003), not gRPC; this keeps the demo simple and directly producible.
- The two-party `Deal`/`Settle` stays on participant1 (Daml Script runner's single-participant `actAs` restriction is a runner limitation, as recorded earlier). Cross-participant privacy is proven by the losing dealer on participant2 having zero visibility of the winner's quote, which the demo asserts.
- Deterministic tie-break on bidId keeps the winner selection reproducible (lowest price; equal prices -> lowest bidId).
- DealerB could not see `SealedQuote` for dealerA even though both are invited to the same RFQ, and this is asserted programmatically in the demo rather than just claimed.

Next actions:
1. Decide and implement the settlement asset story for DevNet (NameService/CIP-025 vs Canton Coin vs demo token) once DevNet credentials are available.
2. Pick the frontend framework and add the public metadata + institutional (buyer-side) views over the JSON API.
3. Consider a script or `scripts/localnet/` runner that restarts the sandbox, uploads the DAR to both participants, and runs `npm run demo` in one step for clean-checkout reproducibility.

### Session 2026-09-19 (fourth): Command-Center Dashboard Proven Live

Date: 2026-09-19.

Files added or changed:
- `frontend/package.json`: Next.js 15.5.4 (App Router, React 19.1, Turbopack dev on port 3001), `motion` 12, `lucide-react`, Tailwind v4 (`@tailwindcss/postcss`), TypeScript. Scripts `dev` (`next dev -p 3001`), `build`, `typecheck`.
- `frontend/tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `app/globals.css` (command-center tokens: dark studio `oklch(0.13 0.018 180)`, lime primary `oklch(0.88 0.18 116)`, dot-grid gradient layer; reduced-motion guard), `app/layout.tsx` (Geist Sans + Geist Mono via `next/font/google`).
- `frontend/lib/canton.ts`: read-only JSON API client (ping, ledgerEnd, listParties, queryActiveContracts) plus formatters. `frontend/lib/state.ts`: `loadDashboardState()` - reads buyer's contracts on participant1, dealerB's on participant2, derives the public projection (sanitized), the institutional projection (full payloads), and the live cross-participant privacy check. `frontend/lib/types.ts`: shared dashboard types.
- `frontend/app/api/state/route.ts`: GET -> `DashboardState` JSON (force-dynamic). `frontend/app/api/replay/route.ts`: POST spawns `npm run demo` in `agents/`, streams agent stdout lines + final `snapshot` + `done` as newline-delimited JSON over a `ReadableStream` (single-run lock; 409 while busy).
- `frontend/app/page.tsx`: main dashboard - floating pill nav (logo mark, Public/Institutional tabs, Run round CTA, live fabric status dot), dot-grid canvas, headline, tab AnimatePresence, 4s state poll, streaming console dock that slides up during a run and stays until minimized/closed.
- `frontend/components/hud.tsx`: HudPanel (micro-label header, PRIVATE badge), StatusPill (live/ok/muted/failed tones), Metric. `frontend/components/views/PublicView.tsx`: participant-fabric HUD + public-metadata terminal log (color-coded RFQ_CREATED/QUOTE_PROPOSAL/QUOTE_SEALED/DEAL_CREATED/DVP_SETTLED with timestamps, short cids, reference, payload-sensitivity tags) + cross-participant privacy banner. `frontend/components/views/InstitutionalView.tsx`: buyer participant view (buyer party, cTBILL block/cUSDC spent), Live RFQ (size, max price, settle-in, invited dealers), execution computers, quote proposals with SEALED/LOST states, settlement panel with DvP VERIFIED receipt.
- `PROJECT_CONTEXT.md`: status updated plus this session log.

Commands run and results:
- `cd frontend && npm install` -> green (approved sharp install script for next/image).
- `cd frontend && npx tsc --noEmit` -> clean.
- `cd frontend && npm run build` -> production build green; `/` (152 kB), `/api/state` and `/api/replay` dynamic.
- `npm run dev` on port 3001 (3000 is occupied by an unrelated Next 16 server) -> verified via Playwright headless Chromium at desktop 1440 / tablet 768 / mobile 390 (no horizontal overflow, single-line nav).
- Playwright end-to-end on `http://localhost:3001/: page title, floating nav, hero "A fund places a block. Two dealers price it blind.", Public view shows participant fabric endpoints + execution ledger + CROSS-PARTICIPANT PRIVACY (dealerB sees 0 of winner quotes), Institutional view shows Live RFQ + proposals + DvP VERIFIED, clicking Run round opened the streaming console ("executing on the live ledger..."), streamed all 22 agent stdout lines, finished with `DEMO COMPLETE`, and public counts advanced 6 -> 7 RFQs / 12 -> 14 proposals / 6 -> 7 sealed / 6 -> 7 receipts on the live ledger.

Verified lessons (frontend):
- Next 15 with Tailwind v4 uses `@tailwindcss/postcss` (no `tailwindcss` postcss plugin), `@import "tailwindcss"` in globals.css, and `@theme inline` tokens.
- The replay route returns newline-delimited JSON (not SSE); the client splits chunks on `\n` and JSON-parses each line. Envelopes: `{"line": ...}`, `{"snapshot": ...}`, `{"done": bool}`, `{"snapshotError": ...}`.
- Created events in the JSON API ACS v2 response carry `createdAt` (string timestamp), `createArgument`, `signatories`, `observers`, `offset` - enough to build a timestamped public timeline without any transaction-stream subscription.
- Deal contracts are archived when `Settle` runs, so an ACS-derived "active deals" count is always 0 after settlement; the dashboard's "Trades settled" metric therefore counts SettlementReceipts, and the settlement panel reads the receipt + deal reference from active contracts.
- A `next build` run while the dev server is up can leave the dev `.next` dir inconsistent (500s); restart `next dev` after builds.

Decisions made:
- Framework: Next.js + Tailwind v4 + Motion + lucide-react, App Router, Geist fonts - the repo's standard web stack, per prior projects.
- Dashboard is a live command-center console (dark studio, dot grid, lime accent, mono micro-labels) rather than a generic SaaS template; public projection and institutional projection are separate JSON projections so the browser never has privileged participant credentials.
- Re-using the agents (`npm run demo`) as the "Run round" engine keeps the dashboard honest: every panel is derived from real concurrent two-participant ledger state, and the privacy banner is a live cross-participant query, not a static claim.
- Dev server pinned to port 3001 because an unrelated Next 16 server owns 3000 on this machine.

Known remaining work:
- The frontend files (agents + frontend) are captured in `log/distributed/` only via the sandbox; there is still no git repo at the workspace root.
- DevNet asset standard decision still pending (credentials); frontend framework decision resolved (Next.js).

Next actions:
1. Wire `scripts/localnet/run-demo.sh` (already written, unverified because its sandbox teardown conflicted with this session's live sandbox) or a `frontend` bootstrap script that boots sandbox + uploads DAR to both participants + starts `next dev` on 3001 in one repro command.
2. Decide DevNet asset story once credentials exist; port the live demo to it.
3. Write the business brief / pilot-plan docs and record the walkthrough video (dashboard "Run round" + institutional view) for submission.

### Session 2026-09-19 (fifth): Clean-Checkout Bootstrap Verified End-to-End

Date: 2026-09-19.

Files added or changed:
- `scripts/localnet/run-demo.sh`: fixed port checks and timeout. Readiness now curls `http://127.0.0.1:6864/v2/version` and `http://127.0.0.1:18003/v2/version` (JSON API) instead of gRPC port 18001, which never answers plain HTTP and made the previous loop hang silently. Timeout enlarged to 240 one-second probes.
- `scripts/localnet/run-all.sh`: one-shot developer command. Kills any sandbox, boots the distributed two-participant topology, uploads the DAR to both participants, runs one full demo round against the fresh ledger, then starts (or reuses) the Next dashboard on `http://localhost:3001` and waits for `/api/state` to answer.

Commands run and results:
- `scripts/localnet/run-demo.sh` after the port fix: sandbox ready in 18s, DAR uploaded to participant1 then participant2, `npm run demo` completed with `DEMO COMPLETE: atomic DvP settled, cross-participant quote secrecy intact`. Delears quote on separate participants, deterministic winner dealerA @ 100.2 (maxPrice 101), losing dealerB sees 0 of winner's quotes, DvP settled on participant1 (receipt value 100200000), buyer holds 1xcTBILL, dealerA holds 1xcUSDC.
- `scripts/localnet/run-all.sh`: full clean-checkout run in one command - sandbox reset, DAR re-uploaded to both participants, fresh demo round, then dashboard reported `dashboard ready after 1s: http://localhost:3001` reusing the already-running next dev.
- Dashboard re-verified against the fresh ledger: `/api/state` returns counts rfqs/proposals/sealed/receipts from the new ledger end 49 / 27, both participants reachable; Playwright round-trip on localhost:3001 (Run round -> console streamed `executing on the live ledger...` -> `DEMO COMPLETE` -> receipts 1 -> 2) passed while the sandbox reset was in flight.

Verified lessons (bootstrap):
- The readiness probe against Canton JSON API must hit `/{api-version}/version` on the HTTP ports (6864, 18003). Reading only the `dpm.out` "ready" line is not enough and checking gRPC ports with curl hangs/times out.
- `next dev` on port 3001 survives a sandbox teardown/reboot as long as the process tree is not killed; after those runs the dashboard still served live data for the new ledger end without restart.
- `run-all.sh` is now the canonical repro: boot + seed + demo + dashboard. It is idempotent for the dashboard half (reuses a running dev server) but always resets the ledger, so a second invocation performs a fresh round.

Decisions made:
- Developer flow is now `./scripts/localnet/run-all.sh`, replacing the multi-step manual boot. The dashboard is left running; users re-run run-all to reset.

Known remaining work:
- `frontend/dev.log` noise: dashboard shows nothing when the sandbox is down during the reset window; it resumes polling and recovers by itself once the new ledger answers.
- The DAR is still rebuilt by hand (`daml build`) when Daml sources change; run-all.sh does not rebuild it.
- DevNet asset standard decision still pending (credentials); dashboard already builds from it.

Next actions:
1. Ask the user whether to keep `next dev` on 3001 long-running or stop it now that the demo flow is verified.
2. Record the walkthrough video and write the submission brief once DevNet (or the current local flow) is chosen for the final recording.
3. Git-init the workspace root and make an initial commit so the verified baseline is saved.

### Session 2026-09-26: Award Policy Declared On-Ledger and Settlement Bound to the Award

Date: 2026-09-26.

Files added or changed:
- `daml/src/ShadowDesk/Rfq.daml`: added `data SelectionPolicy = LowestPriceThenBidId deriving (Eq, Show)`, declared `selectionPolicy` on `BlockTradeRFQ`, copied it into each `SealedQuote` in `AcceptProposal`, and removed the `SealedQuote.AcceptQuote` choice.
- `daml/src/ShadowDesk/Settlement.daml`: `Deal` gained `sealedQuote : ContractId SealedQuote`. `Settle` fetches that award and asserts buyer, dealer, unit price, amount, security symbol, and settlement symbol all agree with it. `SettlementReceipt` records `rfq`, `sealedQuote`, `bidId`, and `selectionPolicy`.
- `daml/src/ShadowDesk/Test.daml`: `runDealMustMatchAward` (underpriced, resized, and wrong-dealer deals rejected, assets untouched); the privacy lifecycle now awards one winner and asserts the losing dealer cannot list or fetch the award; the settlement scenarios assert the receipt's RFQ, sealed quote, bid id, and policy.
- `daml/daml.yaml`: version 1.1.0.
- `agents/shared/types.ts`: new package id, `SelectionPolicy`, and the new contract fields.
- `agents/buyer/buyer.ts`: exported `SELECTION_POLICY` and stamped it on every RFQ.
- `agents/shared/settlement.ts`: `DealSpec` takes the sealed quote plus the expected bid id and policy; `settleDeal` verifies all three on the returned receipt.
- `agents/demo/demo.ts`: the `SealedQuote` CreatedEvent was previously searched for and discarded; it is now captured, policy-checked, passed into settlement, and printed as the receipt's audit chain.
- `agents/e2e/award-chain-check.ts` (new) and `agents/package.json`: `npm run e2e:award-chain`.
- `README.md`: award rule, award-bound settlement, and the new check.

Commands run and results:
- `cd daml && dpm test`: eight scenarios pass, exit 0. A ninth scenario, `runRfqIsAwardedAtMostOnce`, was added later in the same session; see below.
- `cd agents && npm run typecheck`, `cd frontend && npm run typecheck`, `cd frontend && npm run build`: pass.
- `cd daml && dpm build`: `.daml/dist/shadowdesk-rfq-1.1.0.dar`, package id `0450b46f9ccfaab4fc4730394d7dc38ba36a379827a16881b82c7431b677f979` at this point in the session.
- `cd agents && npm run e2e:award-chain` against `dpm sandbox` (Canton 3.5.17, JSON API 6864): the ledger round-trips `SelectionPolicy` as the JSON string `"LowestPriceThenBidId"`, the award-to-receipt chain resolves, a mismatched `Deal` is rejected, and the security asset is untouched afterwards. The check also asserts the ledger serves the pinned `PACKAGE_ID`, so a stale id fails loudly.

### Session 2026-09-26 (second): Awarding Consumes the RFQ

Date: 2026-09-26.

Files added or changed:
- `daml/src/ShadowDesk/Rfq.daml`: `AcceptProposal` now archives the RFQ after the asserts pass, so a request can be awarded at most once. `SealedQuote` gained `rfqReference`, `maxPrice`, and `invitedDealers` so the award stays a self-describing record of the request it answered.
- `daml/src/ShadowDesk/Test.daml`: added `runRfqIsAwardedAtMostOnce`, which awards one of two proposals and then shows the RFQ is archived, the losing proposal cannot be awarded, the award cannot be replayed, `CloseRfq` no longer applies, a late dealer cannot add a proposal, and exactly one award exists. The privacy lifecycle no longer closes the RFQ after the award, because the award already consumed it.
- `agents/shared/types.ts`, `agents/e2e/award-chain-check.ts`: the new award fields on the wire, plus a real-ledger second-award rejection and an assertion that exactly one award exists.
- `frontend/lib/state.ts`: an awarded RFQ is reconstructed from the surviving `SealedQuote`, so the buyer's last round does not vanish from the Institutional view; proposal `rfqRef` falls back to the award; the public projection counts and emits `RFQ_CREATED` for an awarded-then-archived request.
- `frontend/lib/types.ts`, `frontend/components/views/InstitutionalView.tsx`: RFQ rows carry `awarded`, and the panel reads `Awarded RFQ` / `AWARDED` once consumed instead of claiming `OPEN`.
- `scripts/localnet/run-demo.sh`: resolve the DAR from the version in `daml/daml.yaml` and fail with a build hint if it is missing.

Commands run and results:
- `cd daml && dpm test`: nine scenarios pass, exit 0.
- `cd daml && dpm build`: package id `f3655cf47a0095fdaf023f303b3657b529a7f38de44b2d39330cad6a273d0a5f`.
- `cd agents && npm run e2e:award-chain`: the ledger rejects the second award, exactly one award exists, the award records the request reference, max price, and invited dealer count, settlement still succeeds, and a mismatched deal is still rejected with the security untouched.
- `./scripts/localnet/run-demo.sh`: two-participant sandbox ready in 16s, DAR uploaded to both participants, full demo round completed with dealerA winning at 100.2, receipt value 100200000, losing dealer seeing 0 of the winner's quotes.
- Dashboard verified against that ledger in localnet mode: public counts `{rfqs: 1, proposals: 2, sealed: 1, deals: 0, receipts: 1, assets: 1}`, the single RFQ row reconstructed with `awarded: true` and the correct reference, both proposals resolving `rfqRef` to the awarded request, and the privacy banner still reporting the losing dealer sees 0 winner quotes.

Decisions made:
- Single-award enforcement consumes the RFQ rather than relying on contract keys, which need LF 2.3 and are rejected by this toolchain. Archiving inside `AcceptProposal` also closes concurrent acceptance, because only one transaction can archive the contract.
- The asserts stay ahead of the archive, so a rejected acceptance (for example an over-limit price) leaves the request open.
- The award became the durable description of the request. This was not optional: once the RFQ is archived, no surviving active contract carries its reference, max price, or dealer list, so the dashboard could not otherwise render the awarded round.
- The move to a consuming `AcceptProposal` on the RFQ was rejected. It would enforce one award too, but it would let the buyer pass arbitrary price and dealer as choice arguments, so the price would no longer be backed by the dealer's signature on the proposal.

Known failures and limits:
- The ledger cannot verify that the buyer awarded the cheapest eligible quote. It proves the award matches a dealer-signed proposal and that only one exists.
- Awarding archives the RFQ, so a still-open request can no longer be distinguished from an awarded one in the active contract set; the dashboard reconstructs the distinction from the award.
- `dpm build` emits a non-blocking `-Wtemplate-interface-depends-on-daml-script` warning because the test module imports `Daml.Script`.
- The package id depends on exact Daml source bytes, so it must be re-read from the DAR after any source edit. It moved twice in this session.

Next actions:
1. Upload `.daml/dist/shadowdesk-rfq-1.1.0.dar` to DevNet and rerun the demo and the award-chain check there.
2. Keep real-value settlement (CIP-56 `allocate`/`execute` over Splice Amulet) as a separate workstream; it needs a Docker LocalNet plus Amulet and the `splice-token-standard-test` harness, and dealer Amulets that do not exist yet.
3. Record the walkthrough and submission brief once DevNet is confirmed for the final recording.

### Session 2026-09-26 (third): DevNet Upload Landed, Blocked on Validator Vetting

The 1.1.0 DAR reached the shared DevNet participant and is accepted by the API, but the round cannot be submitted.

Package state on hackcanton-01:
- 1.1.0 is present. `GET /v2/packages/<id>/status` returns `PACKAGE_STATUS_REGISTERED`; `GET /v2/packages/<id>` returns 200.
- 1.0.0 (`6cf7d6a6d9ab600cdbafed0c0623207aa15e0a234ccb911359d8d925468d8646`) is also present and is the only vetted candidate.
- An earlier 1.1.0 build (`0450b46f...`) is absent; it was pre-change and never uploaded.

Blocking error, reproduced with trace `25938967cca640be6be33dd3ab74d202`:
`JSON_API_PACKAGE_SELECTION_FAILED: No synchronizer satisfies the vetting requirements. No vetted package candidate satisfies the package-id filter`
This is validator-side state, not participant-side. It cannot be fixed client-side; NODERS must vet 1.1.0. Re-uploading does not help, because the package is already registered.

Hazard worth carrying to NODERS: the JSON Ledger API resolves a `templateId` of the form `#shadowdesk-rfq:Rfq` by package *name*. With 1.0.0 and 1.1.0 both registered under `shadowdesk-rfq`, name-based resolution silently selects 1.0.0, and a 1.1.0 command fails with `Unexpected fields: selectionPolicy`. Any 1.0.0-era client on that node is talking to the old package without any signal. The fix on our side is the documented command-level `packageIdSelectionPreference`, which is what the error above was asking for.

Three defects found while chasing this, all fixed:
- The award-chain check fetched `/v2/packages` unauthenticated. On a node requiring auth the 401 surfaced as "upload the current DAR first", sending us to re-upload a package that was already present. It now uses the authenticated client.
- The check derived its base URL from `SHADOWDESK_LEDGER_URL` alone, so a DevNet run without that extra variable silently targeted `127.0.0.1`. It now derives the URL from the configured participant.
- "exactly one award" counted every active `SealedQuote` on the ledger rather than this run's, so it only passed on a pristine sandbox and would fail every time on the shared DevNet. It is now scoped to the run's reference.

The README claimed DevNet RFQ execution was "intentionally disabled". The replay route has no such switch; it requires a signed-in session and a configured party per role. Corrected.

Local validation after the fixes: `dpm test` 9/9; agents typecheck clean; award-chain e2e passes repeatedly, including on a ledger that already holds a prior award and with the base URL variable unset; the two-participant demo completes with atomic DvP and dealer secrecy intact.

Environment note: the demo's `LOCAL_VERDICT_TIMEOUT` on first create was resource exhaustion, not a ledger fault. The sandbox JVM was sizing its heap from ambient RAM and overcommitting while the machine sat at 8.2 GB of 9.2 GB swap used. `run-demo.sh` now caps the heap via `JAVA_OPTS`, which makes the demo footprint independent of what else is running. Verified: sandbox RSS ~736 MB, demo completes, memory-pressure free share 49 percent before and 39 percent after.

Security note: a diagnostic during this session printed live OIDC access and refresh tokens into the local transcript. Treat that transcript as sensitive; revoke and re-authenticate rather than reusing the session.

DevNet topology note: every party created on the shared participant shares the same `::1220...` suffix because that suffix is the participant node id.
The UI's party-filtered query can still show that Dealer B's view returns zero of Dealer A's quote contracts.
However, the configured shared ledger identity can read as all three parties, so this does not prove isolation from a credential authorized for both dealers.
The two-participant LocalNet proves that separate-participant setup; DevNet tests the shared-node integration path.

Canton privacy correction: the synchronizer orders encrypted messages and cannot decrypt transaction payloads.
Avoid saying that it sees plaintext contract content.
It is accurate to describe the JSON Ledger API query as a party-scoped participant view, not as a query to the synchronizer.

Next actions:
1. NODERS to vet 1.1.0 (`f3655cf47a0095fdaf023f303b3657b529a7f38de44b2d39330cad6a273d0a5f`). Ask whether vetting is automatic after upload or needs a manual trigger, and whether a same-name re-vet is possible or a new version or package name is required.
2. Re-authenticate, then rerun the DevNet award-chain check to confirm the `packageIdSelectionPreference` fix carries through end to end.
3. Record the walkthrough from the two-participant localnet, not the DevNet, because only the localnet can evidence dealer isolation.

### Session 2026-09-27: DevNet UI Readiness and Live Ledger Inspection

The DevNet-configured frontend is running at `http://localhost:3001`.
`GET /api/auth/session` reported `mode=devnet`; after the user signed in, a fresh authenticated request to the participant succeeded.

The participant responds to `GET /v2/version` with HTTP 200.
The authenticated package status for `f3655cf47a0095fdaf023f303b3657b529a7f38de44b2d39330cad6a273d0a5f` is HTTP 200 with `PACKAGE_STATUS_REGISTERED`.
This does not show the 1.1.0 build as vetted; the last command-submission attempt reported no vetted candidate for its package-id preference.
Do not run the current 1.1.0 UI round until NODERS confirms vetting, because the command will be rejected before settlement.

An authenticated party-scoped ACS read found an existing DevNet round using package 1.0.0 (`6cf7d6a6...`).
Its receipt records 1,000,000 synthetic `ShadowDesk` cTBILL at unit price 100.2, total 100,200,000 synthetic `ShadowDesk` cUSDC.
The buyer ACS also contains an active Amulet contract, but the ShadowDesk settlement code does not use it.
The visible cTBILL/cUSDC contracts are `ShadowDesk.Asset` demo instruments, not Canton Token Standard holdings.
The buyer's party-scoped ACS and both dealer party-scoped ACS queries succeeded; listing all parties via `GET /v2/parties` returned 403, so continue using the configured role-party IDs rather than depending on party enumeration.

DevNet UI now labels custom instruments as synthetic `ShadowDesk.Asset` symbols, not registry tokens.
The privacy panel distinguishes party-view queries on a shared endpoint from queries through distinct participant endpoints.
It only reports the privacy query as checked after the query actually runs.
README, architecture, demo script, and this context now describe participant Ledger API views accurately and state that the synchronizer cannot decrypt private payloads.

The Build-on-Canton MCP is configured globally in OpenCode and `opencode mcp list` reported `canton-dev` connected.
Restart OpenCode to load newly configured MCP tools into a fresh session.

Next actions:
1. Upload the corrected 1.1.1 DAR and ask NODERS to vet package `407a00845eebd756d8a23bcac1a6e1a4b143e01e353c551ccf859a39baba2bbe`; do not ask them to vet the superseded 1.1.0 build.
2. Request CBTC test holdings for the configured buyer/dealer parties from BitSafe or the event operators; query the onRails team for the DevNet cETH instrument id and test-token grant.
3. Build and test CIP-0112 allocation DvP locally, then submit the next compatible DAR for vetting once the token-rail path is complete.

### Session 2026-09-27 (second): Max-Price Override Regression and Package 1.1.1

A direct Daml Script reproduction found that a buyer could pass `maxPrice = 1000` to `AcceptProposal` and award a quote at 101.01 even though the stored RFQ cap was 101.
The choice compared the quote against its caller-supplied argument rather than the immutable RFQ value.
The same pattern is present in the deployed 1.0.0 source; those DevNet contracts use synthetic `ShadowDesk.Asset` instruments, not real tokens.

Fixes applied:
- `AcceptProposal` now requires its `maxPrice` argument to equal the RFQ's stored maximum and checks the quote against the stored maximum.
- `Deal.Settle` rechecks that the awarded quote did not exceed its recorded maximum.
- `runMaxPriceCannotBeOverridden` submits a 101.01 proposal against a 101 RFQ, tries to override the command argument to 1000, and verifies the award is rejected while the RFQ remains active and no sealed quote is created.

The reproduction failed before the contract change exactly as expected: the over-cap award committed and archived the RFQ.
After the change, `dpm test` passes nine scenarios plus `noop`; agent TypeScript typecheck also passes.
The Daml package version is now 1.1.1, package id `407a00845eebd756d8a23bcac1a6e1a4b143e01e353c551ccf859a39baba2bbe`.
This artifact is not yet uploaded or vetted on DevNet, and the agent package-id pin was updated to match it.

The old NODERS request for 1.1.0 is superseded: same-name package 1.1.1 was rejected as an incompatible upgrade, so request vetting for `shadowdesk-rfq-v2` 1.0.0 instead.
The buyer price ceiling is still visible to invited dealers because `maxPrice` is currently a field on the observed RFQ.
Making the cap buyer-private requires a separate buyer-only mandate contract and should be designed before another schema release.

### Session 2026-09-27 (fourth): Use a New Package Name for the Breaking Schema

Uploading `shadowdesk-rfq` 1.1.1 failed with `NOT_VALID_UPGRADE_PACKAGE`: the node compared it against vetted `shadowdesk-rfq` 1.0.0 and found that `SealedQuote.AcceptQuote` was removed.
The full source diff also adds required fields to existing templates and changes settlement contracts, so restoring that one choice would only reveal more upgrade incompatibilities.
Do not keep patching one compatibility error at a time.

The 1.1.1 source was renamed as a fresh package line, `shadowdesk-rfq-v2` version `1.0.0`, to coexist with the existing vetted `shadowdesk-rfq` package without claiming a schema upgrade.
The rebuilt package id is `6b2d3dfa528026be8a3c7446b8d5a995b771d90be42a7a8f7952a3065d68f6ae`.
`agents/shared/types.ts` pins this id and the v2 package name.
`dpm build`, `dpm test` (nine scenarios plus `noop`), and `npm run typecheck` pass.
The new DAR has not been uploaded or vetted on DevNet.

Next action: upload `.daml/dist/shadowdesk-rfq-v2-1.0.0.dar` and ask NODERS to vet package id `6b2d3dfa528026be8a3c7446b8d5a995b771d90be42a7a8f7952a3065d68f6ae`.

Current HackCanton Season 3 research:
- The AppsFactory event page lists submission at October 9, 2026, 23:59 UTC; five tracks; one project may enter up to two tracks.
- The most relevant tracks are Financial Applications (real economic activity and network flows) and Investment Infrastructure (fund/capital workflows, role-based operation, auditability).
- Season 2's overall winners were Rocky Exchange, Umbra, and Tirai; Umbra and Tirai directly overlap ShadowDesk's confidential OTC/RFQ thesis.
- NODERS' recap says the strongest projects made Canton do real architectural work, shipped a workflow reviewers could inspect asynchronously, and showed live DevNet transactions and honest evidence.
- Tirai's current public README describes real Canton Coin/CBTC settlement via CIP-0056 allocation, Vickrey, regulator reporting, selective disclosure, and best-execution attestations; its reported trade history is explicitly described as seeded, not customer volume.
- ShadowDesk should not pitch itself as the first private RFQ desk. A differentiated route is policy-controlled treasury rebalancing with real token-standard DvP and a clear fund/treasury buyer.

Current CBTC registry research:
- The original registry probes used incorrect root paths. Correct CBTC metadata path: `https://api.utilities.digitalasset-dev.com/api/token-standard/v0/registrars/cbtc-network::12202a83c6f4082217c175e29bc53da5f2703ba2675778ab99217a5a881a949203ff/registry/metadata/v1/instruments`.
- The endpoint returned HTTP 200, instrument `CBTC`, `paused=false`, total supply `1013.39356` as of `2026-09-27T09:05:46Z`, and both V1/V2 holding and allocation APIs.
- No CBTC Holding contract appeared in the configured buyer or dealer ACS queries. The buyer has an Amulet contract, but ShadowDesk does not use it.
- BitSafe's current DevNet quick-start says external users cannot mint/redeem on DevNet; request test holdings or an authorized holder transfer before treating CBTC as usable.
- The DevNet cETH registrar/instrument id and USDCx DevNet metadata have not been verified; do not substitute their MainNet identifiers.

Content MCP contribution opportunity:
- `canton-network-devs/Build-on-Canton-MCP` has no open issues and one open knowledge-base PR (#17) correcting party allocation paths and C7 package names.
- Its current knowledge base does not mention CBTC/BitSafe/cETH or `packageIdSelectionPreference` / package vetting.
- A separate sourced knowledge-base contribution can document the issuer-specific metadata path, network-specific instrument ids, actual DevNet CBTC limitations, and exact-package selection/vetting pitfalls.
- The MCP is read-only; contributions are GitHub content PRs, not actions performed through the MCP server.

## Open Decisions

These decisions must be resolved before production implementation.

- Which HackCanton track is selected?
- Which Canton DevNet environment and version are required?
- Which token or asset is available for real settlement?
- Will the backend use gRPC or JSON Ledger API first? (Resolved: JSON Ledger API v2, see session log.)
- Which frontend framework and package manager will be used? (Resolved: Next.js 15 + Tailwind v4 + Motion, npm.)
- Does the target environment provide separate participant nodes for the buyer and dealers?
- Is the quote proposal template required after the Daml authorization spike?
- Which team member owns the deployment environment?
- Which frontend framework and package manager will be used?
- Is an external LLM required by the judging criteria or only optional?
- What evidence format is required for the final submission?

## Non-Negotiable Demo Claims

The demo may claim that Canton enforces selective visibility only if participant-level tests and live ledger queries support that claim.

The demo may claim atomic settlement only if both legs are represented by the supported settlement mechanism and the result is verified from actual Canton transaction data.

The demo must not claim that the public UI is reading private plaintext from the synchronizer.

The demo must not claim production readiness or institutional compliance.

## References

- Canton Network documentation: https://docs.canton.network/
- Canton Ledger API reference: https://docs.canton.network/sdks-tools/api-reference/ledger-api
- Canton JSON API reference: https://docs.canton.network/sdks-tools/api-reference/json-api
- Canton token standard reference: https://docs.canton.network/overview/reference/cip-0056
- HackCanton program page: https://appsfactory.cc/hackathons

## Session Handoff Format

At the end of each implementation session, update this file with:

- Current date.
- Files added or changed.
- Commands run and results.
- Contracts deployed and package identifiers if applicable.
- Known failures.
- Decisions made.
- Next three actions.

Do not mark a feature complete based only on code being written.

Mark it complete only after the relevant build, test, or live ledger verification has passed.
