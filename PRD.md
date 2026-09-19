# ShadowDesk Product Requirements Document

## Document Status

- Product: ShadowDesk
- Version: 1.0
- Status: MVP definition
- Last updated: 2026-09-18
- Target program: HackCanton Season 3
- Target network: Canton Network DevNet, with LocalNet as the primary development environment

## 1. Product Summary

ShadowDesk is a private request-for-quote venue for institutional block trades.

It allows a buyer agent to invite a controlled set of dealer agents, receive private quotes, select the best quote, and settle the trade through Canton.

The product demonstrates that trade intent, dealer quotes, counterparty relationships, and settlement details can remain visible only to authorized Canton parties.

The MVP is not a production trading venue.

The MVP is a working proof that combines Canton privacy, agent-driven negotiation, and real ledger settlement in one end-to-end workflow.

## 2. Problem

Institutional block trades require counterparties to share commercially sensitive information.

Public blockchains expose order sizes, wallet relationships, execution prices, and transaction timing to observers.

This creates strategic information leakage, front-running risk, and operational concerns for regulated institutions.

Existing RFQ demonstrations often protect data only in the application layer.

ShadowDesk moves the confidentiality boundary into Daml contract stakeholders and Canton participant privacy.

## 2.1 Real-World Use Case: Tokenized Treasury Block Purchase

An institutional fund wants to purchase a large position in tokenized short-term government securities.

The fund does not want the market to learn that it is accumulating the position because that information could affect prices, reveal portfolio strategy, or cause counterparties to widen their spreads.

The fund manager enters a purchase intent into ShadowDesk.

The intent specifies the asset, target amount, maximum acceptable price, settlement asset, eligible dealers, and expiration time.

The buyer agent sends a private RFQ to three approved market-making dealers.

Each dealer sees that it has been invited and sees the terms needed to price the request.

No dealer sees another dealer's quote.

Each dealer's agent checks inventory, funding cost, risk limits, and current market conditions before submitting a sealed quote.

The buyer agent waits for the configured response window, removes quotes that violate the fund's limits, and selects the best executable quote.

The selected quote triggers delivery-versus-payment settlement.

The fund receives the tokenized securities while the dealer receives the settlement asset in the same Canton transaction workflow.

The fund manager receives a private execution report.

The wider network sees no public order book containing the fund's amount, dealer identities, or competing prices.

This is useful for tokenized bonds, commercial paper, private credit positions, fund units, stablecoin treasury operations, and other assets where liquidity providers need to quote privately.

The hackathon demo will use small test amounts and available Canton test assets, but the business workflow represents a much larger institutional trade.

## 3. Target Users

### 3.1 Institutional Fund Manager

The fund manager defines the trade intent.

The fund manager specifies the target asset, trade amount, maximum acceptable price or slippage, invited dealers, and RFQ expiry.

The fund manager reviews the selected quote, settlement result, and audit history.

### 3.2 Buyer Agent

The buyer agent creates the RFQ on behalf of the fund.

The buyer agent monitors private ledger events.

The buyer agent evaluates eligible quotes against the fund manager's constraints.

The buyer agent accepts the optimal quote after the configured quote window closes or an acceptable quote arrives.

### 3.3 Dealer Agent

A dealer agent receives RFQs only when its party is invited and hosted on a participant that is entitled to see the RFQ.

The dealer agent evaluates inventory, risk, and pricing rules.

The dealer agent submits a quote without exposing that quote to competing dealers.

### 3.4 Auditor or Demo Observer

An auditor may receive explicitly granted audit visibility.

The public demo view is not an auditor view.

The public demo view displays only intentionally published metadata and must not imply access to private contract payloads.

## 4. MVP Goal

Demonstrate one complete private RFQ lifecycle using real Canton ledger transactions.

The required flow is:

1. A fund manager creates a trade intent.
2. The buyer agent creates an RFQ for two invited dealers.
3. Two dealer agents independently receive the RFQ.
4. Each dealer submits a quote.
5. Dealer A cannot query Dealer B's quote.
6. The buyer agent compares the quotes against the trade constraints.
7. The buyer accepts one quote.
8. The selected trade settles atomically using an available Canton asset mechanism.
9. The institutional dashboard shows the private workflow and audit history.
10. The public dashboard shows only non-sensitive synchronizer or application metadata.

## 5. MVP Non-Goals

The following items are explicitly out of scope for the first submission.

- Production-grade market making.
- Mainnet deployment.
- Real institutional custody integration.
- Arbitrary cross-chain settlement.
- Guaranteed support for CBTC or cETH before their availability is verified.
- A public order book.
- Anonymous dealer discovery.
- LLM-controlled fund transfers without deterministic policy checks.
- A general-purpose matching engine.
- Regulatory certification.
- Production security audit.
- Direct plaintext access to Global Synchronizer data.

