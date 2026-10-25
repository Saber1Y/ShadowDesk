# ShadowDesk claims register

This file is the single source of truth for what ShadowDesk claims and where each claim is proven.
The README, the deck, the video, grant applications and submission forms must use these claims and this wording, and nothing stronger.
When a claim changes, change it here first, then everywhere else.

Last reviewed: 2026-10-25.

## The environments

ShadowDesk runs in two environments, and each proves different things.

| Environment | Topology | Assets | What it proves |
| --- | --- | --- | --- |
| LocalNet | Two participants on one synchronizer | Synthetic assets | Cross-participant privacy, the full round, every rejection path |
| Canton DevNet (HackCanton-01) | One participant hosting all four parties | Fauceted CBTC and BETH test tokens through the Canton Token Standard registry | Atomic settlement against real registry tokens |

No single run proves both at once.
Cross-participant privacy is proven on LocalNet only.
Real-token settlement is proven on DevNet only.

## Product claims

| # | Claim (approved wording) | Where proven | Evidence |
| --- | --- | --- | --- |
| 1 | A treasury mandate, signed by the buyer and a risk officer, fixes the approved dealers, asset, settlement asset, maximum amount, maximum price and expiry. | Scenario suite, LocalNet, DevNet | `TreasuryMandate` in `daml/src/ShadowDesk/Rfq.daml`; `runMandatePolicyLifecycle` |
| 2 | The buyer party cannot open an RFQ outside an approved mandate: every RFQ is co-signed by a risk officer who must be a different party, so `OpenRfq` is the only way to create one, and it refuses anything above the mandate's amount, maximum price or expiry, or to an unapproved dealer. | Scenario suite; the package enforcing it runs on DevNet (rounds of 2026-10-25) | `BlockTradeRFQ` and `OpenRfq` in `daml/src/ShadowDesk/Rfq.daml`; `runAgentCannotBypassMandate`; `runMaxPriceCannotBeOverridden` |
| 3 | Every award names its mandate, and settlement checks the mandate again (buyer, approved dealer, amount, price and assets), so even an award the buyer and a dealer sign between themselves cannot settle outside it. | Scenario suite | `Deal.Settle` in `daml/src/ShadowDesk/Settlement.daml` |
| 4 | A competing dealer never sees another dealer's quote; each quote is held by its dealer and the buyer, and the buyer's risk officer, who co-signs the RFQ, also witnesses it. | Scenario suite, LocalNet (across two participants) | `QuoteProposal` stakeholders; `runMultiParticipantPrivacyAndSettlement`; `npm run e2e:real-flow` |
| 5 | The award follows a fixed rule (`LowestPriceThenBidId`), and sealing consumes the RFQ, so a request is awarded at most once. | Scenario suite, LocalNet, DevNet | `runRfqIsAwardedAtMostOnce`; `npm run e2e:award-chain` |
| 6 | The deal must match the sealed award in price, quantity and assets. | Scenario suite | `runDealMustMatchAward` |
| 7 | On DevNet, `Deal.Settle` and both registry `Allocation_ExecuteTransfer` legs commit in one `submitMany` transaction, so the receipt exists only if both legs moved. | DevNet, on the mandated package, 2026-10-25 (update ids `12203360…4f3c19c6` and `1220c98a…419126f`) | [devnet-2026-10-25-mandated.json](evidence/devnet-2026-10-25-mandated.json); `npm run e2e:real-flow` |
| 8 | Sign-in to the live dashboard goes through the HackCanton participant's OIDC login. | DevNet | `frontend/app/api/auth` |

## Limits we state plainly

| Limit | Wording to use |
| --- | --- |
| Privacy on DevNet | "Cross-participant privacy is proven on LocalNet. The DevNet run hosts all parties on one participant, so it does not test that boundary." |
| Best execution | "The award rule is recorded on the ledger and re-checked by the runner. The ledger does not stop a buyer from sealing a worse bid." |
| Mandate on DevNet | "The mandated package runs on DevNet and two rounds settled through it on 2026-10-25. The bypass attempts themselves are refused in the scenario suite; they were not replayed on DevNet. The live dashboard's Run round still uses the earlier package until the worker on the VPS is updated." The earlier package let the buyer settle 5,000,000 at 149.0 against a mandate of 1,000,000 at 101.0, reproduced on 2026-10-24. |
| Mandate spend | "The cap applies to each RFQ. Cumulative spend across RFQs is not enforced yet." |
| V2 registry receipt | "Validated on LocalNet only. DevNet package uploads need operator credentials, so DevNet settles through the V1 path." |
| Assets | "DevNet uses fauceted test tokens with no value. LocalNet uses synthetic assets. No real money moves." |
| Public evidence | "DevNet update ids are published in docs/evidence. The participant has no public explorer, so they are as the participant returned them." |
| Live dashboard access | "The live dashboard needs a HackCanton participant login to show ledger data." |

## Traction

| Measure | Status |
| --- | --- |
| Independent users | 0 |
| User or customer conversations | 0 documented |
| Rounds run by the team | LocalNet rounds and DevNet rounds, all run by the team |
| Pilots or letters of intent | None |

Update this table only with events that happened and can be named.

## Do not say

- "Live on Canton DevNet" without the qualifier from the environments table.
- "Privacy proven on DevNet" or "privacy proven on the live network".
- "Every round runs across two participants".
- "Production-ready", "audited" or "institutional-grade".
- Any user, customer or pilot count above the traction table.
- "Every Run round on the live dashboard is mandate-enforced", until the worker on the VPS runs the updated agents.

## Approved one-liners

- Short: "ShadowDesk is policy-bound execution for treasury agents on Canton: an agent cannot trade past what risk approved."
- Niche: "Treasury execution for Canton node operators, with limits the agent cannot break." Say the CC-to-dollar trade is the target, not something that runs today.
- Environment line: "Settlement against real Token Standard assets runs on Canton DevNet; cross-participant privacy is proven on LocalNet."
