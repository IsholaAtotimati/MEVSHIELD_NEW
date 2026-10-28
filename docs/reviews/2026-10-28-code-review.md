# MEVShield source review — 28 October 2026

Read-only review of commit `8a676f6` (`Update protected Sepolia swap flow`). Tests were read and not re-run. This note is a development record of observed gaps. It is not an independent security audit, and it is not permission to use the contracts with funds that matter.

**Verdict.** Signature, expiry, one-time nonce, and pool/swap-parameter binding form a coherent testnet authorization path. Loss caps, fee caps, realized minimum output, and the 600-tick price-limit distance do not constrain every swap at the Uniswap v4 pool. Treat the system as an experimental authorization wrapper until those checks run inside the hook and `POST /policy` requires an authenticated caller.

## Standards

| Standard | Contracts | Backend | Frontend | Repository |
|---|---|---|---|---|
| Patterns | Partial | Partial | Partial | Partial |
| Coding | Partial | Strong | Weak | Weak |
| Design boundaries | Partial | Strong | Weak | Partial |
| Automated tests | Partial | Partial | Weak | Weak |

Partial means the practice exists and a material gap remains. Weak means the practice is missing or concentrated in one file.

Contracts use custom errors, immutables, and checks-effects-interactions on nonce consumption. NatSpec is thin and the `Policy` struct is copied in more than one file. The backend uses strict TypeScript, Zod on the main request bodies, and a fail-closed Sepolia configuration. The frontend quote helper refuses to invent a market quote. `frontend/src/App.tsx` is 1,758 lines, and `frontend/tsconfig.app.json` does not enable `strict`. Forge formatting is enforced in CI. JavaScript CI, a root `LICENSE`, and a clean `backend/dist` tree are not.

## Where each constraint is checked

| Constraint | Signed | Stored in the registry | Hook | Router |
|---|---|---|---|---|
| Pool, direction, amount, price limit | Yes | Pool id only | Matched to the swap params | Re-checked on the minimum-output path |
| Expiry and one-time nonce | Yes | Yes | Checked, then consumed | No |
| `maxLoss` and `maxFee` | Caps are signed | Yes | Compared to `hookData` estimates | No |
| `minAmountOut` | Yes | Yes | Rejects zero | Compared to the swap delta |
| 600-tick price-limit distance | No | No | No | Checked against slot0 before `swap` |
| Payer and recipient | No | No | `trader` must equal the swap sender | Payer is `msg.sender`; recipient is an argument |

`src/MEVShieldHook.sol` says the hook does not independently measure realized loss or fees. `beforeSwap` still compares `estimatedLoss` and `estimatedFee` decoded from `hookData` (`src/MEVShieldHook.sol` around lines 92–123). Those integers are outside `POLICY_TYPEHASH`. A caller can pass zeros and satisfy `MaxLossExceeded` and `MaxFeeExceeded`.

`minAmountOut == 0` reverts in the hook. The comparison of the swap delta to `minAmountOut`, and `MAX_PRICE_LIMIT_TICK_DISTANCE` (600), run in `src/MEVShieldRouter.sol`. The hook address is mined for `beforeSwap` only, so a direct `PoolManager.swap` with valid hook data does not run the router checks.

## Critical

1. **Loss and fee caps check caller estimates.** `src/MEVShieldHook.sol`. Measure post-swap economics in a hook callback Uniswap v4 actually invokes, or remove `maxLoss` and `maxFee` from the enforcement story.
2. **Minimum output and the tick cap live on the router.** `src/MEVShieldHook.sol`, `src/MEVShieldRouter.sol`. Enforce realized minimum output in the pool hook. That requires a new hook address and a new pool. Until then, describe the router checks as checks for this router.
3. **Policy signing has no caller authentication.** `backend/src/server.ts` `POST /policy`, `backend/src/config/runtimeConfig.ts`. When signing is enabled, the route returns an EIP-712 signature from the on-chain authorized signer. CORS limits browsers. Any other client that can reach the process can request a signature. The key is loaded into an in-memory wallet at startup. Require an authenticated caller and rate limit before signing is reachable. Load the key only when signing is enabled.

## Important