## 6. Product Principles

### 6.1 Privacy Must Be Protocol-Enforced

Sensitive workflow data must be protected through Daml signatories, observers, controllers, and Canton participant visibility.

The frontend must not be the only privacy boundary.

### 6.2 Real Ledger Activity Over Simulation

The demo must create contracts, exercise choices, and settle assets on Canton LocalNet or the target DevNet.

Any simulated data must be labeled as simulated and must not be used to claim successful settlement.

### 6.3 Deterministic Execution Policy

Agent execution decisions must be bounded by explicit rules.

An optional LLM may produce explanations or recommendations, but a deterministic policy layer must approve all quote acceptance and asset movement.

### 6.4 Narrow Demo, Extensible Architecture

The MVP should implement one trade path cleanly.

The contract and service boundaries should allow additional asset types, dealers, pricing strategies, and settlement adapters later.

## 7. Functional Requirements

### FR-1: Create Trade Intent

The institutional user must be able to define:

- Target asset.
- Settlement asset.
- Amount.
- Maximum acceptable price or slippage.
- Invited dealer parties.
- Quote deadline.
- Optional minimum dealer count.

The application must validate positive amounts, valid parties, a future deadline, and supported assets.

### FR-2: Create RFQ

The buyer agent must create a `BlockTradeRFQ` contract.

The buyer must be a signatory.

Invited dealers must be observers of the RFQ when they need to receive the invitation.

The RFQ must include a unique application reference and expiry data sufficient to prevent stale execution.

The RFQ must not include unnecessary personally identifiable information.

### FR-3: Dealer Event Subscription

Each dealer agent must subscribe to its participant's ledger updates.

The agent must filter for RFQ contracts visible to its party.

The agent must ignore RFQs where it is not an invited dealer.

The agent must reconnect after a temporary API or network failure.

The agent must use idempotent command identifiers when submitting quotes.

### FR-4: Generate Quote

The dealer agent must calculate a quote from deterministic inputs.

The initial strategy may use configured inventory, risk limits, reference price, spread, and volatility adjustment.

The strategy must reject quotes outside configured risk limits.

The quote must include an expiry or be linked to the RFQ expiry.

The quote must not expose dealer-only inventory details to competing dealers.

### FR-5: Isolate Quotes

A competing dealer must not be a signatory or observer on another dealer's sealed quote.

The quote design must ensure that only the buyer and submitting dealer receive the quote contract and its subsequent events.

The exact creation flow must be validated with Daml authorization tests.

If a dealer-only choice cannot authorize a quote signed by both buyer and dealer, the implementation must use a two-step proposal and buyer authorization flow.

### FR-6: Evaluate Quotes

The buyer agent must collect visible quotes until the quote deadline or an explicitly configured early-accept condition.

The evaluation must reject expired, malformed, duplicated, and constraint-violating quotes.

The evaluation must rank eligible quotes according to an explicit policy.

The initial policy should prioritize acceptable execution price, then quote freshness, then dealer preference if configured.

The dashboard must show the decision inputs and result without exposing quotes to unauthorized parties.

### FR-7: Accept Quote

Only the buyer must be able to accept a quote.

Acceptance must consume or invalidate the selected quote so it cannot be accepted again.

Acceptance must prevent conflicting quotes from settling for the same RFQ.

Acceptance must reject expired RFQs and expired quotes.

Acceptance must create or activate the settlement workflow.

### FR-8: Atomic Settlement

The selected trade must settle both asset legs atomically where the selected Canton asset mechanism supports this.

The implementation must prefer Canton token standards and allocation-based delivery-versus-payment patterns over custom asset movement logic.

The system must verify asset availability before attempting settlement.

The system must expose settlement success or failure from actual ledger transaction results.

The system must provide a cancellation or recovery path for an expired or unfulfilled settlement intent.

### FR-9: Institutional Dashboard

The institutional view must display:

- Active trade intent.
- RFQ lifecycle state.
- Invited dealers.
- Visible quote stream for the buyer.
- Quote comparison result.
- Settlement state.
- Ledger event history.
- Privacy verification results.

The institutional view must obtain state from a backend connected to the buyer participant.

The institutional view must distinguish pending, accepted, settled, expired, cancelled, and failed states.

### FR-10: Public Metadata View

The public view must display only safe metadata.

Safe metadata may include event sequence, timestamps, opaque identifiers, status transitions, and encrypted-payload indicators.

The public view must not display order amount, quote price, dealer identity, or private contract payload unless that information is intentionally published.

