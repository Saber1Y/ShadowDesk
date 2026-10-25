# Upgrading DevNet to the mandated package

Status on 2026-10-25: steps 1 to 3 and 5 are done, and two rounds settled on the new package ([evidence](evidence/devnet-2026-10-25-mandated.json)).
Step 4, redeploying the worker on the VPS, is still to do, so the dashboard's **Run round** uses the earlier package until then.

The risk officer now co-signs every RFQ, and every RFQ, award and receipt must point at an approved mandate.
That closes the bypass in which the buyer party created an RFQ outside any mandate and settled it.
Because the `BlockTradeRFQ`, `SealedQuote` and `SettlementReceipt` templates changed shape, this is not a valid smart-contract upgrade of `shadowdesk-treasury` 1.0.0.
The ledger would reject it under the old name, so the fixed contracts ship as a new package.

| | Before | After |
| --- | --- | --- |
| Package name | `shadowdesk-treasury` | `shadowdesk-treasury-mandated` |
| Version | 1.0.0 | 1.0.0 |
| Main package id | `50a21ee1be71aeae5c56c90db20491dd870004f1cd4fb47efcf7d3aa292d7c22` | `941cafd1e1db2b1fdf52d2a3235f74113a56e8bad1297c9db18ff140991239eb` |
| DAR | `daml/.daml/dist/shadowdesk-treasury-1.0.0.dar` | `daml/.daml/dist/shadowdesk-treasury-mandated-1.0.0.dar` |

Only this V1 package is needed on DevNet: the live round (`npm run e2e:real-flow`, which the worker runs for **Run round**) settles through it.
The V2 package (`shadowdesk-treasury-v2` 2.0.0, package id `560545603918a939b9bc232d6931bef4a518d7c696775aef0a95292388e67199`) is used only by the LocalNet checks and does not need uploading.

## 1. Build the DAR

```bash
cd daml && dpm build
```

On an Apple Silicon Mac the Daml compiler needs Rosetta.
Without Rosetta, build in a Linux container instead:

```bash
docker run --rm -v "$PWD":/work -w /work/daml -e HOME=/opt/dpmhome eclipse-temurin:17-jdk bash -c 'apt-get update -qq && apt-get install -y -qq curl >/dev/null && curl -sSL https://get.digitalasset.com/install/install.sh | sh -s 3.5.10 && /opt/dpmhome/.dpm/bin/dpm build'
```

The build is deterministic: the DAR's main package id must be `941cafd1e1db2b1fdf52d2a3235f74113a56e8bad1297c9db18ff140991239eb`, which is pinned as `PACKAGE_ID` in `agents/shared/types.ts`.

## 2. Upload it to the HackCanton DevNet participant

Upload `daml/.daml/dist/shadowdesk-treasury-mandated-1.0.0.dar` through the NODERS node console for the HackCanton-01 participant, then confirm the console lists it as vetted.

The team's ledger user cannot upload packages itself: `POST /v2/packages` returned 403 when the V2 package was tried, because uploads need operator credentials.

## 3. Confirm the participant serves it

With a DevNet session loaded, list the participant's packages and look for the new id:

```bash
scripts/env/with-devnet-auth.sh bash -c 'curl -s -H "Authorization: Bearer $SHADOWDESK_CANTON_ACCESS_TOKEN" "$SHADOWDESK_PARTICIPANT1_URL/v2/packages"' | grep 941cafd1
```

## 4. Redeploy the agents

The worker on the VPS runs the agents, so it needs the updated `agents/` directory:

1. Sync `agents/` and `worker/` to the VPS.
2. Run `npm ci` in `agents/` on the VPS.
3. Restart the worker service.

The dashboard needs no change for the package: it matches templates by module and name, so it reads contracts from both packages.
Pushing to `main` redeploys it on Vercel as usual.

## 5. Run a round and record the evidence

Press **Run round** on the live dashboard, or run it directly:

```bash
cd agents && ../scripts/env/with-devnet-auth.sh npm run e2e:real-flow
```

The round delivers CBTC for BETH by default. `SHADOWDESK_E2E_QUANTITY` is in base units (10 decimals), so `100000000` is 0.01; set `SHADOWDESK_E2E_RESULT_PATH` to a file to save the receipts and update ids.

The buyer and risk officer must be different parties, which they are in the current DevNet profile.
A round now fails fast with "the risk officer must be a different party from the buyer" if they are not.

After a successful round, record its update id in [CLAIMS.md](CLAIMS.md) and change the "Every trade forced through a mandate" row there and in the README from "LocalNet" to "DevNet".

## Old contracts

Contracts created under `shadowdesk-treasury` 1.0.0 stay on the ledger and remain readable.
They do not have the new guarantee, and `npm run prune:stale` can archive them; it exercises choices on each contract's own template id, so it works for both packages.
