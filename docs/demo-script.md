# ShadowDesk - Five-Minute Demo Script

Setup before recording: run `./scripts/localnet/run-all.sh` from a clean environment so the demo starts from a fresh two-participant ledger with one completed round. Have the dashboard open at `http://localhost:3001`.

## 1. The problem (0:40)

> "Hedge funds can't buy a block of tokenized T-bills without moving the market. Their size is a signal - it reveals strategy and invites front-running."

- Point at the hero: "A fund places a block. Two dealers price it blind."
- Explain: public blockchains expose who buys, how much, and at what price. Institutions need a venue where price competition happens without anyone seeing a competitor's price.

## 2. The venue (0:30)

> "ShadowDesk is a private RFQ venue on the Canton Network. The fund invites only approved dealers, they price blind, and the best price settles atomically."

- Hit **Institutional** - the buyer view.
- Show the buyer party, holdings (cTBILL block, cUSDC spent), and the live RFQ: 1,000,000 cTBILL, max price 101, two invited dealers.

## 3. Registration and quotes (0:40)

> "Each dealer is on its own Canton participant - dealer A on participant one, dealer B on participant two - and both price the same block."

- Show the RFQ terms: size, max price, settle-in, invited dealers (all visible to both dealers because they were invited).
- Explain both dealer agents received the RFQ on their own participants and submitted prices independently.

## 4. Prove the price is blind (1:00)

> "The core claim is secrecy. Each dealer sees its own price and nothing else."

- Show **Quote proposals**: dealer A at 100.2, dealer B at 100.5, each with its bid id.
- Go to **Public projection**.
- Point at the **CROSS-PARTICIPANT PRIVACY** banner: "This is a live query. The losing dealer - dealer B on participant two - asked the synchronizer for the winner's sealed quote and found zero contracts. The payload is only visible to the parties involved in the quote, not to a competing participant."

## 5. Selection and seal (0:30)

> "The fund picks the best executable price - dealer A at 100.2, within its 101 limit - and seals it into a binding quote."

- Return to **Institutional**; show dealer A's quote marked **SEALED** and dealer B marked **LOST**.
- The sealed quote is signatory to buyer and winning dealer, so it is binding on both.

## 6. Atomic settlement (1:00)

> "Now the trade settles. Delivery and payment exchange in a single Canton transaction - the fund gets the asset only if the dealer gets paid."

- Click **Run round** and let the streaming console execute on the live ledger.
- Point at the terminal: two proposals collected, deterministic winner, sealed quote, losing dealer sees 0 of winner's quotes (assertion bar), **DvP settled on participant 1** receipt with value.
- On completion show the banner: **DEMO COMPLETE: atomic DvP settled, cross-participant quote secrecy intact**.

## 7. Holdings and evidence (0:40)

> "After settlement the buyer holds 1,000,000 cTBILL and dealer A holds 100,200,000 cUSDC - a real trade, on a real ledger."

- Show the **Settlement** panel: DvP VERIFIED receipt, security, quantity, unit price, total value.
- Show "Trades settled" and the timeline in Public projection (event stream of RFQ created, quotes, seal, DvP settled).

## 8. Public boundary and close (1:00)

> "If you're not a party to a trade, you see the metadata the venue publishes - that a settlement happened - but never the prices, the identities beyond the metadata, or the payloads."

- Show the public projection terminal: color-coded event log with payload-sensitivity tags (PUBLIC METADATA vs PRIVATE).
- Close: "Blind pricing, atomic settlement, and a confidentiality boundary enforced by the ledger - not by an app layer. ShadowDesk."

Total: ~5 minutes.