# Architecture

## System context

```mermaid
flowchart LR
    subgraph Fund["Institutional fund"]
        BuyerAgent["Buyer agent<br/>(buyer party)"]
        Dashboard["ShadowDesk dashboard<br/>(Next.js, public + buyer views)"]
        BuyerAgent <-- "RFQ / accept / settle" --> Ledger
    end

    subgraph Dealers["Dealer desks"]
        DealerA["Dealer A agent<br/>(dealerA party)"]
        DealerB["Dealer B agent<br/>(dealerB party)"]
        DealerA <-- "quote / withdraw" --> Ledger
        DealerB <-- "quote / withdraw" --> Ledger
    end

    subgraph Canton["Canton Network (local two-participant topology)"]
        Ledger["Synchronizer"]
        P1["Participant 1<br/>JSON API :6864"]
        P2["Participant 2<br/>JSON API :18003"]
        Ledger --- P1
        Ledger --- P2
    end

    Dashboard -- "read-only JSON API<br/>projections + privacy probe" --> P1
    Dashboard -- "read-only JSON API<br/>projection" --> P2
```

## Contract model

```mermaid
sequenceDiagram
    autonumber
    participant Fund as Buyer (P1)
    participant Sync as Synchronizer
    participant DA as Dealer A (P1)
    participant DB as Dealer B (P2)

    Fund->>Sync: create BlockTradeRFQ(dealers=[DA,DB], size, maxPrice)
    Sync-->>DA: RFQ event (observer)
    Sync-->>DB: RFQ event (observer)
    DA->>Sync: SubmitQuoteProposal price=100.2 (QuoteProposal DA)
    DB->>Sync: SubmitQuoteProposal price=100.5 (QuoteProposal DB)
    DA--xDB: no visibility of DA's proposal
    Fund->>Sync: Select winner (lowest in-limit price) + AcceptProposal
    Sync-->>DA: SealedQuote (signatory DA+buyer) - binding
    Fund->>Sync: create Deal(buyer, DA, locked security + payment)
    Fund->>Sync: DA authorizes Deal (atomic actAs)
    Fund->>Sync: Settle - archive payment + security, create both assets
    Sync-->>Fund: SettlementReceipt
```

## Privacy boundaries

```mermaid
flowchart TB
    subgraph P1["Participant 1"]
        BuyerNode["buyer"]
        DealerANode["dealerA"]
    end
    subgraph P2["Participant 2"]
        DealerBNode["dealerB"]
    end

    RFQ(("BlockTradeRFQ<br/>signatory buyer,<br/>observer dealers"))
    QP_A(("QuoteProposal DA<br/>signatory DA,<br/>observer buyer"))
    QP_B(("QuoteProposal DB<br/>signatory DB,<br/>observer buyer"))
    SQ(["SealedQuote<br/>signatory buyer + DA"])
    D(["Deal / SettlementReceipt<br/>signatory buyer + DA"])

    RFQ -.-> BuyerNode
    RFQ -.-> DealerANode
    RFQ -.-> DealerBNode
    QP_A -.-> BuyerNode
    QP_A -.-> DealerANode
    QP_B -.-> BuyerNode
    QP_B -.-> DealerBNode
    SQ -.-> BuyerNode
    SQ -.-> DealerANode
    D -.-> BuyerNode
    D -.-> DealerANode
    QP_B -. "NOT visible on P1" .-> BuyerNode
```

A dealer on participant 2 observes the RFQ it was invited to, its own quote, and nothing from the other dealer. All quote payloads and the sealed quote are encoded for the involved parties only; the dashboard's privacy banner is a live cross-participant query proving the losing dealer sees zero of the winner's quotes.

## Execution flow

| Step | Actor | Action | Contract effect |
| --- | --- | --- | --- |
| 1 | Buyer agent | Create RFQ | `BlockTradeRFQ` (signatory buyer, observers = invited dealers) |
| 2 | Each dealer agent | SubmitQuoteProposal | `QuoteProposal` (signatory dealer, observer buyer) |
| 3 | Buyer agent | Select winner | Lowest in-limit price, tie-break bid id (pure function) |
| 4 | Buyer agent | AcceptProposal | `SealedQuote` (signatory buyer + winning dealer) |
| 5 | Buyer agent | Create Deal | `Deal` (signatory buyer + winning dealer) over locked security + payment |
| 6 | Both | Settle | Atomically archives payment + security, creates buyer-held security and dealer-held payment, emits `SettlementReceipt` |

## Components

- **`daml/`** - Daml templates (`ShadowDesk.Asset`, `ShadowDesk.Rfq`, `ShadowDesk.Settlement`), the two-participant distributed runner config, and script-runner party configs.
- **`agents/`** - `shared/client.ts` (JSON Ledger API v2 client with idempotent party allocation), buyer/dealer agents, and a deterministic winner-selection module. The demo orchestrates buyer + both dealers on their own participants.
- **`frontend/`** - Next.js App Router dashboard. `/api/state` builds server-side projections from both participants; `/api/replay` streams a live agent round as newline-delimited JSON. The browser only ever talks to the dashboard API, never to a participant directly.
- **`scripts/localnet/`** - `run-demo.sh` (sandbox + DAR upload + demo), `run-all.sh` (everything, plus the dashboard).