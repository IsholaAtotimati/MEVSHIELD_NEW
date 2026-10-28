# Testing

Three test suites, run separately. Forge covers the contracts. `node:test` covers the backend. `node:test` also covers four frontend modules: the two quote and API-validation helpers, the base-unit formatter, and the policy lifetime constants. There is no end-to-end test and no browser test.

CI runs all three: a Foundry job, a frontend job and a backend job ([.github/workflows/test.yml](../../.github/workflows/test.yml)).

## Summary

| Suite | Command | Location | Cases | Needs network |
| --- | --- | --- | --- | --- |
| Contracts | `forge test` | `test/*.t.sol` | 100 `test_` functions across 10 files | No, except the five gated fork suites |
| Backend | `npm test` in `backend` | `backend/src/**/*.test.ts` | 68 cases across 10 files | No |
| Frontend | `npm test` in `frontend` | `frontend/src/**/*.test.mjs` | 35 cases across 4 files | No |

The Forge total counts `test_` functions only; fork suites that skip in `setUp` are included in the count because the function still exists. A plain `forge test` reports `88 tests passed, 0 failed, 5 skipped (93 total tests)`: the five gated fork suites report a single skip each because the skip happens in `setUp` before any test function runs.

Per-file Forge counts: `PolicyAuthorization.t.sol` 24, `PolicyRegistry.t.sol` 21, `PolicyVerifier.t.sol` 18, `MEVShieldIntegration.t.sol` 15, `MEVShieldHook.t.sol` 10, `SepoliaForkCurrentPoolQuote.t.sol` 4, `SepoliaForkV2Router.t.sol` 3, `SepoliaForkDeploymentAExecution.t.sol` 2, `SepoliaForkQuote.t.sol` 2, `SepoliaForkDeploymentVerification.t.sol` 1.

Running the backend and frontend suites gives 68 and 35 passing cases respectively. Neither suite reaches the network.

## Contracts: Forge

```
forge build
forge fmt --check
forge test
forge test -vvv
```

