# ShadowDesk - One-Page Business Brief

## What it is

ShadowDesk is policy-bound execution for treasury agents on the Canton Network.
A buyer and a risk officer approve a treasury mandate on the ledger.
An agent then sources prices from approved dealers through sealed quotes, and the winning trade settles as atomic delivery-versus-payment.
The mandate's limits are checked by the Daml contracts, not by the agent.
Every RFQ is co-signed by a risk officer who must be a different party from the buyer, so the agent cannot open an RFQ outside a mandate.

## The problem

Treasury teams want to hand routine rebalancing to software agents without giving those agents unlimited discretion.

- An agent that holds the trading authority can, through a bug or misuse, trade more, at a worse price, or with a counterparty nobody approved.
- Today the limits live in the agent's own code or in operations runbooks, so the party being limited is also the party enforcing the limit.
- Price discovery for a block also leaks intent: on a public chain, order size, counterparties and price are visible to everyone.

## How ShadowDesk addresses it

1. The buyer and a separate risk officer sign a `TreasuryMandate` that fixes the approved dealers, the asset, the settlement asset, the maximum amount, the maximum price and the expiry.
2. The agent opens a `BlockTradeRFQ` from the approved mandate through `OpenRfq`, the only way to create one, which refuses any request above the amount, maximum price or expiry, or one that invites an unapproved dealer.
3. Each dealer submits a `QuoteProposal` that only that dealer and the buyer can see.
4. The award follows a fixed rule, `LowestPriceThenBidId`, and sealing consumes the RFQ, so a request is awarded at most once.
5. `Deal.Settle` checks the award against the mandate again and settles both legs atomically.
6. A `SettlementReceipt` links the mandate, the RFQ, the sealed quote and the winning bid for audit.

## Where it is proven

| Environment | What runs there |
| --- | --- |
| LocalNet, two participants, synthetic assets | The full round, every rejection path, and the check that a losing dealer on a separate participant sees none of the winner's quotes |
| Canton DevNet, one participant, fauceted CBTC and BETH | Atomic settlement: `Deal.Settle` and both Token Standard registry legs in one `submitMany` transaction |

No single run proves cross-participant privacy and real-token settlement together.
The full claims list, with evidence and limits, is in [CLAIMS.md](CLAIMS.md).

## Why Canton

- Contract visibility is decided by Daml stakeholders, so a competing dealer's node never receives another dealer's quote.
- Several parties' actions and both settlement legs commit in one transaction, which is what delivery-versus-payment needs.
- The Canton Token Standard lets the settlement legs move registry-issued assets inside the same transaction as the receipt.

## Business value

| Pain today | ShadowDesk outcome |
| --- | --- |
| Agent limits live in the agent | Limits signed by risk and checked by the ledger on every RFQ and settlement |
| Dealers can infer each other's prices | Each quote visible only to its dealer and the buyer |
| Settlement risk between separate systems | Both legs and the receipt in one transaction |
| Award decisions are hard to audit | The rule, the winning bid and the mandate link are recorded on the ledger |

## Where we are today

A hackathon-built proof of concept: Daml contracts with an eleven-scenario suite, buyer and dealer agents, a dashboard, a one-command LocalNet reproduction, and DevNet settlement against fauceted test tokens.
There are no users, customers or pilots yet.
Known limits are listed in [CLAIMS.md](CLAIMS.md).

## Next steps

- Upload the mandated package to DevNet and run a round on it (see [DEVNET-UPGRADE.md](DEVNET-UPGRADE.md)).
- Talk to treasury and risk operators to find the first niche where agent execution under a mandate matters most.
- Run one DevNet round across two participants so privacy and real-token settlement are proven together.
- Publish DevNet transaction evidence in the repository.
- Enforce cumulative mandate spend across RFQs and make the award rule an on-ledger guarantee.
