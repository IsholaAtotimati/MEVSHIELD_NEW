# Session handover, 28 October 2026

The branch tips in this note are the refs as they stood that day. `feature/sepolia-fork-demo` later reworded the commits it contains. The other branches named here were not moved, so these ids are still what those refs point at. The [changelog](changelog-since-8a676f6d.md) uses the reworded ids for the same trees.

## Where the branches stand

`integration/local-demo-full` is the integration head. It points at `e549ce85`
("Require local pool token addresses from env instead of defaulting to anvil"), which is
a direct child of `76a17f37` ("Merge feature/local-docker into
integration/local-demo-plus-audit"). The merge of `fix/local-address-env-only` into the
integration branch was a true fast-forward, so the history is linear with no merge
commit and no rewritten history.

Other branches in the tree, and what they are for:

- `fix/local-address-env-only` at `e549ce85`. Now fully merged. It is the only commit
  that landed on top of `76a17f37`.
- `feature/local-docker` at `f11f2f29`. Owns `docker-compose.yml`, the two
  `script/docker-local-*.sh` scripts, and the Dockerfiles. Checked out in
  `/private/tmp/mevshield-local-docker`, where the running stack lives. Do not disturb
  that directory while a demo is being rehearsed.
- `design/mockup-alignment` at `d4d3296b`, checked out in `/private/tmp/wt-mockup-align`.
  Belongs to another session. Left untouched.
- `integration/mockup-final` at `e549ce85`, checked out in `/private/tmp/wt-consolidate`.
- `integration/local-demo` at `6a4d6d05` and `integration/local-demo-plus-audit` at
  `74c8ecc9`. Earlier integration points, both contained in the current head.
- `fix/policy-expiry-ttl`, `fix/audit-defects`, `fix/router-source-of-truth`,
  `fix/network-verification`, `refactor/reuse`, `feature/web-app-redesign`,
  `docs/project-docs`, `ui/primer-foundation`. All merged into the current head except
  `ui/primer-foundation`.
- `main` at `34c65cd8`, ahead of `origin/main` by one commit. Not touched this session.

The merge itself changed 15 files, and every one of them is either frontend source, a
frontend or Docker env example, or documentation. No Solidity, no backend source, and no
script changed. `git diff --stat 76a17f37 integration/local-demo-full` reports
`15 files changed, 583 insertions(+), 117 deletions(-)`.

## What was verified, and with what counts

All commands below were run on `integration/local-demo-full` at `e549ce85` after the
fast-forward. Backend tests need `tsx`, which fails with `EPERM` inside the restricted
sandbox, so they were run unsandboxed.

| Check | Command | Result |
| --- | --- | --- |
| Backend tests | `cd backend && npm test` | 83 tests, 83 pass, 0 fail, 0 skipped |
| Backend build | `cd backend && npm run build` | `tsc` clean, no diagnostics |
| Frontend tests | `cd frontend && npm test` | 48 tests, 48 pass, 0 fail, 0 skipped |
| Frontend lint | `cd frontend && npm run lint` | exit 0, 7 warnings, 0 errors |
| Frontend build | `cd frontend && npm run build` | 488 modules, `dist/assets/index-3p0rof4p.js` 606.31 kB, gzip 184.02 kB |
| Contracts build | `forge build` | success, warnings only |
| Contracts tests | `forge test` | 88 passed, 0 failed, 5 skipped (93 total) across 10 suites |
| Script syntax | `bash -n script/docker-local-up.sh`, `bash -n script/docker-local-verify.sh` | both clean |
| Compose validity | `docker compose config --quiet` | exit 0 |
| Diff scope | `git diff --stat 76a17f37 integration/local-demo-full` | 15 files, as above |
| Running stack | `./script/docker-local-verify.sh` | 11 passed, 0 failed |

The 7 lint warnings are all `react(set-state-in-effect)` on the balance, activity, protocol,
health, portfolio and protected-quote hooks, plus one `react(only-export-components)` in
`TradeContext.tsx`. All 7 pre-date this merge.

For `docker compose config --quiet`: no `docker/.env.docker` file exists in this repository
and none exists at the repository root, so there was no env file to pass. The command was
run with the same variables `script/docker-local-up.sh` exports as its fallbacks, namely
`ANVIL_PORT=8545`, `BACKEND_PORT=4000`, `FRONTEND_PORT=5173`,
`FRONTEND_URL=http://localhost:5173`, `VITE_API_URL=http://localhost:4000` and
`VITE_RPC_URL=http://localhost:8545`. Compose reads from the shell environment rather than
from a named `--env-file`, which is what the script does too.

The execute gate is still closed everywhere. `frontend/src/config/env.ts` resolves it as
`import.meta.env.VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED === "true"`, so anything
unset, blank or spelled differently is false. The defaults:

    frontend/.env.example:18:VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=false
    docker/.env.docker.example:82:VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=false
    docker-compose.yml:219:  VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED: "${VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED:-false}"
    frontend/Dockerfile:32:ARG VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=false

A repository-wide search for the string set to true returns one hit, and it is prose in
`docs/features/protected-swap.md` describing the condition under which the gate would
open, not a configuration value.

## Defects fixed today

**Policy expiry TTL mismatch.** The frontend derived its requested expiry from a TTL that
did not match the backend ceiling, so a request could be built to expire later than the
backend would accept. The fix put a single shared TTL inside the ceiling. Both sides now
declare the constant, `POLICY_MAX_TTL_SECONDS = 30 * 60` in
`backend/src/policy/policyRequest.ts` and `frontend/src/config/policy.ts`, with
`POLICY_TTL_SECONDS = 10 * 60` as the value actually requested. Because the frontend value
is a hand-maintained mirror of the backend one, `frontend/src/config/policy.test.mjs`
asserts the ordering and that a derived expiry stays inside the ceiling, so the two cannot
drift apart silently.

**Unbounded minAmountOut.** The `/policy` schema accepted any positive integer for
`minAmountOut`, which meant a caller could request a signature whose minimum output offered
no real protection. The schema now requires a non-zero unsigned integer of at most 78
digits, and `backend/src/server.ts` rejects a minimum output of exactly `1` whenever local
demo mode is off, while local demo mode requires exactly `1` and rejects anything else.
Both directions are covered by tests in `backend/src/policy/policyRequest.test.ts` and
`backend/src/server.test.ts`. Note what this does and does not do: the schema still accepts
any other positive value, so a non-demo caller can post a small minimum that is not `1`.
The rule is a floor against the degenerate value, not a slippage guarantee. That limit is
documented rather than hidden.

**README risk model.** The README described `maxLoss` and `maxFee` in terms that implied
they bound a realised outcome. They do not. The hook compares each signed cap against
caller-supplied estimate values carried in `hookData`, so the comparison constrains what
the caller asserts rather than what the swap actually costs. The README now states that
boundary directly, points at `docs/reviews/2026-10-28-code-review.md`, and notes that
realised minimum output and the tick distance cap are router-only checks.

**Anvil fallback hardening.** The local build used to carry compiled-in anvil token
addresses as defaults and fall back to them silently. `script/SetupBackendSwap.s.sol`
deploys a fresh mock pair on every deploy, so a built-in local default could only ever be
a guess about a chain the build had not seen, and a wrong address would read and trade
against nothing while failing quietly. The local chain now has no default at all. A missing
`VITE_TOKEN0_ADDRESS` or `VITE_TOKEN1_ADDRESS` produces an `unconfigured` state that names
the missing variables and blocks risk checking and execution, and the trading paths treat
the pool key, pool id and token addresses as possibly absent instead of assuming a pool
exists. The failure is deliberately not thrown at module scope, because that would blank
the page before React renders. Sepolia keeps its published addresses as defaults and still
works with no environment at all.

## What is genuinely open, and needs Lukman

These are decisions or facts that this repository cannot resolve on its own. Nothing below
is a code defect waiting on a fix.

**Router redeploy decision.** The deployed Sepolia router at `0x6332...150D` does not expose
the `protectedPoolId()` or `protectedHook()` selectors, and the committed source does not
declare them either, so source and bytecode agree with each other. What is unresolved is a
product decision: whether to redeploy the router so those getters exist, or to accept that
consumers read the pool identity from configuration instead. The fork evidence in
`docs/reviews/2026-10-28-router-bytecode-investigation.md` shows the deployed router
enforces the signed minimum output against real pool state, so a redeploy is not needed for
safety. It is needed only if the getters are wanted as a public surface.

**Signer key for `SepoliaForkDeploymentAExecution`.** `test/SepoliaForkDeploymentAExecution.t.sol`
is the only suite that executes a swap against the live Sepolia stack, and it skips unless
`RUN_SEPOLIA_FORK_DEPLOYMENT_A_EXECUTION` is set and a `SIGNER_PRIVATE_KEY` is supplied.
Without that run there is no direct execution evidence through `0x6332...150D`, only strong
inference from the v2 suite plus the normalised bytecode match. It is one of the 5 skipped
tests in the 88/5 result. This key has to come from Lukman.

**Confirmation of the getters report.** The bytecode investigation established, by selector
and by direct `cast call`, that `protectedPoolId()` and `protectedHook()` are absent from
the deployed router. Someone with knowledge of the intended deployment surface should
confirm that absence is expected rather than a truncated or partial deployment. The
evidence is in `docs/reviews/deployed-router-6332.hex` and
`docs/reviews/router-bytecode-comparison.json`.

**Off-repo caller check.** Whether anything outside this repository calls the deployed
router or depends on the missing getters cannot be determined from here. That check has to
be done by someone who can see the other repositories or integrations.

Two further limits are worth carrying forward even though they are documented rather than
open. No quote can currently be produced for the protected pool, so outside demo mode the
UI cannot reach the risk check regardless of the gate. And `canExecute` additionally
requires `policyBoundsVerified`, which needs a registered policy.

## The running Docker stack is representative

The stack in `/private/tmp/mevshield-local-docker` runs images built from `f11f2f29` on
`feature/local-docker`, which predates `e549ce85`. It does not need rebuilding for a demo.
The reasoning, and the evidence for it:

The only behavioural change in `e549ce85` is the removal of local token address fallbacks.
`docker-compose.yml` already passes `VITE_TOKEN0_ADDRESS=0x610178dA211FEF7D417bC0e6FeD39F05609AD788`
and `VITE_TOKEN1_ADDRESS=0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` as frontend build
arguments, and those are byte for byte the same values the removed fallbacks contained. So
the `unconfigured` branch that the new code adds can never be taken in this stack, and every
other change in the commit is a null guard on that unreachable branch. The pool key and pool
id are therefore unchanged, which I confirmed by computing the pool id both ways, from the
removed fallbacks and from the compose build arguments. Both give
`0x8d754c8c3f0e991efb877b18bf00b8d0718c2cd8af8f31a35c61de1415e19bf0`, which also matches
the backend's pinned `PROTECTED_POOL_ID`. The running frontend bundle at
`/usr/share/nginx/html/assets/index-DivectVo.js` contains both token addresses literally.

The running stack was also checked live and behaves correctly. Anvil answers chain id 31337
on port 8645, the backend reports healthy on port 4100 with chain 31337 and policy signing
enabled, the frontend serves 200 on port 5273, and `./script/docker-local-verify.sh`
against those ports passed all 11 checks, including the one that takes a signature the
backend produced and has the deployed PolicyVerifier accept it.

If you do want to rebuild anyway, for example so the image matches the branch you are
standing on, the commands are:

    ./script/docker-local-up.sh --down
    ./script/docker-local-up.sh

Adding `--reset` to the second command also wipes volumes, which forces contracts to be
redeployed and gives you a clean chain. Note that the stack that is currently running uses
`ANVIL_PORT=8645`, `BACKEND_PORT=4100` and `FRONTEND_PORT=5273` from a local
`docker/.env.docker` that lives in that worktree, not in this repository. The defaults in
this repository are 8545, 4000 and 5173. A rebuild from this checkout without the same port
overrides would come up on the default ports and the URLs you have been rehearsing with
would change.

## Starting, verifying and stopping the local stack

Start it:

    ./script/docker-local-up.sh

Add `--reset` to wipe volumes first, `--no-build` to reuse existing images, or `--logs` to
follow output after startup. The script fails loudly and names the failing layer rather
than leaving a half-wired stack.

Verify it:

    ./script/docker-local-verify.sh

This checks anvil, the deploy exit status, router code presence, pool initialisation,
backend health, the protected pool id, the frontend and its SPA fallback, and finally that
the deployed PolicyVerifier accepts a backend signature. To point it at a stack on
non-default ports, pass them explicitly:

    ANVIL_PORT=8645 BACKEND_PORT=4100 FRONTEND_PORT=5273 ./script/docker-local-verify.sh

Stop it:

    ./script/docker-local-up.sh --down

That removes containers, volumes and orphans. The execute gate stays closed in every one of
these paths, so the stack demonstrates the quote, policy and readiness flow but will not
execute a swap.