The compiler is pinned to `solc_version = "0.8.26"` and `evm_version = "cancun"` with `optimizer_runs = 1` and `via_ir = true` ([foundry.toml](../../foundry.toml#L1)). A build from a clean checkout is reproducible with respect to the compiler settings, which matters for the bytecode comparisons recorded in `docs/reviews/2026-10-28-router-bytecode-investigation.md`.

### Suites

| File | Covers |
| --- | --- |
| `test/PolicyRegistry.t.sol` | Registration validation, deterministic policy ids, nonce reuse, registrar rotation, consumer authorisation, expiry, double consumption |
| `test/PolicyVerifier.t.sol` | Signature validity, tampering with each of the ten fields, domain separation across chain and verifying contract, signer rotation invalidating old signatures |
| `test/PolicyAuthorization.t.sol` | Registration through the authorization contract, signature and record mismatch, nonce consumption, rollback after a reverted swap, state unchanged on every failure path |
| `test/MEVShieldHook.t.sol` | Hook checks in isolation against a stub authorization, including a named threat-model test that the loss and fee caps compare caller-supplied values |
| `test/MEVShieldIntegration.t.sol` | All five contracts against a real v4 `PoolManager`, including the router minimum-output check in both directions, the tick distance in both directions, a zero-distance rejection, native ETH settlement with a refund, and rejection of unexpected ETH |
| `test/SepoliaForkV2Router.t.sol` | Gated. Router and hook behaviour against the live Sepolia PoolManager and protected pool |
| `test/SepoliaForkCurrentPoolQuote.t.sol` | Gated. Same shape as the V2 suite, plus a parameterised quote test |
| `test/SepoliaForkDeploymentVerification.t.sol` | Gated. Read-only checks that the deployed router, hook, PoolManager wiring and protected pool match expectations and have liquidity |
| `test/SepoliaForkDeploymentAExecution.t.sol` | Gated. Drives the live router, hook, verifier, registry and pool together. Requires a signer key |
| `test/SepoliaForkQuote.t.sol` | Gated. Legacy quote path against an older deployment |

### Gated fork suites

All five fork suites are off by default. Each one calls `vm.skip(true)` in `setUp` unless its flag is set, so a plain `forge test` reports them as skipped rather than failing.

| Flag | Suite | Extra requirements |
| --- | --- | --- |
| `RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION` | `SepoliaForkDeploymentVerification.t.sol` | `SEPOLIA_FORK_BLOCK_NUMBER` optional |
| `RUN_SEPOLIA_FORK_DEPLOYMENT_A_EXECUTION` | `SepoliaForkDeploymentAExecution.t.sol` | `SIGNER_PRIVATE_KEY`, and a pinned block is advisable |
| `RUN_SEPOLIA_FORK_V2` | `SepoliaForkV2Router.t.sol` and `SepoliaForkCurrentPoolQuote.t.sol` | `--fork-url` |
| `RUN_SEPOLIA_FORK_QUOTE` | `SepoliaForkQuote.t.sol` | `--fork-url`, optional amount overrides |

Example:

```
export PATH="$HOME/.foundry/bin:$PATH"
RPC=https://ethereum-sepolia-rpc.publicnode.com
BLOCK=12011114

RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION=true SEPOLIA_FORK_BLOCK_NUMBER=$BLOCK \
forge test --fork-url $RPC --fork-block-number $BLOCK \
  --match-path test/SepoliaForkDeploymentVerification.t.sol -vvv
```

### The V2 fork suite does not test the deployed router

`SepoliaForkV2Router.t.sol` does not exercise the router at `0x6332…150D` or the hook at `0xd15E…0080`. In `setUp` it deploys a new `PolicyRegistry`, `PolicyVerifier`, `PolicyAuthorization` and `MEVShieldRouter`, and then etches fresh hook code onto the already-deployed hook address ([test/SepoliaForkV2Router.t.sol:75](../../test/SepoliaForkV2Router.t.sol#L75) to [test/SepoliaForkV2Router.t.sol:88](../../test/SepoliaForkV2Router.t.sol#L88)).

What it therefore proves: the current router and hook source behaves correctly against the real Sepolia PoolManager and the real protected pool's liquidity.

What it does not prove: that the code at the deployed router and hook addresses is the code in this repository, or that the deployed authorization and registry are wired the way the test wires its fresh instances.

The only suite that drives the live router, hook, verifier, registry and pool together is `test/SepoliaForkDeploymentAExecution.t.sol`, and it is gated on `SIGNER_PRIVATE_KEY`. Without that key supplied, it is blocked in `setUp` and cannot run.

This distinction is the reason the UI execute gate stays closed. A passing V2 suite is evidence about the implementation, not about the deployment. See [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).

## Backend: node:test

```
cd backend
npm ci
npm test
```

The script enumerates all ten test files explicitly ([backend/package.json](../../backend/package.json#L6)). A new test file must be added to that list or it will not run.

| File | Cases | Covers |
| --- | --- | --- |
| `config/runtimeConfig.test.ts` | 21 | Demo mode gating on `NODE_ENV` and Railway, router and verifier pinning and alias precedence, pool id derivation and mismatch rejection, currency ordering, fee and tick spacing, missing values, signer optional when signing is off, signer mismatch, and that validation messages never echo the key |
| `config/env.test.ts` | 5 | The shared alias resolver: ignores unset, empty and whitespace-only values, and asserts precedence for the router, verifier, RPC, registry and hook variables |
| `policy/eip712.test.ts` | 6 | Reads the `POLICY_TYPEHASH` literal out of `src/PolicyVerifier.sol` and asserts the off-chain type string, derived hash, pinned hash, field order, and domain name and version all match the Solidity source |
| `policy/policyRequest.test.ts` | 7 | Schema acceptance for the configured pool, rejection of pool-key or chain overrides through unknown properties, unconfigured pool ids, missing or zero or malformed minimum output, zero and malformed amounts, expired and far-future expiries, out-of-range sqrt price |
| `policy/policySigning.test.ts` | 3 | No signer invocation for a foreign pool, signing for the configured pool, and that `minAmountOut` is part of the digest |
| `risk/riskEngine.test.ts` | 3 | Positive amounts, negative amounts, and zero |
| `risk/riskPreview.test.ts` | 5 | Request acceptance and rejection, zero amount, deterministic output for a valid amount, and that a negative amount gives the same absolute-based estimate |
| `observability/requestCorrelation.test.ts` | 1 | Case-insensitive correlation and clearing |
| `monitor/sepolia.test.ts` | 4 | Malformed optional router aborts before any RPC call, missing optional router still scans, wrong chain stops after `eth_chainId` only, and a correct chain issues `eth_getLogs` against the configured registry and hook with both topics |
| `server.test.ts` | 13 | `/health` exposes the monitor block, `/risk-preview` metadata, the 503 gate with and without a body, invalid JSON produces 400, validation runs before signing, `minAmountOut` of 1 is rejected outside demo, an out-of-range sqrt price is rejected before signing, error bodies carry a stable code and request id, validation errors keep the `error` string and add `details` plus `code`, invalid JSON uses `invalid_json` without leaking details, unknown routes answer with the typed 404 body, and successful bodies keep their existing shape |

The monitor tests spawn a child process with a stub JSON-RPC server rather than mocking the module, so they exercise the real provider path ([backend/src/monitor/sepolia.test.ts:8](../../backend/src/monitor/sepolia.test.ts#L8)).

Coverage gaps that matter:

- `generatePolicy` has no direct test.
- No test runs a successful `/policy` request end to end with a signer, so the signing branch of the route is untested through HTTP.
- No test covers `/observability/transaction`. Its schema is exercised only indirectly.
- No test covers `/config/protected-pool` through HTTP, though the underlying function is covered.

## Frontend: node:test

```
cd frontend
npm ci
npm test
```

Four `.mjs` files, run with type stripping. They import the TypeScript modules directly, so the tested code is the same code the app bundles for those modules.

| File | Cases | Covers |
| --- | --- | --- |
| `src/lib/protectedQuote.test.mjs` | 18 | Minimum output in exact base units with bounded slippage, demo estimate, currency sorting and direction resolution, human amount parsing, pool id and pool key rejection, wrong chain, wrong hook and missing hook code, stale state, uninitialised pool, zero liquidity, the always-unavailable quote outcome, RPC failure handling, readiness with no quote, stale available quote, demo readiness, backend pool-key verification gating, the deployment-verified gate, the demo bypass path, and full backend pool-key field comparison |
| `src/lib/apiValidation.test.mjs` | 5 | `/health` monitor parsing including a monitor that has not scanned yet, dropping a malformed monitor, and rejecting non-health bodies |
| `src/lib/format.test.mjs` | 8 | `formatBaseUnits` rendering backend decimal strings at full precision, keeping an exact bound rather than truncating, and dashing missing or malformed values; symbol suffixing; the legacy truncating formatter; `shortAddress`; and `apiErrorMessage` reading a backend error string or falling back on a non-envelope body |
| `src/config/policy.test.mjs` | 4 | `POLICY_TTL_SECONDS` stays below the mirrored `POLICY_MAX_TTL_SECONDS`, `buildPolicyExpiry` produces a future expiry inside the ceiling, a fractional clock reading floors correctly, and the derivation depends only on the supplied clock |

The readiness suite deliberately tests readiness as a pure function of its inputs. It constructs `available` quotes directly, which runtime code cannot produce, so it verifies the gate logic rather than the ability to obtain a quote.

`src/config/policy.test.mjs` is the drift guard for the policy lifetime. It asserts that the TTL the UI requests stays strictly below the frontend's copy of the backend ceiling, and that the derived expiry is in the future. It cannot see the backend constant, so it catches a mistake inside the frontend but not a change to `POLICY_MAX_TTL_SECONDS` in `backend/src/policy/policyRequest.ts` that leaves the mirror stale.

Coverage gaps that matter:

- No test for `usePolicy`, `useExecution`, `useProtocol`, `useWallet`, `useTokenBalance`, `useActivityFeed` or `useBackendHealth`.
- No test for `policyMatch`, `telemetry`, `activityStorage`, `policyDefaults` or `observability`.
- No test binds `POLICY_MAX_TTL_SECONDS` in the frontend to the backend constant. The two values are kept in step by review, and only the frontend copy is asserted.
- No component tests and no DOM tests.
- No test asserting that a policy created for one amount cannot be executed for another; that logic lives in `useExecution` and is untested directly.

## CI

Three jobs, all with `contents: read` and `persist-credentials: false` ([.github/workflows/test.yml](../../.github/workflows/test.yml)).

| Job | Steps |
| --- | --- |
| `check` | `forge --version`, `forge fmt --check`, `forge build --sizes`, `forge test -vvv` |
| `frontend` | `npm ci`, `npm test`, `npm run lint`, `npm run build` |
| `backend` | `npm ci`, `npm test`, `npm run build` |

No job runs a fork suite, because none sets a `RUN_SEPOLIA_FORK_*` flag and no job supplies an RPC URL. Fork coverage is therefore manual only.

The Foundry job does not set `FOUNDRY_PROFILE`, and `foundry.toml` has no `[profile.ci]` section, so CI uses the default profile, which is the pinned one.

## What the suites do not cover

- Fuzz and invariant tests. There is no `testFuzz_` or `invariant_` function in `test/`.
- Custom-error selector assertions. Several reverts are checked with a bare `vm.expectRevert()`.
- A runtime codehash comparison between a deployed address and the local build artifact.
- Anything at browser level: wallet interaction, routing, rendering, or the readiness checklist.
- The live stack with a signer, unless a key is supplied to the gated execution suite.

## Related pages

- [Configuration](configuration.md) for the variables named above.
- [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).
- [Contracts](../architecture/contracts.md).
