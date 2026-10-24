# ShadowDesk - Pilot Plan

This is a proposed plan.
No pilot partner has agreed to it yet.

## Objective

Run ShadowDesk with one buying institution, its risk officer and two liquidity providers for a bounded, low-notional pilot of mandate-bound treasury execution on Canton DevNet.
Every policy, privacy and settlement claim in the pilot must be backed by ledger evidence, as listed in [CLAIMS.md](CLAIMS.md).

## Starting point

What exists today, from the hackathon build:

- Daml contracts for the mandate, the RFQ, sealed quotes, the award and atomic settlement, with a ten-scenario suite.
- Buyer and dealer agents, and a dashboard with buyer and public views.
- A one-command LocalNet reproduction across two participants with synthetic assets.
- DevNet settlement against fauceted CBTC and BETH through the Canton Token Standard (CIP-0056) registry, on one participant.

What the pilot has to add:

- Hosting the buyer and each dealer on their own participants on DevNet, so privacy and real-token settlement are proven in the same run.
- Cumulative mandate spend across RFQs, so a mandate bounds total trading, not only each request.
- A third dealer and an auditor view.

## Scope

In scope:

- Buyer and risk-officer approval of an on-ledger treasury mandate.
- A private RFQ with up to three dealers approved by the mandate.
- Mandate enforcement for asset, amount, maximum price, approved dealers and expiry.
- Sealed quotes and a deterministic award within the mandate's maximum price.
- Atomic delivery-versus-payment against Canton Token Standard assets.
- A buyer view, a metadata-only public view and an auditor view.
- A per-round check that a losing dealer sees none of the winner's quotes.

Out of scope:

- Market-making algorithms and credit lines.
- RFQ amendment and cancellation negotiation.
- More than three dealers.
- Latency guarantees under adversarial network conditions.

## Participants and roles

| Role | Party | Participant in the pilot |
| --- | --- | --- |
| Buying institution | `buyer` | The institution's own participant |
| Risk officer | `riskOfficer` | The institution's own participant |
| Liquidity provider A | `dealerA` | Dealer A's participant |
| Liquidity provider B | `dealerB` | Dealer B's participant |
| Auditor (optional) | `auditor` | Read-only view |

Today's DevNet run hosts all parties on one participant.
Separate participants are the first pilot deliverable.

## Success criteria

| Metric | Target | How measured |
| --- | --- | --- |
| Rounds settled | 20 of 20 | Receipts created equal RFQs settled |
| Privacy check | Passes in 20 of 20 rounds | Losing-dealer view of the winner's quotes is empty, on separate participants |
| Duplicate quote events | 0 over 20 rounds | Contract count reconciliation per round |
| RFQ-to-settlement time | Measured and reported | Timestamps on the ledger |
| Clean reproduction | One command, documented time | `./scripts/localnet/run-all.sh` |
| Claims in materials | Every claim traceable | Review against [CLAIMS.md](CLAIMS.md) |

## Plan

- Weeks 1 and 2: interviews with the pilot partner's treasury and risk staff to fix the mandate fields and limits they need.
- Weeks 3 and 4: separate participants on DevNet, cumulative mandate spend, the auditor view, and a 20-round run with published evidence.
- Week 5: review with the partner and a written report of what held and what did not.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| DevNet package uploads need operator credentials | Upload through the participant operator's console before the pilot starts |
| Separate participants per dealer are not available on DevNet | Use the operator's tenant participants, or run the privacy part on LocalNet and state that plainly |
| "Secrecy" over-interpreted | Materials state that visibility is per participant and per party, and the per-round check demonstrates it |
| Environment drift breaks the demo | The clean-checkout reproduction is part of the evidence |