4. **The signed trader is the swap sender.** `src/MEVShieldHook.sol` requires `policy.trader == sender`. `backend/src/server.ts` requires that address to be `MEVShieldRouter`. Payer and recipient are not in the policy. Add them to the EIP-712 struct and match them to settlement.
5. **The registry stores a subset of the signed policy.** `src/PolicyRegistry.sol` omits direction, amount, and price limit. `policyId` is `keccak256(poolId, trader, nonce)`. `src/PolicyAuthorization.sol` compares the stored fields. Store a hash of the full signed policy and require it on authorize.
6. **Registry ownership can retarget who consumes policies.** `setAuthorizedConsumer` is owner-controlled. `setAuthorizedHook` is one-shot. There is no cancel. Unused policies stay executable until expiry. Make the consumer immutable after initialization, or use a delayed two-step rotation, and add a signed cancel.
7. **The compiler profile is unpinned.** `foundry.toml` sets `optimizer_runs = 1` and `via_ir = true`, with no `solc_version` or `evm_version`. Fork deployment tests check addresses and pool state. They do not compare runtime codehash to the local artifact. Pin the compiler and add that comparison.
8. **There are no fuzz or invariant tests.** About 100 Forge `test_` functions cover authorization, replay, mismatch, router minimum output, and tick distance. None are `testFuzz_` or `invariant_`. Several integration reverts use a bare `vm.expectRevert()`. Fork tests stay off unless an environment flag is set, which is the right default.
9. **Enabled signing accepts any positive minimum output.** `backend/src/policy/policyRequest.ts` requires a positive integer. The rule that `minAmountOut` equals `"1"` applies only in local demo mode.
10. **Numeric policy fields are untyped strings.** `nonce`, `expiry`, `amountSpecified`, and `sqrtPriceLimitX96` are bare strings. `BigInt` failures become HTTP 500 responses whose body is `error.message`. `/risk-preview` already uses a decimal pattern. Use that pattern, validate ranges, map parse failures to 400, and return a stable 500 body plus the request id.
11. **`MEDIUM` and `HIGH` cannot occur.** `backend/src/risk/riskEngine.ts` sets estimated loss to the absolute amount divided by 1000, so loss is 10 basis points for every non-zero size and the level is `LOW`. `zeroForOne` is unused. Return one deterministic-mvp level until the formula has a real input, and attach the existing disclaimer to `POST /policy`.
12. **The swap screen is one component.** `frontend/src/App.tsx` holds wallet, polling, policy, swap, and markup. The app tsconfig leaves `strict` off. Split those flows and enable `strict`. Parse policy JSON before `writeContract`.
13. **Risk preview and the wallet balance describe a different action than execution.** Check Swap Risk enables when the amount parses. Create Policy waits for swap readiness. The wallet card shows native Sepolia ETH. Execution spends the WETH ERC-20 at the ETH token address. The token label already says the swap executes as WETH. Show the ERC-20 balance the swap will spend, and tie the risk button to readiness.
14. **CI runs Foundry and skips the TypeScript apps.** `.github/workflows/test.yml` runs `forge fmt --check`, `forge build --sizes`, and `forge test`. `FOUNDRY_PROFILE` is `ci`, and `foundry.toml` has no `[profile.ci]`. Add frontend lint, test, and build, and backend test and build.
15. **Compiled backend output is tracked.** `backend/dist` contains 23 committed files, including compiled tests and signer scripts. `frontend/dist` is ignored. Ignore `backend/dist`, exclude tests and scripts from `tsc`, and build in CI.

## Minor

16. **Policy types and comments have drifted.** Three `Policy` structs are copied by hand. The hook header still says Week 3. The router declares errors it does not use. Some tests accept any revert. Share one policy library and assert custom-error selectors.
17. **Route behavior is untested.** Config, schema, signing skip, and the preview disclaimer have `node:test` coverage. `backend/src/server.ts` is not imported by tests. `backend/src/risk/riskEngine.test.ts` is a loose assert script. `generatePolicy` has no direct test.
18. **EIP-712 types are copied in three backend modules.** `policySigner.ts`, `testSigner.ts`, and `verifyApiSignature.ts`. Export one `TYPES` object and move the scripts out of `src`.
19. **The documented frontend environment points at production.** `frontend/.env.example` sets `VITE_API_URL` to the Railway host. Code defaults to `http://localhost:4000`. `frontend/README.md` is still the Vite template. Demo mode itself requires Vite dev and a local backend.
20. **Freshness and the restore control do not match their UI.** Quote freshness uses a clock updated when inspect finishes, so the 15-second window does not expire between polls. The registry restore button is rendered disabled.
21. **License and local artifacts are in the tree.** Solidity files declare MIT. There is no root `LICENSE`. Tracked leftovers include `frontend/src/App.tsx.before-swap-label-fix`, `script/ApproveSepoliaPermit2.s.sol.bak`, empty root files, and anvil state.
22. **`docs/` was gitignored while one assignment stayed tracked.** Published reviews now live under `docs/reviews/`. Other notes under `docs/` stay local.

## What is already solid

