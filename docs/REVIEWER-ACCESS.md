# Plan: let reviewers see the live dashboard without a login

Status: proposed, not built.

## The problem

The live dashboard reads ledger state as the visitor's own HackCanton participant user.
A reviewer without a HackCanton login gets "Connect the Canton wallet to continue." and sees no data.
Winning Season 3 entries let judges see their live state in a click, for example Talang's read-only desk with one link per role.

## Proposal: a published snapshot, not a public ledger session

After each DevNet round, the worker writes a sanitized snapshot of the round, and the dashboard serves it to anyone without a login.

- The snapshot holds what the projections already show: the mandate's limits, the RFQ, both quotes with the winner and loser marked, the receipt, the two registry legs, the update ids, and the losing desk's zero-view check.
- It is written by the worker, which already holds DevNet credentials, as a JSON file the dashboard reads, for example `GET /api/snapshot`.
- The public dashboard shows the snapshot with its timestamp and a label: "Snapshot of the round at <time>, read from the ledger by the worker".
- Signed-in users keep the live view as today.

## Why not a public live session

A public live view would mean a long-lived DevNet token on the server that answers any visitor.
That token would act as the team's ledger user, and the participant has no read-only scoping for it that we have verified.
A snapshot exposes only the fields we choose, and no visitor request ever reaches the participant.

## What has to be true

- No party ids beyond the role names the dashboard already shows, no tokens, no allocation secrets in the snapshot.
- The snapshot says when it was taken and which package id the round ran on.
- A round that fails writes nothing, so the snapshot never shows a half-settled trade.

## Work

1. Worker: after a successful `e2e:real-flow`, write the snapshot from `SHADOWDESK_E2E_RESULT_PATH` plus the projections.
2. Dashboard: a `/api/snapshot` route and a public, read-only view of it.
3. README "Verify in 2 minutes": link the public view.

This depends on the worker being redeployed with the current agents first ([DEVNET-UPGRADE.md](DEVNET-UPGRADE.md), step 4).
