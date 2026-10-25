# ShadowDesk positioning: treasury execution for Canton node operators

This is the working position for ShadowDesk after the HackCanton Season 3 review.
It is a hypothesis to test in conversations, not a validated market.
Claims about what runs today follow [CLAIMS.md](CLAIMS.md).

## Why change

The Season 3 review said a private RFQ is one of the most repeated ideas in the program, and asked for a specific niche where ShadowDesk is clearly different.
ShadowDesk's difference is not the RFQ.
It is that a risk-approved mandate, enforced by the ledger, bounds what a trading agent can do.
That matters most to a buyer who wants to automate trading but cannot let the automation run unchecked.

## Who it is for

Canton node operators and Canton app teams: validators, super validators and application providers.

The working assumptions, to be tested in interviews:

- They earn revenue in Canton Coin (CC), through validator and application rewards.
- Many of their costs, such as hosting, staff and services, are in dollars.
- So they regularly convert CC into dollar stablecoins, today by hand or through whoever answers first.
- Whoever runs that conversion is trusted with the treasury keys and has no hard limit on size or price.

## The job

"Convert part of our CC income into dollar stablecoins on a schedule, at a fair price, without one person or one bot being able to sell more, cheaper, or to someone we did not approve."

## What ShadowDesk gives them

1. The treasury owner and a second approver sign a mandate on the ledger: which OTC desks may quote, how much may be sold per request, the worst acceptable price, and when the mandate expires.
2. An agent opens each conversion as a sealed request to the approved desks. Each desk sees only its own quote.
3. The best quote wins by a fixed rule recorded on the ledger.
4. The coins and the stablecoins move in one transaction, or not at all.
5. The agent cannot open a request outside the mandate, because every request needs the second approver's signature, which only the mandate carries.

## What runs today and what does not

| Piece | Status |
| --- | --- |
| Mandate signed by two distinct parties, enforced on every request and at settlement | Runs on DevNet (package `shadowdesk-treasury-mandated` 1.0.0) |
| Sealed quotes, fixed award rule, atomic settlement of both legs | Runs on DevNet with CBTC and BETH test tokens |
| CC as the sold asset | Not yet: needs a Canton Coin (Amulet) allocation leg |
| USDCx as the received asset | Not yet: needs a DevNet USDCx registry or another dollar token |
| Recurring conversions on a schedule | Not yet |
| A cap on total sales across requests | Not yet: today the cap applies to each request |
| Real OTC desks quoting | None yet |

## Why Canton

- The desks' quotes stay private between each desk and the operator, which matters to desks that do not want rivals to see their prices.
- The mandate, the award and both settlement legs live in one ledger, so the limit is checked where the money moves, not in a separate system.
- Node operators already run Canton infrastructure and hold Canton parties, so there is no new chain or wallet to adopt.

## What we need to learn

1. Do node operators actually convert CC to dollars regularly, and how much and how often?
2. Who does it today, and who is allowed to?
3. Has a conversion ever gone wrong: wrong size, bad price, wrong counterparty, a compromised key?
4. Would a second approver and a ledger-enforced limit change how much they automate?
5. Which OTC desks or market makers would quote, and would they want their quotes private?

If the answers say operators do not convert regularly, or do not care who can sell, this niche is wrong and the next candidate is crypto fund and DAO treasuries.

## Next build steps if the interviews confirm it

1. A CC allocation leg, so the sold asset is real Canton Coin.
2. A dollar-token leg, USDCx when it is available on DevNet.
3. A cumulative cap and a monthly budget on the mandate.
4. Scheduled conversions run by the agent within the budget.