`PolicyAuthorization` verifies the EIP-712 signature, compares the registered subset, and consumes the nonce only after those checks. Invalid signature, expiry, and replay revert before a successful protected swap. Hook and router callbacks require the pool manager. Unimplemented hook callbacks revert. The router refunds only unused ETH from the current call.

The backend refuses a chain, verifier, router, or pool id that does not match the pinned Sepolia deployment, and it derives the pool id from the pool key. Demo signing is off when `NODE_ENV` is `production` or Railway is set. Risk preview states that it is a deterministic formula. The frontend ends quote assessment at `quote-simulation-unavailable` after pool checks. Approvals are for the exact amount.

Forge tests cover wrong signer, field tampering, chain id, verifying contract, replay, pool mismatch, and router minimum output. The CI workflow uses `contents: read` and does not persist checkout credentials.

## Testing bar for later changes

| Layer | Present at this review | Close first |
|---|---|---|
| Contracts | About 100 Forge tests in 10 files. Fork tests opt in. | Fuzz tick distance and minimum output. Invariant for nonce and failed-swap balances. Codehash match. Assert error selectors. |
| Backend | 36 `node:test` cases across config, policy schema, signing, preview, correlation, and monitor. | HTTP tests for `/policy`, `/risk-preview`, and `/health`. Named tests for `calculateRisk`. One typehash test against Solidity. |
| Frontend | `frontend/src/lib/protectedQuote.test.mjs` covers parse, pool mismatch, stale state, zero liquidity, and demo readiness. | A fixture where execution becomes allowed only with a real quote, and a fixture that still cannot produce an available quote. |
| CI | Forge format, build, and test. | Frontend lint, test, and build. Backend test and build. |

## Recommended order

1. Write the enforcement boundary into the hook and this repository together. Realized minimum output belongs in a hook callback v4 always runs. Loss and fee belong there only if they are measured on-chain.
2. Put payer and recipient in the signed policy, and store a hash of the full policy.
3. Gate `POST /policy` and stop signing an unconstrained minimum.
4. Add TypeScript CI and stop tracking `backend/dist`.
5. Pin the Solidity build and add fuzz, invariants, and a codehash test.
6. Split `App.tsx`, enable `strict`, and show the token balance execution spends.
7. Collapse the risk result to the formula that actually runs, and return the disclaimer from `POST /policy`.

Roadmap items in `README.md` stay as written. A checked roadmap box describes development progress, not closure of the gaps in this note.

## Closure status (28 October 2026, later same day)

The findings above were written against `8a676f6`. This section records what changed on `feature/web-app-redesign` later the same day. The original findings are kept unchanged as a historical record. Each entry names the commit that did the work, and CLOSED means the finding no longer applies on this branch. It does not mean the underlying protocol work is audited.

Counts across the 22 findings: 9 CLOSED (7, 10, 11, 12, 13, 14, 15, 19, 20, with the disabled restore control closed alongside 20), 3 PARTIAL (3, 9, 17), and 10 OPEN (1, 2, 4, 5, 6, 8, 16, 18, 21, 22).

### Critical

1. **Loss and fee caps check caller estimates. OPEN.** `src/MEVShieldHook.sol` still decodes `estimatedLoss` and `estimatedFee` from `hookData` and compares them to the caps (`src/MEVShieldHook.sol:114`). No contract source changed on this branch after `8a676f6`; the fix needs a new hook address and a new pool.
2. **Minimum output and the tick cap live on the router. OPEN.** The split between `src/MEVShieldHook.sol` and `src/MEVShieldRouter.sol` is unchanged. There is no hook-side realized minimum output, and a direct `PoolManager.swap` with valid hook data still skips the router checks.
3. **Policy signing has no caller authentication. PARTIAL.** Signing remains fail-closed behind the 503 feature gate, and `SIGNER_PRIVATE_KEY` is now read only when signing is enabled (`backend/src/config/runtimeConfig.ts:192`, inside `if (requireSigner)`). `POST /policy` still has no caller authentication and no rate limit, so any client that can reach the process can still request a signature when signing is on. `ce17b1a0` and `319e240b`.

### Important

