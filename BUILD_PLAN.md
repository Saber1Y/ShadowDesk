# ShadowDesk Build Plan

## 1. Build Objective

Ship a judge-ready MVP that proves one real private RFQ lifecycle on Canton.

The MVP must connect Daml contracts, buyer and dealer agents, real participant APIs, a minimal institutional dashboard, and an actual settlement result.

The build must prioritize a verified end-to-end path over broad feature coverage.

The implementation order is ledger first, agents second, settlement third, frontend fourth, and presentation last.

## 2. Definition of Done

The build is ready for demo recording when all of the following work from a clean checkout.

- The Daml package compiles.
- Contract tests pass.
- A local Canton environment can host the package.
- A buyer party can create an RFQ.
- Two dealer parties can receive the RFQ.
- Two dealer parties can submit quotes.
- Dealer A cannot read Dealer B's quote.
- The buyer can compare and accept one quote.
- The selected trade settles through a real Canton workflow.
- The application verifies the settlement result from the Ledger API.
- The dashboard shows authorized institutional data.
- The public view shows metadata without private payloads.
- Expiry, duplicate acceptance, unauthorized access, and failed settlement paths are tested.
- Setup instructions reproduce the working demo.
- No secrets or simulated success data are committed.

## 3. Delivery Strategy

Build three vertical slices in sequence.

### Slice A: Private RFQ

Create an RFQ, expose it only to invited dealers, and prove the visibility boundary.

### Slice B: Private Quote Selection

Receive isolated dealer quotes, evaluate them using deterministic rules, and accept exactly one quote.

### Slice C: Settlement and Presentation

Settle the accepted trade, expose the result in the dashboard, and produce the privacy demonstration.

Do not start the polished interface until Slice A and Slice B work through real ledger commands.

## 4. Workstreams

### Workstream A: Canton and Daml

Owner profile: Daml architect.

Responsibilities:

- Scaffold the Daml project.
- Define templates and choices.
- Validate signatories, observers, and controllers.
- Implement expiry and replay protection.
- Write visibility and authorization tests.
- Build and deploy the DAR.

Exit condition:

The privacy test suite proves that competing dealers cannot query one another's quotes.

### Workstream B: Settlement

Owner profile: settlement engineer.

Responsibilities:

- Inspect available DevNet and LocalNet assets.
- Select the supported Canton token or test asset mechanism.
- Implement the two-leg settlement flow.
- Verify atomic completion and failure behavior.
- Persist settlement references for the audit report.

Exit condition:

The selected quote produces a real, verified settlement result using available Canton assets.

### Workstream C: Agent Orchestration

Owner profile: agent engineer.

Responsibilities:

- Implement buyer and dealer services.
- Connect to participant Ledger APIs.
- Subscribe to authorized updates.
- Add deterministic dealer pricing.
- Add buyer quote comparison.
- Add idempotent command submission.
- Add reconnect and error handling.

Exit condition:

The complete RFQ flow runs without manually entering ledger commands after the initial trade intent.

### Workstream D: Frontend and Information Design

Owner profile: frontend engineer.

Responsibilities:

- Build the institutional command center.
- Build the public metadata panel.
- Display agent and ledger state.
- Display privacy proof results.
- Display transaction and audit status.
- Implement loading, failure, expiry, and success states.

Exit condition:

The five-minute demo can be run from the dashboard without terminal-only steps except for environment startup.

### Workstream E: Product and Submission

Owner profile: product and demo lead.

Responsibilities:

- Maintain the business narrative.
- Confirm the target track and judging requirements.
- Write the business brief and pilot plan.
- Maintain the demo script.
- Record the final walkthrough.
- Check that every technical claim is backed by evidence.

Exit condition:

The submission explains a real institutional use case, shows a working product, and avoids unsupported privacy or settlement claims.

## 5. Phase Plan

### Phase 0: Environment Gate

Objective:

Prove that the development machine and target environment can run Canton before writing application code.

Tasks:

- Confirm HackCanton registration and selected track.
- Confirm Canton version and DevNet access requirements.
- Install or verify DPM.
- Install or verify Docker if required by LocalNet.
- Verify Node.js and the selected package manager.
- Verify Python only if the agent service will use Python.
- Start a minimal Canton LocalNet.
- Allocate or identify buyer and dealer parties.
- Identify available test assets.
- Verify Ledger API authentication.
- Verify package upload permissions.

Suggested checks:

```text
dpm --version
docker --version
node --version
npm --version
```

The exact LocalNet startup command must be taken from the current Canton tooling version.

Do not copy an old command from an unrelated Canton release without checking the installed version.

Gate criteria:

- LocalNet starts successfully.
- The participant API responds.
- At least three usable parties are available or can be allocated.
- The team knows which asset will be used for the first settlement test.

Fallback:

If DevNet access is delayed, continue on LocalNet with real ledger transactions and keep the asset adapter isolated for later migration.

### Phase 1: Repository and Contract Scaffold

Objective:

Create a reproducible project structure and compile the first Daml package.

Tasks:

- Create the Daml project.
- Create the agent service package.
- Create the frontend package only after the ledger package is scaffolded.
- Add environment configuration examples without secrets.
- Add a root README with setup placeholders.
- Add formatting and test commands.
- Add a health-check script for participant APIs.

Target initial structure:

```text
PRD.md
PROJECT_CONTEXT.md
BUILD_PLAN.md
README.md
agents/
frontend/
scripts/
```

Gate criteria:

- The Daml project compiles from the command line.
- The repository has a documented start and test command.
- No credentials are stored in tracked files.

### Phase 2: Private RFQ Contract

Objective:

Implement and verify the minimum private RFQ lifecycle.

Tasks:

- Implement `BlockTradeRFQ`.
- Add buyer signatory logic.
- Add invited dealer observer logic.
- Add RFQ expiry.
- Add positive amount validation.
- Add supported asset validation.
- Add a unique RFQ reference.
- Implement the quote submission design.
- Compile the quote authorization spike before selecting the final template structure.

Preferred quote design:

1. Dealer creates a dealer-signed quote proposal.
2. Buyer authorizes the proposal.
3. The resulting sealed quote is signed by buyer and dealer.

The final design may differ if the Daml authorization tests prove a simpler safe flow.

Required tests:

- Buyer can create an RFQ.
- Invited dealer can receive the RFQ.
- Uninvited party cannot receive the RFQ.
- RFQ cannot be created with an invalid amount.
- Expired RFQ cannot accept a new quote.
- Dealer cannot submit a quote for an uninvited party.
- Buyer authorization is required where the sealed quote requires buyer signature.

Gate criteria:

- The package compiles.
- Daml tests pass.
- A local ledger transaction creates the RFQ.
- Participant queries confirm the expected visibility.

### Phase 3: Participant-Level Privacy Proof

Objective:

Prove privacy from separate participant views rather than only from contract source code.

Tasks:

- Host buyer on a buyer participant.
- Host Dealer A on a dealer participant.
- Host Dealer B on a separate dealer participant.
- Create an RFQ for both dealers.
- Submit one quote for each dealer.
- Query active contracts from each participant.
- Confirm each dealer sees its own authorized data.
- Confirm each dealer cannot see the competing quote.
- Record the exact API response or test result for the demo.

Gate criteria:

- Unauthorized quote payload is unavailable from the participant API.
- The test does not rely on hiding data in the frontend.
- The privacy result can be repeated from a clean environment.

If separate participants are not available in the chosen environment, document that limitation and do not claim a full operator-level privacy demonstration.

### Phase 4: Buyer and Dealer Agents

Objective:

Run the RFQ workflow through services instead of manual commands.

Tasks:

- Implement a shared Ledger API client.
- Implement participant configuration per role.
- Implement buyer update subscription.
- Implement dealer update subscription.
- Implement reconnect behavior.
- Implement deterministic dealer pricing.
- Implement inventory and notional limits.
- Implement buyer quote collection.
- Implement quote ranking.
- Implement command IDs and idempotency.
- Implement structured logs.
- Implement a dry-run mode for local agent development.

