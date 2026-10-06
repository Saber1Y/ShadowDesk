# Security Review

## Scope

ShadowDesk is an authenticated Canton application that submits Daml and Token
Standard commands for real DevNet parties.

The review covers the dashboard replay route, DevNet session handling, agent
command construction, allocation cleanup, and the frontend registry projection.

## Controls In Place

- DevNet replay requests require a valid Canton session.
- Browser replay requests must have a same-origin `Origin` header when one is
  supplied.
- Replay amount and price inputs are finite, bounded, and safe integers where
  base units are expected.
- Only configured registry instruments (`CBTC` and `BETH`) can be selected by the
  DevNet route.
- A single in-process round lock prevents concurrent executions, has a deadline,
  and is released when the request aborts or the child exits.
- A short cooldown prevents immediate repeated faucet-backed rounds.
- Child processes receive credentials through their environment and no token is
  written to the repository or streamed to the console.
- Registry allocation choices are exercised through the published interfaces,
  not guessed concrete templates.
- Locked holdings are excluded before allocation creation.
- Failed atomic settlements are tested to confirm that balances do not move and
  allocation legs remain reserved rather than partially settling.
- Refresh failures no longer delete a session unless the identity provider
  definitively returns `invalid_grant`.
- Frontend projection tests cover owner attribution, reserved holdings, unrelated
  contracts, and allocation-leg parsing.

## Residual Risks

- Replay locking and rate limiting are process-local. Multiple application
  instances need a shared lock and rate limiter before production deployment.
- The DevNet faucet is intentionally enabled for the test environment. It must be
  disabled or separately authorized in any production deployment.
- The deployed Daml package does not enforce global best-price selection on-ledger;
  the buyer-side ranking is auditable but not a consensus rule.
- The V1 receipt encodes registry instruments as `{ issuer, symbol }`. A native
  typed `InstrumentId` receipt requires the V2 package to be deployed.
- DevNet has one participant, so cross-participant privacy is proven only on the
  two-participant local sandbox.
- No formal third-party audit has been performed.

## Release Gate

Before handling production value, require:

1. A shared distributed lock/rate limiter for replay execution.
2. Faucet removal and explicit authorization for funding.
3. On-ledger best-execution policy or a formally accepted buyer-attestation
   design.
4. Deployment of the typed V2 receipt package.
5. Independent smart-contract and agent-permission review.
