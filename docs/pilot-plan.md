# ShadowDesk - Pilot Plan

## Objective

Run ShadowDesk with one buying institution and two liquidity providers for a bounded, low-notional pilot of private block trading of tokenized short-term government securities on the Canton DevNet, with all confidentiality and settlement claims evidenced end-to-end.

## Scope

In scope:

- Private RFQ with up to three invited dealers.
- Blind quote collection, deterministic winner selection within the buyer's max-price limit.
- Atomic DvP settlement on a Canton asset standard (NameService / CIP-025-style registry once available on DevNet).
- Institutional (buyer) projection plus a public metadata-only projection and an auditor view.
- Privacy evidence: per-round assertion that a losing dealer observes zero competitor quotes, surfaced in the dashboard.

Out of scope for the pilot:

- Market-making algorithms and credit lines.
- RFQ amendment/cancellation negotiation.
- More than three dealers.
- Latency guarantees under adversarial network conditions.

## Participants and roles

| Role | Party in system | Canton participant |
| --- | --- | --- |
| Buying institution (pilot lead) | `buyer` | participant1 (run by the institution) |
| Liquidity provider A | `dealerA` | participant1 (pilot environment) |
| Liquidity provider B | `dealerB` | participant2 (pilot environment) |
| Pilot operator | dashboard + monitor access | operator participant |
| Auditor (optional) | granted visibility party | read-only projection |

In the hackathon demo the winner is co-hosted on participant1 because the Daml script runner rejects cross-participant `actAs`; a driver-runner change or operator relay removes that constraint for the pilot (see Risks).

## Success criteria and metrics

Primary: a judge- and operator-visible, end-to-end private RFQ that settles atomically on Canton.

| Metric | Target | How measured |
| --- | --- | --- |
| RFQ-to-acceptance time | < 30s at one round | timestamps in `SettlementReceipt` + dashboard |
| Quote events processed without duplication | 0 duplicates over 20 rounds | contract count reconciliation per round |
| Privacy test pass rate | 100% over 20 rounds | losing-dealer zero-visibility assertion per round |
| Successful settlement rate | 100% over 20 rounds | receipts created == RFQs settled |
| Reproduce demo from clean environment | < 5 minutes, one command | `./scripts/localnet/run-all.sh` |
| No unsupported claims in materials | pass | claims list reviewed against live evidence |

## Week-by-week plan

- Week 1 (done): contract templates, two-participant sandbox, buyer/dealer agents, deterministic selection, atomic DvP, dashboard, clean-environment bootstrap. All proven live and committed.
- Week 2: DevNet integration - deploy to the target DevNet environment, integrate the asset standard (NameService/CIP-025), add a third dealer, add an auditor view, and run 20-round soak with per-round evidence.
- Week 3: stability pass, latency measurements, privacy/security review, final recording, and submission materials.

## Evidence and audit

Each pilot round writes a `SettlementReceipt` and the dashboard maintains a public metadata projection (timeline of RFQ/quote/seal/settle events without payloads). The privacy probe runs per round and is displayed as a live banner. The demo close uses the five-minute script in `docs/demo-script.md`.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| DevNet asset standard not available yet | In-ledger demo assets today (clearly labeled); swap to registry-backed asset at DevNet integration, keeping the `Deal`/`Settle` logic unchanged |
| Cross-participant `actAs` limit in script runner | Co-host winning dealer on participant1 for the demo; use a driver with multi-party submission for the pilot |
| Claim of "secrecy" over-interpreted | Materials state payload visibility is at the synchronizer/participant level, and the live probe demonstrates it |
| Demo breakage from environment drift | `run-all.sh` clean-checkout reproduction is part of the evidence |