4. **The signed trader is the swap sender. OPEN.** `policy.trader != sender` still reverts (`src/MEVShieldHook.sol:99`). Payer and recipient are not in the signed policy and there is no contract change on this branch.
5. **The registry stores a subset of the signed policy. OPEN.** `src/PolicyRegistry.sol:5` still stores the seven-field struct without direction, amount, or price limit, and `policyId` is still derived from pool id, trader, and nonce.
6. **Registry ownership can retarget who consumes policies. OPEN.** `setAuthorizedConsumer` is still owner-controlled (`src/PolicyRegistry.sol:75`) and there is still no signed cancel. No contract change on this branch.
7. **The compiler profile is unpinned. CLOSED.** `foundry.toml` now sets `solc_version = "0.8.26"` and `evm_version = "cancun"` and is identical on `feature/web-app-redesign` and `fix/router-source-of-truth`. Pinned in `2f1080eb` on the router branch and propagated here in `8cc026a8`. The codehash comparison part of the finding is addressed separately in the router bytecode investigation.
8. **There are no fuzz or invariant tests. OPEN.** `rg "testFuzz_|invariant_" test/` still returns nothing. Bare `vm.expectRevert()` remains in `test/PolicyAuthorization.t.sol` and `test/MEVShieldIntegration.t.sol`. Contracts and tests are untouched on this branch.
9. **Enabled signing accepts any positive minimum output. PARTIAL.** `backend/src/policy/policyRequest.ts:21` still accepts any `[1-9]\d*` string, so the schema itself is unconstrained. What changed is the surrounding rule: `backend/src/server.ts:162` now rejects `minAmountOut === "1"` whenever `localDemoMode` is off, and the demo-only "exactly 1" rule is enforced at `backend/src/server.ts:154`. A non-demo caller can still post any positive minimum. `319e240b` and `82811b8e`.
10. **Numeric policy fields are untyped strings. CLOSED.** `backend/src/policy/policyRequest.ts` now validates every numeric field with a decimal pattern, a 78-digit bound, a non-zero nonce, a future expiry inside the 30 minute TTL, and a `sqrtPriceLimitX96` strictly between the v4 price bounds. Zod failures on `/policy` map to 400, and the fallback 500 body is a stable `Internal error` plus `requestId` (`backend/src/server.ts:293`). `319e240b`. One thing to note by design: the 503 gate runs before validation, so a disabled signing route answers 503 to any body rather than 400. That ordering is deliberate and documented at `backend/src/server.ts:141`. `82811b8e`.
11. **`MEDIUM` and `HIGH` cannot occur. CLOSED.** `backend/src/risk/riskEngine.ts:11` now narrows `RiskResult.riskLevel` to the literal `"LOW"` and always returns it (`backend/src/risk/riskEngine.ts:47`). The deterministic formula and the disclaimer are unchanged and remain stated in the response. `319e240b`.
12. **The swap screen is one component. CLOSED.** `frontend/src/App.tsx` is 30 lines and holds only the router and the five routes. State and flows moved to `frontend/src/hooks/` (`useWallet`, `useProtectedQuote`, `usePolicy`, `useExecution`, `useProtocol`, `useTokenBalance`, `useBackendHealth`, `useActivityFeed`), with pages under `frontend/src/pages/` and context under `frontend/src/context/TradeContext.tsx`. `strict` is enabled in `frontend/tsconfig.app.json`. Policy JSON is parsed and validated before use. `protectedQuote.ts` and `protectedQuote.test.mjs` were deliberately kept unchanged so the execute gate semantics did not move. `1e15a5b4`, `47d6b5eb`, `ce17b1a0`.
13. **Risk preview and the wallet balance describe a different action than execution. CLOSED.** Trade is now one primary button that goes check, then sign, then execute, instead of two independent controls with separate readiness rules (`frontend/src/pages/TradePage.tsx:206`). The pay field shows the selected input token's ERC-20 balance with a Max button, and for ETH that is the WETH balance with an inline note (`frontend/src/components/SwapInputs.tsx:55`, `frontend/src/components/SwapInputs.tsx:106`, `frontend/src/pages/TradePage.tsx:197`). Quote freshness is computed from the quote timestamp at click time and re-checked before signing and before execution (`frontend/src/hooks/usePolicy.ts:278`, `frontend/src/hooks/useExecution.ts:140`). The Network page parses the health body rather than rendering the monitor object, so the last checked block is a number. `1e15a5b4`, `8f20d36c`.
14. **CI runs Foundry and skips the TypeScript apps. CLOSED.** `.github/workflows/test.yml` now has `frontend` and `backend` jobs alongside `check`, each running `npm ci` then `npm test`, and build, plus `npm run lint` on the frontend. `ce17b1a0`.
15. **Compiled backend output is tracked. CLOSED.** All 23 `backend/dist` files were removed from tracking, `.gitignore:5` now carries `backend/dist/`, and `backend/tsconfig.json` excludes tests and the two signing scripts from emit. The backend job builds in CI. `ce17b1a0`.

### Minor