Initial deterministic dealer formula:

```text
quoted_price = reference_price + inventory_adjustment + risk_adjustment + configured_spread
```

The formula is for a demo strategy and must not be represented as production market-making logic.

Initial buyer policy:

```text
eligible quote = valid amount
                 and unexpired
                 and within maximum price
                 and within allowed dealer set
                 and settlement-capable
```

The buyer selects the lowest eligible purchase price unless the trade policy explicitly changes that behavior.

Gate criteria:

- Agents observe real ledger events.
- Agents submit real commands.
- A retry does not create duplicate quotes.
- The complete RFQ and quote flow runs without manual command construction.

### Phase 5: Settlement Adapter

Objective:

Connect quote acceptance to a supported Canton settlement mechanism.

Tasks:

- Inspect target environment asset availability.
- Select the first supported asset pair.
- Define the buyer asset leg.
- Define the dealer payment leg.
- Implement settlement intent creation.
- Implement required allocations or token transfers.
- Implement atomic execution.
- Implement expiry and cancellation.
- Verify ledger results.
- Store settlement references for the audit projection.

Settlement rules:

- Never report settlement success from a submitted command alone.
- Wait for the participant API transaction result.
- Treat unconfirmed or pending status as incomplete.
- Do not resend a write when the prior result is unknown without checking its status.
- Do not use production funds.

Gate criteria:

- Both legs settle successfully in the supported environment.
- Failure does not leave the trade reported as completed.
- The dashboard can distinguish pending, failed, cancelled, and settled.

Fallback:

If the target token registry is unavailable, use an explicitly labeled Canton test asset or Canton Coin path and preserve the same settlement interface.

### Phase 6: Backend Projection and API

Objective:

Expose authorized state to the UI without merging private data into public data.

Tasks:

- Create a buyer-side institutional projection.
- Create dealer-specific projections if the UI needs dealer screens.
- Create a safe public metadata projection.
- Define status schemas.
- Define error schemas.
- Add websocket or server-sent event updates if required.
- Add endpoint health checks.
- Add role-based access checks.

Projection separation:

- Institutional projection may include buyer-visible quotes.
- Dealer A projection may include only Dealer A's quote.
- Dealer B projection may include only Dealer B's quote.
- Public projection may include opaque references and status metadata only.

Gate criteria:

- No public endpoint returns private quote fields.
- The browser never receives participant credentials.
- The UI can refresh state without losing workflow status.

### Phase 7: Dashboard

Objective:

Make the real ledger workflow understandable within one judge-facing screen.

Tasks:

- Build the institutional header and trade intent panel.
- Build the RFQ lifecycle timeline.
- Build the buyer quote comparison panel.
- Build the dealer activity panel.
- Build settlement status.
- Build the audit report view.
- Build the public metadata panel.
- Build the privacy verification panel.
- Add loading and empty states.
- Add API error and rejected transaction states.
- Add responsive behavior for the recording laptop.

Visual rules:

- Dark slate and black foundation.
- Yellow for institutional controls and selected outcomes.
- Cyan for authorized private streams.
- Magenta for public metadata and boundary indicators.
- Clear labels for public metadata versus private contract data.
- No fake terminal output presented as ledger evidence.

Gate criteria:

- A reviewer can understand the product without reading source code.
- The interface displays live state from the backend.
- Privacy and settlement claims are connected to visible evidence.

### Phase 8: Security and Failure Testing

Objective:

Find demo-breaking and fund-moving defects before recording.

Tests:

- Uninvited dealer cannot submit a quote.
- Dealer cannot accept a quote.
- Buyer cannot accept an expired quote.
- Quote cannot be accepted twice.
- RFQ cannot be settled twice.
- Duplicate command IDs are safe.
- Participant reconnect does not duplicate state.
- Invalid asset identifiers are rejected.
- Invalid recipient parties are rejected.
- Amount and decimal boundaries are enforced.
- Settlement failure is visible.
- Public metadata never contains quote prices.
- Logs never contain credentials.
- External AI input excludes private payloads.

