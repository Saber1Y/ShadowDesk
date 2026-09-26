# ShadowDesk Project Context

## Purpose

This file preserves the reasoning and decisions needed to continue ShadowDesk across OpenCode sessions.

Read this file before changing architecture, contract visibility, settlement logic, or demo claims.

## Current Status

- Repository state: git repo initialized at workspace root (branch `main`, remote origin `https://github.com/Saber1Y/ShadowDesk`), Daml package scaffolded at `/Users/mac/codes/Shadow Desk/daml`, TypeScript agents in `agents/`, Next.js dashboard in `frontend/`; runtime artifacts (node_modules, .daml, log/, .next) gitignored. History committed per logical file/unit; dashboard rebranded to the official Canton palette (yellow `#F3FF97`, black `#030206`, white `#FFFFFC`, lilac `#D5A5E3`, purple `#875CFF`, taupe `#A89F91`) with a segmented C-ring mark + `app/icon.svg` favicon.
- Implementation state: privacy templates compiling, agent services live, dashboard live.
- Daml state: package `shadowdesk-rfq` 1.1.0 builds to `.daml/dist/shadowdesk-rfq-1.1.0.dar` (package id `0450b46f9ccfaab4fc4730394d7dc38ba36a379827a16881b82c7431b677f979`); eight daml-script tests pass via `dpm test` (seven scenarios plus `noop`).
- Canton state: local Canton 3.5.17 sandbox validated. `dpm sandbox` starts a full single-process network; Ledger API gRPC on 127.0.0.1:6865, HTTP on 6864. Party store persists per-node between runs; readiness must be keyed on the log line `Canton sandbox is ready.`, not on the port.
- Multi-participant state: `dpm sandbox -c daml/distributed-run.conf` brings up a second participant `participant2` (Ledger API gRPC 18001, admin 18002, HTTP 18003) on the same synchronizer, auto-connected. Cross-participant privacy and settlement proven live via `participants.json`/`participants-p2.json` runner configs (default participant hosts the DAR upload; `--upload-dar=true` uploads only to the default participant, so DAR must be uploaded once per participant).
- Agent state: buyer/dealer/dealer agent services scaffolded in `/Users/mac/codes/Shadow Desk/agents` (TypeScript + Node, JSON Ledger API v2). Waits proven live end-to-end across both participants: buyer creates RFQ, both dealers quote from their own participant, buyer deterministically selects the winner within maxPrice, seals the quote, and DvP settles atomically on participant1. The losing dealer on participant2 sees zero of the winner's quotes (asserted in the demo run).
- Frontend state: Next.js 15 (App Router, Tailwind v4, Motion, lucide) dashboard in `/Users/mac/codes/Shadow Desk/frontend`. Live command-center console UI: floating pill nav, dot-grid dark studio, lime accent, mono micro-labels. Two tabs: Public projection (sanitized execution-ledger metadata + cross-participant privacy banner) and Institutional (buyer view: holdings, live RFQ, independent quotes with sealed/lost states, settled DvP receipt). A "Run round" button streams the real two-participant agent run into a terminal console and the projections update live from actual ledger queries. Server-side projections read the JSON API on both participants; the browser never touches a participant directly.
- Settlement state: two-leg atomic DvP implemented. `Deal` template (signatory buyer+dealer) with `Settle` choice performs validated payment-for-security exchange in one transaction; `SettlementReceipt` issued. Guards: expiry, exact security quantity, settlement-asset match, payment coverage, and agreement with the awarded `SealedQuote` (buyer, dealer, price, size, and both instruments). Both legs verify from ledger results in tests. The receipt records the originating RFQ, the sealed quote, the winning bid id, and the selection policy, so the award is traceable on-ledger.
- Selection state: each `BlockTradeRFQ` declares a `SelectionPolicy` (`LowestPriceThenBidId`) that the sealed quote inherits. The buyer agent still ranks proposals client-side, because Daml cannot enumerate every proposal contract to compute a global minimum, and the ledger enforces only that settlement matches the award. The contract does not yet prevent a buyer from accepting more than one proposal for the same RFQ; archiving the RFQ on the first award is the intended fix.
- Deployment state: package `shadowdesk-rfq` 1.1.0 is built and verified against a local Canton 3.5.17 sandbox via `npm run e2e:award-chain` in `agents/`; it is not yet uploaded to the live sandbox or DevNet. DevNet upload of the new DAR is a manual step. The previous 1.0.0 build was uploaded to the live local sandbox (main package id `f719639eab2b84e28af4f175ad4056b24ddb1aefb4c9112bdd86f759ab94a5b8` at session end; earlier build was `863466b59a887f46b38f58485e6ff7540a93453bb9d052b2586da81795d9b07a`).
- Verification state: all five daml-script scenarios executed successfully against the live sandbox Ledger API via `dpm script` with party allocation, DvP settlement, and fraud-rejection on real transactions. Multi-participant privacy and settlement scenario also executed successfully against a live two-participant sandbox. The 1.1.0 award chain was additionally verified against a real single-node sandbox Ledger API through the JSON API.
- Planning state: product concept, MVP requirements, and phase plan are documented.

