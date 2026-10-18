# ShadowDesk motion intro - script

A narrated intro of about 35 seconds, rendered from code in `video/` with Remotion.
Voiceover is VoiceStudio's "The Neighbor"; the lines live in `video/voiceover/lines.json`.
The product is spoken as "Shadow Desk" so the voice reads it as two words.

Scene lengths are derived from the voiceover, so the times below are approximate.

| # | Time | Picture | Voiceover |
| --- | --- | --- | --- |
| 1 | 0-3 s | A block order card types in: BUY 1,000,000 cTBILL. The market ticker behind it blurs. | A fund wants to buy a large block, quietly. |
| 2 | 3-8 s | The `TreasuryMandate` card: dealers, size, max price, expiry. Buyer and risk officer signatures tick in. | First, a risk officer approves a mandate: the dealers, the size, the maximum price. |
| 3 | 8-12 s | The agent tries an RFQ for 1,500,000 at 101.40; `OpenRfq` rejects it. A 1,000,000 RFQ at 101.00 opens. | The agent cannot trade past it. The ledger says no. |
| 4 | 12-17 s | Two sealed quote cards, each locked to one dealer. Dealer B's view of Dealer A's quotes counts to 0. | Two dealers quote blind. Neither sees the other's price. |
| 5 | 17-21 s | The quotes unseal for the buyer: 100.20 beats 100.50, SEALED badge, rule `LowestPriceThenBidId`. | The lowest price wins, by a rule anyone can check. |
| 6 | 21-27 s | Delivery versus payment: cTBILL and cUSDC swap across one transaction; DVP VERIFIED. | Securities and cash move together, in one transaction, or not at all. |
| 7 | 27-30 s | The settlement receipt: quantity, unit price, total value, each tagged "from ledger". | Every number on screen comes from the ledger. |
| 8 | 30-35 s | The ShadowDesk mark draws itself; "Approve. Quote. Award. Settle." and the dashboard URL. | Shadow Desk. Approve. Quote. Award. Settle. Private execution, on Canton. |

The figures (1,000,000 cTBILL, 100.20 against 100.50, a total of 100,200,000 cUSDC) are the ones the LocalNet demo round records, shown in `docs/demo-walkthrough/5-institutional-settlement.png`.
They are synthetic LocalNet assets, not real money.