The UI must label this view as public metadata rather than a plaintext view of the Global Synchronizer.

### FR-11: Audit Report

The system must produce a human-readable report for the completed trade.

The report must include RFQ reference, timestamps, selected quote reference, settlement result, visible parties, and ledger transaction references available to the buyer.

The report must not include data that the report viewer is not authorized to see.

## 8. Proposed Daml Model

The initial model should contain the following conceptual templates.

### 8.1 `BlockTradeRFQ`

Fields should include buyer, invited dealers, target asset, settlement asset, amount, constraints, reference, and expiry.

The buyer should be the signatory.

Invited dealers should be observers when they need to receive the RFQ.

The contract should expose only choices required for the RFQ lifecycle.

### 8.2 `QuoteProposal`

This template is an optional intermediate contract.

It should be used if a dealer cannot directly create a quote requiring buyer and dealer authorization.

The dealer should sign the proposal.

The buyer should receive the proposal as an observer or authorized stakeholder according to the chosen flow.

The buyer should authorize conversion of the proposal into a jointly signed sealed quote.

### 8.3 `SealedQuote`

The buyer and submitting dealer should be the signatories.

Competing dealers must not be observers.

The quote should include the RFQ reference, offered price, amount, expiry, dealer reference, and any settlement terms required by the asset adapter.

The quote should not contain unnecessary dealer inventory information.

### 8.4 `SettlementIntent`

This template should represent the selected trade and the required settlement legs.

It should bind the selected quote to the buyer, dealer, asset identifiers, amounts, and deadlines.

It should prevent settlement against a different quote or RFQ.

### 8.5 `SettledTrade`

This template should record the completed trade and references to the settlement result.

It should only be created after the relevant asset movement has been authorized by the selected settlement mechanism.

The exact implementation must follow the supported Canton token and DvP APIs available on the target environment.

## 9. Agent Requirements

### 9.1 Buyer Agent

The buyer agent must subscribe to RFQ and quote events.

The buyer agent must maintain a local projection of only the buyer's authorized contracts.

The buyer agent must enforce maximum price, slippage, amount, expiry, and dealer constraints.

The buyer agent must never accept a quote based only on unvalidated model output.

The buyer agent must record the reason for its selection.

### 9.2 Dealer Agent

The dealer agent must subscribe only to its participant's authorized updates.

The dealer agent must calculate quotes from configurable strategy parameters.

The dealer agent must not query or infer competing dealer quote payloads from the ledger.

The dealer agent must respect inventory and notional limits.

The dealer agent must submit at most one active quote per RFQ unless amendments are explicitly supported.

### 9.3 AI Boundary

The initial production path should not depend on an external LLM.

An LLM may be used to generate a plain-language rationale, classify market context, or suggest a quote.

All suggestions must pass deterministic validation before a ledger command is submitted.

No secret RFQ payload, private quote, private key, or credential may be sent to an external model provider.

## 10. API and Integration Requirements

The backend may use the Canton gRPC Ledger API for native streaming.

The backend may use the Canton JSON Ledger API for simpler development and frontend integration.

The implementation choice must be recorded in `PROJECT_CONTEXT.md` after the first working integration.

Authentication must use the configured Canton participant authentication mechanism.

Command IDs must be deterministic or persisted so retries do not duplicate ledger actions.

The backend must separate participant credentials by role.

Frontend clients must not receive participant private credentials.

## 11. UI Requirements

The visual direction is dark, technical, and institutional.

The interface should use a dark slate and black foundation.

Yellow should identify active institutional controls and important decision states.

Neon cyan should identify private buyer or dealer data streams.

Magenta should identify public metadata or cross-boundary events.

The interface should use geometric typography, clear spacing, strong alignment, and restrained animation.

The UI must work on a laptop-sized viewport used during judging.

The UI must remain usable on narrower screens for reviewers and recording.

The UI must include loading, empty, error, rejected transaction, expired quote, and successful settlement states.

## 12. Demo Acceptance Scenario

The five-minute demo should follow this sequence.

1. Introduce an institutional fund that needs a block trade without revealing strategy.
2. Create an RFQ for two named demo dealer parties.
3. Show the buyer participant receiving the RFQ.
4. Show Dealer A and Dealer B independently calculating quotes.
5. Show the buyer receiving both quotes.
6. Show that Dealer A's participant cannot query Dealer B's quote.
7. Accept the best quote through the buyer agent.
8. Execute the real Canton settlement.
9. Show the institutional audit report.
10. Show that the public view contains metadata but not private payloads.
11. Explain why the privacy guarantee comes from Canton stakeholders and participant views rather than frontend obfuscation.

