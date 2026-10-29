# Changelog since 8a676f6d

`8a676f6d` ("Update protected Sepolia swap flow") is the student's last commit. `git merge-base 8a676f6d feature/sepolia-fork-demo` is `8a676f6d` itself, and `git merge-base --is-ancestor` succeeds, so that commit is an ancestor of this branch. There is no earlier fork point to substitute. The range below is `git log 8a676f6d..52153ca3` on `feature/sepolia-fork-demo` (49 commits). Hashes are the short ids from that log. This file is the note added after `52153ca3`. It is not one of the changes it describes.

Commit subjects on this branch were later reworded to the shape in [committing.md](../guides/committing.md). The hashes below are those reworded commits. Each tree matches the commit it replaced. `8a676f6d` is outside that reword and is unchanged.

Items are grouped by outcome. A side branch that is not contained in `feature/sepolia-fork-demo` is marked at the end and is not described as current behaviour.

## Source review and claims

`34c65cd8` wrote the 28 October 2026 source review so later work started from a record of which policy checks the hook enforces and which stay caller-supplied or router-only.

`4a20bf02` closed that review in place. Nine findings are marked closed against later commits, finding 3 stays partial because `POST /policy` still has no caller authentication, and the note records that `protectedPoolId()` and `protectedHook()` never existed in source.

`29c129b3` audited 69 claims about the Sepolia router and this repository: 55 true, 12 false, 2 unproven. The false getter claims are that those two getters were declared, that this repository calls them, and that a length mismatch proved a different runtime. The false README claim is the old three-level risk table. The engine at that audit did not implement it.

`bca84d5f` corrected the bytecode table that had labelled runtime lengths as source size, and it stopped blaming immutable masking for a length the comparison script measures before masking.

`b8e73d98` pinned `solc` 0.8.26 and the Cancun EVM in `foundry.toml` so a local build cannot drift from the compiler settings used for the router bytecode check.

`ba1392ff` rewrote the README risk section to the model the backend actually ran then: `estimatedLoss` was `absoluteAmount / 1000`, and the level was the literal `LOW` for every non-zero amount. The published `MEDIUM` and `HIGH` thresholds had nothing behind them.

## CI and backend/dist

`bdfb1ca2` added frontend and backend jobs to `.github/workflows/test.yml` (`npm ci`, `npm test`, frontend lint, and `npm run build`) beside the existing Foundry job. It stopped tracking `backend/dist` and ignored that directory, so CI typechecks source instead of a committed compile.

## Backend validation and the risk score

`fcd6dc7c` tightened policy validation, mapped bad numeric fields to HTTP 400, and replaced 500 bodies that echoed `error.message` with a stable `Internal error` plus `requestId`. The same commit made the risk result honest for the formula then in the file: loss stayed `amount / 1000`, and `riskLevel` was narrowed to the literal `LOW`, with the disclaimer kept on the response.

`d434fe44` kept the `POST /policy` signing gate as HTTP 503 before body validation. A disabled signing route answers 503 for any body, including a body that would otherwise be a 400. Tests cover that order, and they assert the demo `minAmountOut` rule only when signing is enabled.

`b2da0178` bounded `minAmountOut` with the same non-zero integer pattern as the other numeric fields, so a digit string longer than 78 characters is rejected instead of accepted by a bare regex.

`1d78f7e8` covered the local demo rule on the policy route: `minAmountOut` of `1` is signed when demo mode is on, and any other value returns 400. Before this, no route test could reach that branch.

`fc0b5bd6` sent every error status through one helper. Clients that read `body.error` keep the previous wording. `code` and `requestId` are on 400, 404, 500, and 503. Unknown routes return JSON instead of an HTML 404.

The pool-aware replacement of this risk model is under "Pool state and the fork sandwich" below. After that change there is no `amount / 1000` fallback.

## Policy expiry