Gate criteria:

- All critical tests pass.
- Known limitations are written in the README.
- The demo uses test funds only.

### Phase 9: Submission and Demo

Objective:

Present a concise business and technical proof.

Tasks:

- Freeze the MVP scope.
- Write setup instructions.
- Write the business brief.
- Write the pilot plan.
- Create the architecture diagram.
- Create the privacy test evidence.
- Create the demo script.
- Record the five-minute walkthrough.
- Blur environment variables and credentials.
- Verify all transaction claims.
- Run the demo from a clean environment.

Demo order:

1. Explain the fund's block purchase problem.
2. Create the private RFQ.
3. Show invited dealers receiving it.
4. Submit competing quotes.
5. Prove quote isolation.
6. Select the best quote.
7. Execute and verify settlement.
8. Show the audit report and public metadata boundary.

## 6. First Build Session

The first session should be limited to environment discovery and a contract spike.

### First Session Checklist

- Confirm the working directory.
- Confirm the selected Canton tooling version.
- Confirm DPM availability.
- Confirm LocalNet startup path.
- Confirm participant API URL and authentication.
- Confirm party allocation or party IDs.
- Confirm available test assets.
- Scaffold the Daml project.
- Implement one RFQ template.
- Add one create test.
- Build the DAR.
- Record the first successful command and result.

### First Session Stop Conditions

Stop and resolve the environment before proceeding if:

- DPM is unavailable.
- LocalNet cannot start.
- Participant APIs are unreachable.
- Parties cannot be allocated or identified.
- The target asset cannot be identified.
- The Daml version does not match the available runtime.

Do not start frontend development during the first session.

## 7. Daily Operating Rhythm

At the start of each session:

- Read `PROJECT_CONTEXT.md`.
- Read the relevant section of `PRD.md`.
- Check the current files and running environment.
- Select one measurable milestone.

During implementation:

- Keep ledger and application changes small.
- Run the narrowest relevant test after each contract change.
- Record environment-specific discoveries immediately.
- Avoid adding dependencies without checking existing tooling.

At the end of each session:

- Run the relevant build or test commands.
- Record the result.
- Record files changed.
- Record any unresolved failure.
- Update the next three actions in `PROJECT_CONTEXT.md`.

## 8. Risk Register

### Risk: Daml Quote Authorization Fails

Impact: high.

Mitigation: implement and test a proposal plus buyer authorization flow before building agents.

### Risk: Target Asset Is Unavailable

Impact: high.

Mitigation: inspect assets during Phase 0 and keep a tested fallback adapter.

### Risk: Settlement Is Simulated

Impact: critical for judging credibility.

Mitigation: verify every successful state from actual participant transaction results.

### Risk: Public View Overclaims Synchronizer Visibility

Impact: high.

Mitigation: display safe application metadata and label the boundary precisely.

### Risk: AI Provider Leaks Private Data

Impact: high.

Mitigation: keep deterministic execution in the critical path and redact external model inputs.

### Risk: Multiple Participants Are Hard to Configure

Impact: medium.

Mitigation: use the simplest environment that demonstrates party-level visibility and document any operator-level limitation.

### Risk: Frontend Consumes Too Much Time

Impact: medium.

Mitigation: use a functional dashboard with deliberate visual hierarchy before adding polish.

## 9. Decision Log Template

When making an implementation decision, add an entry using this format.

```text
Date:
Decision:
Options considered:
Reason:
Tradeoff:
Validation:
Follow-up:
```

Important decisions must also be copied into `PROJECT_CONTEXT.md`.

## 10. Immediate Next Three Actions

1. Confirm Canton tooling, LocalNet, participant APIs, and available assets.
2. Scaffold the Daml package and implement the first RFQ authorization test.
3. Run the first real RFQ transaction and verify participant visibility.