## 12.1 Recommended Five-Minute Storyboard

### 0:00-0:40: The Institutional Problem

Show the institutional dashboard with the fund manager's objective.

Say that the fund needs to buy a block of tokenized government securities, but publishing the order would reveal its investment strategy and invite adverse pricing.

State that the goal is not to hide that a settlement occurred from authorized parties.

State that the goal is to reveal only the information each participant needs to perform its role.

### 0:40-1:20: Create the Private RFQ

Enter the target asset, amount, maximum price, settlement asset, and RFQ expiry.

Select three approved dealer parties.

Create the RFQ and show the resulting Canton contract reference.

Explain that the buyer is the signatory and invited dealers are authorized observers of the RFQ.

Switch to the public view and show only safe metadata for the event.

### 1:20-2:20: Dealers Price Independently

Show Dealer A and Dealer B receiving the RFQ in their separate views.

Show each agent's inventory and pricing decision without exposing it to the other dealer.

Submit two quotes with intentionally different prices.

Show the buyer view receiving both quotes.

Attempt to query Dealer B's quote from Dealer A's participant and show the authorization failure or empty result.

Explain that this is the core proof that the privacy boundary is enforced by Canton contract stakeholders rather than by hiding a shared database field.

### 2:20-3:15: Buyer Selection

Show the buyer agent filtering quotes against the fund's maximum price, amount, expiry, and dealer rules.

Show the selected quote and the deterministic reason for selection.

Accept the quote from the buyer role.

Show that a dealer cannot accept its own quote and that a second acceptance is rejected.

### 3:15-4:10: Atomic Settlement

Show the settlement intent and the two settlement legs.

Execute the supported Canton asset transfer or allocation-based delivery-versus-payment flow.

Show the real transaction result from the participant API.

Show the completed trade in the institutional dashboard.

Explain that the application does not mark the trade as settled until the ledger result confirms it.

### 4:10-5:00: Business Value and Close

Show the final audit report.

Summarize that the fund got competitive dealer pricing without broadcasting its strategy.

Summarize that dealers got controlled access to real institutional flow without seeing competing quotes.

Summarize that Canton provided selective visibility and atomic settlement as protocol capabilities.

Close by describing ShadowDesk as an execution layer for private tokenized-asset markets, not as a generic chatbot or public exchange.

## 13. Acceptance Criteria

The MVP is acceptable for submission when all of the following are true.

- The project builds from a clean checkout.
- The Daml package compiles successfully.
- Daml authorization tests pass.
- A LocalNet or DevNet environment can host the package.
- The buyer can create an RFQ through the application.
- Two dealers can receive the RFQ through authorized participant views.
- Two dealers can submit quotes.
- One dealer cannot query the other dealer's quote payload.
- The buyer can evaluate and accept one quote.
- The selected settlement produces a real Canton transaction.
- The settlement result is visible in the institutional dashboard.
- The public dashboard does not expose private payloads.
- Failed, expired, and duplicate actions are rejected safely.
- The demo does not rely on hardcoded successful transaction output.
- The repository contains setup instructions, architecture documentation, a business brief, and a pilot plan.

## 14. Security Requirements

This MVP must receive a focused security review before demo recording.

The review must cover signatories, observers, controllers, choice replay, quote expiry, duplicate commands, asset authorization, settlement failure, credential separation, and external model data leakage.

The system must not use production funds.

The system must not expose private keys, seed phrases, API keys, or participant credentials in the repository or demo recording.

The security review is not a production audit and must not be represented as one.

## 15. Submission Materials

The repository should contain:

- `README.md` with setup and demo instructions.
- `PRD.md` with product requirements.
- `PROJECT_CONTEXT.md` with decisions and current status.
- Daml source and tests.
- Agent service source and tests.
- Frontend source and tests.
- LocalNet or DevNet deployment instructions.
- Architecture diagram.
- One-page business brief.
- Pilot plan.
- Demo recording.

## 16. Success Metrics

The primary success metric is a judge-visible, end-to-end private RFQ that settles on Canton.

Secondary metrics are:

- Time from RFQ creation to quote acceptance.
- Number of quote events processed without duplication.
- Successful privacy test rate.
- Successful settlement rate.
- Time required to reproduce the demo from a clean environment.

## 17. Future Extensions

Possible post-MVP extensions include:

- More than two dealers.
- Dealer reputation and permissions.
- Multi-round negotiation.
- RFQ amendment and cancellation workflows.
- Institutional policy approval.
- Compliance and audit parties.
- CIP-56 asset adapters for multiple registries.
- External signing workflows.
- Agent permissioning and spending caps.
- Production participant deployment.
- Integration with custody and portfolio systems.