`e514600f` stopped the UI requesting an expiry 3600 seconds ahead. The backend rejects any expiry more than `POLICY_MAX_TTL_SECONDS` past its clock, which is 30 minutes (1800 seconds), so every policy request failed validation. The UI now derives expiry from `POLICY_TTL_SECONDS` (10 minutes) through `buildPolicyExpiry`, inside that ceiling. The ceiling was not raised.

`6f64af68` recorded that expiry fix, and the shared-code refactor below, as shipped behaviour in the docs.

## Web app structure and which design shipped

`89440cf6` split `App.tsx` into a router shell and five pages: Trade, Activity, Portfolio, Policies, and Network. Wallet, quote, policy, and execution state moved into hooks. The protected-quote gates were left in place so the execute semantics did not move with the split.

`f5ee95d1` fixed policy activity logging after registration so the strict TypeScript build could see the output token.

`cf11b568` closed the follow-on gaps on Trade (input-token balance and Max), Network (monitor block from `/health`), Portfolio (WETH and USDC allowances), and accessible names on the four status regions. Execution gating was left unchanged.

`d5842e56` restyled the app with the MEVShield mockup tokens and components (swap ticket, shield report, history table, shared cards). Hooks, readiness, and API calls were left as they were.

`2cd52b16` merged `design/mockup-alignment` and kept the mockup as the product UI. Chain labels, local token copy, and the unconfigured-pool failure were carried onto that markup. `46d6209c` kept the risk level as its own labelled row. `256eddfe` left a single Connect wallet control in the top bar, so Portfolio and Activity no longer repeat it.

Primer is not on this branch. `ui/primer-foundation` built a GitHub Primer pass (`b75f2473`, `9b299eb9`, `57589768`, `59717d11`) and that tip is not an ancestor of `feature/sepolia-fork-demo`. It was not adopted. The current UI is the mockup from `d5842e56` and `2cd52b16`.

## Network page

`dff3717b` stopped the Network verification rows comparing constants to themselves. After the mockup merge, the hook and router rows observed a configured constant, and PolicyAuthorization compared two keys that held the same literal, so three rows could not fail. Rows now come from `buildVerificationRows`: PolicyAuthorization reads the hook's `authorization()`, and the hook and router addresses report `Not checked` because nothing on chain is the source for those two.

## Local Docker stack

`6b89acd5` allowed chain 31337 only when `MEVSHIELD_LOCAL_CHAIN_ENABLED` is the literal `true`, `NODE_ENV` is not `production`, and Railway is unset. Otherwise the backend still accepts only the pinned Sepolia chain, verifier, router, and pool.

`b1d19378` made the frontend chain, RPC, and contract addresses overridable with `VITE_*` variables. An empty environment still builds the published Sepolia app. The execute flag was not opened.

`aee7193e` added multi-stage backend and frontend images. The backend image defaults to production, which refuses chain 31337. The frontend image does not default the execute flag to true.

`74ea41fb` added the Compose stack: anvil on chain 31337, a one-shot `contracts-deploy`, the backend, and the frontend. `e88fd8d2` added `./script/docker-local-up.sh` (`--reset`, `--down`, `--logs`, `--no-build`) and `./script/docker-local-verify.sh`, and made a second `up` skip a deploy that is already on the chain. `bbd6682f` wrote [local-docker.md](../runbook/local-docker.md), including that the execute gate stays closed on this stack. `76fe76ff` recorded the port 4000 conflict seen when an unrelated process already held that port.

`38308c1d` made `script/docker-local-verify.sh` read `ANVIL_PORT`, `BACKEND_PORT`, and `FRONTEND_PORT` from `docker/.env.docker`, then the environment, then `8545` / `4000` / `5173`. Before that, a stack moved off the defaults failed every check against the wrong ports.

`73102050` removed the hardcoded anvil token defaults. A local build with `VITE_TOKEN0_ADDRESS` or `VITE_TOKEN1_ADDRESS` unset reports the missing variable and keeps signing and execution disabled.