## Product Decision

ShadowDesk will be presented as a private institutional RFQ and delivery-versus-payment prototype.

The project will prove protocol-enforced privacy and real Canton settlement before adding advanced AI behavior.

The first demo will use one buyer, two dealers, one RFQ, two quotes, one accepted quote, and one settlement.

## Real-World Product Story

The primary use case is an institutional fund purchasing a large block of tokenized short-term government securities.

The fund manager wants competitive dealer pricing but does not want to publish the order size or reveal the accumulation strategy.

The buyer agent privately invites approved market makers.

Each dealer sees the RFQ terms required to price the trade, but competing dealers do not see one another's quotes.

The buyer agent applies deterministic price, slippage, expiry, and dealer-policy checks before accepting the best quote.

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
- `cd daml && dpm test`: eight scenarios pass, exit 0.
- `cd agents && npm run typecheck`, `cd frontend && npm run typecheck`, `cd frontend && npm run build`: pass.
- `cd daml && dpm build`: `.daml/dist/shadowdesk-rfq-1.1.0.dar`, package id `0450b46f9ccfaab4fc4730394d7dc38ba36a379827a16881b82c7431b677f979`.
- `cd agents && npm run e2e:award-chain` against `dpm sandbox` (Canton 3.5.17, JSON API 6864): the ledger round-trips `SelectionPolicy` as the JSON string `"LowestPriceThenBidId"`, the award-to-receipt chain resolves, a mismatched `Deal` is rejected, and the security asset is untouched afterwards. The check also asserts the ledger serves the pinned `PACKAGE_ID`, so a stale id fails loudly.

Decisions made:
- The RFQ now carries the rule that produced the award, so the selection policy is auditable on-ledger rather than implied by the buyer agent.
- `SealedQuote.AcceptQuote` was deleted rather than kept. It asserted four conditions and then archived the quote, which made the award a consumable placeholder and left the pre-existing gap that a settled `Deal` could never prove which quote it was honouring.
- The deal's agreement with its award is enforced on-ledger in `Settle` rather than only in the agent, so a drifting client cannot settle against different terms.

Known failures and limits:
- Contract keys remain unavailable: the compiler reports `Contract Keys not supported on current lf version (2.2), feature supported in from 2.3`, and `language-version: 2.3` is ignored by this toolchain with no `dpm` override. This is why there is no contract-key uniqueness guard.
- The ledger still permits a buyer to accept more than one proposal for the same RFQ, so more than one award, and more than one settlement, can exist for one request. Archiving the RFQ inside the successful `AcceptProposal` is the intended fix and is not yet implemented.
- Proposal ranking stays client-side; Daml cannot enumerate all proposal contracts to compute a global minimum.
- The e2e check runs on a single node with one party acting as both buyer and dealer, so it proves encoding and the award invariant, not cross-participant privacy. Cross-participant privacy still rests on the daml-script scenarios and the earlier live run.
- Package 1.1.0 is not uploaded to the live sandbox or DevNet. DevNet upload is a manual Console step, and the 1.0.0 contract shapes cannot serve the new fields.
- The package id depends on the exact Daml source bytes: a trailing-newline change alone moved it, so the id must be re-read from the DAR after any source edit.

Next actions:
1. Implement single-award enforcement by archiving the RFQ on the first successful `AcceptProposal`, add a duplicate-award regression test, and drop the now-redundant `CloseRfq` in the lifecycle test.
2. Upload `.daml/dist/shadowdesk-rfq-1.1.0.dar` to the live sandbox and DevNet, then rerun the demo and the award-chain check against DevNet.
3. Keep real-value settlement (CIP-56 `allocate`/`execute` over Splice Amulet) as a separate workstream; it needs a Docker LocalNet plus Amulet and the `splice-token-standard-test` harness, and dealer Amulets that do not exist yet.

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
