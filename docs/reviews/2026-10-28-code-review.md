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