## Local chain made usable

`3533a4d3` added `./script/local-test-flow.sh` and [local-test-flow.md](../runbook/local-test-flow.md) so a chain 31337 bundle can reach Check protection and register a policy. On chain 31337 the minimum-output check is a comparison against the deployment record. Sepolia stays flag-only and fail-closed.

The same commit fixed two defects the click-through found. `script/DeployLocal.s.sol` had set `authorizedRegistrar` to the deployer EOA, so `PolicyAuthorization.registerPolicy` verified the signature and the registry then reverted `Unauthorized`. The script now sets the registrar to `PolicyAuthorization`, matching `DeploySepolia`. And `sqrtPriceLimitX96` bounds were off by one: they stored the closest legal limits (`4295128740` and one below `TickMath.MAX_SQRT_PRICE`) instead of the TickMath bounds the router compares, so the frontend's legal limit was rejected and every policy request was HTTP 400.

## Pool state and the fork sandwich

`9691420a` replaced the `amount / 1000` risk score with a quote of price impact from the pool's active liquidity and `sqrtPriceX96`. `lossBps` can be `LOW`, `MEDIUM`, or `HIGH`. If the pool read fails, the API returns 503 `pool_state_unavailable` and does not fall back to `amount / 1000`. The same commit added `test/SepoliaForkSandwich.t.sol` and the first recorded fork run at block `12018873`: tick `198487` to `198477`, quoted out `8306140005511`, unprotected out `8297097263431`, protected revert `MinimumOutputNotMet`.

`52153ca3` updated the risk docs that still described `amount / 1000` (README, API reference, backend service page, risk-preview feature page) and recorded a second unpinned run at block `12018906` with the same trade numbers.

`f128e083` on `feature/pool-aware-risk` and `b94497b2` on `feature/mev-sandwich-demo` are not on this branch. The pool quote and the sandwich test that are on this branch are `9691420a` and `52153ca3`.

## Documentation set and shared code

`c22bfb0a`, `55588829`, `99065165`, and `df7a8764` added the architecture pages, service and HTTP references, feature status, the environment table, and five decision records, including the decision that the execute gate stays closed until the live-stack fork suite passes. `67b7bd8d` moved the line references onto the code after the refactor below, because the first draft cited `4a20bf02`.

`c484aa89` shares one EIP-712 Policy type between the signers and checks it against `POLICY_TYPEHASH` in `PolicyVerifier.sol`. `18495e96` resolves backend env aliases in one module. `fc0b5bd6` is the error helper above. `1c8fae3e` renders policy bounds through one full-precision formatter. `86c9022b` and `dc4c2fdf` share the card row and the backend-error reader. These are structure. They do not open execution.

`82d40100` and `c4f6940f` brought the 28 October local-demo handover note onto this branch so that session record was not dropped at the merge.

## Still not done

Live Sepolia execution still needs the private key for authorized signer `0x016B78a30CE176EF0B90c122e8677e13aAB2A815`, or an owner transaction that rotates that signer and a backend redeploy pointed at the new key ([ADR 0001](../decisions/0001-signed-policy-authorization.md)). `test/SepoliaForkDeploymentAExecution.t.sol` stays blocked without `SIGNER_PRIVATE_KEY`. The fork sandwich does not impersonate that signer. It etches this repository's hook onto the live hook address and signs with the fork-local key `0xA11CE`.

The execute gate stays closed. `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` remains false, which is the condition in [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).

The hook does not measure the attack. `MEVShieldHook.beforeSwap` checks the signature, expiry, nonce, pool, swap parameters, a non-zero `minAmountOut`, and that the caller-supplied loss and fee estimates do not exceed the signed caps. It does not read the attacker's swap and it does not compare realized output with the pre-attack quote. The revert in the fork test is `MEVShieldRouter` minimum output.