16. **Policy types and comments have drifted. OPEN.** Four `Policy` structs are still hand-copied (`src/PolicyRegistry.sol:5`, `src/PolicyVerifier.sol:8`, `src/MEVShieldHook.sol:40`, `src/MEVShieldRouter.sol:30`). The hook header still says `Week 3` (`src/MEVShieldHook.sol:16`), and the router still declares `InvalidCallback` and `NativeCurrencyNotSupported` without using them (`src/MEVShieldRouter.sol:48`).
17. **Route behavior is untested. PARTIAL.** `backend/src/server.test.ts` now imports `createApp` and covers `/health` monitor block exposure, `/risk-preview`, the 503 gate with and without a body, invalid JSON, validation-before-signing, the demo minimum rule, and out-of-range sqrt price. `319e240b`, `82811b8e`. What remains open is that `generatePolicy` still has no direct unit test. `backend/src/risk/riskEngine.test.ts` is now named cases rather than a loose assert script.
18. **EIP-712 types are copied in three backend modules. OPEN.** `backend/src/signer/policySigner.ts:9`, `backend/src/signer/testSigner.ts:72`, and `backend/src/signer/verifyApiSignature.ts:24` each still declare the field list by hand. `getPolicyTypes()` exists but the scripts do not use it.
19. **The documented frontend environment points at production. CLOSED.** `frontend/.env.example` now sets `VITE_API_URL=http://localhost:4000`, matching the code default. `ce17b1a0`. `frontend/README.md` is still the Vite template, and demo mode still needs Vite dev plus a local backend.
20. **Freshness and the restore control do not match their UI. CLOSED.** The clock is no longer only set when inspect finishes; `quoteAgeSeconds` is derived from `nowMs` and `quoteClockMs` in `frontend/src/hooks/useProtectedQuote.ts:127`, and both signing and execution recompute freshness at click time. The disabled registry restore button is gone with the old `App.tsx`, and the restore path no longer exists in the branch. `1e15a5b4`, `8f20d36c`.
21. **License and local artifacts are in the tree. OPEN.** There is still no root `LICENSE` while `src/*.sol` declares MIT. Tracked leftovers remain: `frontend/src/App.tsx.before-swap-label-fix`, `script/ApproveSepoliaPermit2.s.sol.bak`, the empty root file `50`, the `anvil-state` and `.anvil-state/state.json` files.
22. **`docs/` was gitignored while one assignment stayed tracked. OPEN, by design.** `.gitignore:14` still ignores `docs/*` and unignores `docs/reviews/`. `docs/assignments/03-product-definition.md` stays tracked. This is the intended arrangement rather than a pending fix.

### Fork verification

The gated fork suites were run at the pinned block `12011114` against public Sepolia, read only, with no key supplied. Every suite that could run without a secret passed: `SepoliaForkDeploymentVerification.t.sol` confirmed the deployed router and hook are present and wired to the right PoolManager, and the protected pool `0x9275…b602` has active liquidity. `SepoliaForkV2Router.t.sol` passed all three minimum-output cases including the exact boundary and the rollback. The legacy quote suite passed against its own older deployment.

Those passes do not prove the deployed stack. `SepoliaForkV2Router.t.sol` deploys its own router in `setUp` (`test/SepoliaForkV2Router.t.sol:79`) and etches fresh hook code onto a different address (`test/SepoliaForkV2Router.t.sol:86`), so it exercises the implementation, not `0x6332…150D` and `0xd15E…0080`. The only suite that drives the live router, hook, verifier, registry, and protected pool together is `test/SepoliaForkDeploymentAExecution.t.sol`, and both of its tests are blocked in `setUp` on `SIGNER_PRIVATE_KEY`.

The UI execute gate therefore correctly stays closed. `canExecute` still depends on `minimumOutputProtocolVerified`, which is still `false` in `frontend/.env.example`. Flipping it would rest on inference rather than a passing deployed-stack execution. Full detail is in `docs/reviews/2026-10-28-router-bytecode-investigation.md`.

### Router investigation outcome

`protectedPoolId()` and `protectedHook()` never existed. Their selectors are absent from the deployed runtime at `0x6332…150D`, direct calls revert, and `git grep` finds no such symbols in committed source at `HEAD` or `ae3cc4f`.

After stripping the CBOR metadata tail and masking the `poolManager` immutable, the deployed runtime matches the `HEAD` build and the `ae3cc4f` build. It does not match the build at `027c927`, the commit recorded in the deployment broadcast. The broadcast record is stale relative to the bytecode that is actually on chain.

Any brief that describes `protectedPoolId()` or `protectedHook()` as getters on the deployed router is incorrect. Callers that need the pool id or hook address must read them from configuration. The addresses in `frontend/src/lib/contracts.ts` and the backend config match the live deployment.
