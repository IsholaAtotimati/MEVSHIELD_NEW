# Router bytecode investigation (Sepolia `0x6332…150D`)

Branch: `fix/router-source-of-truth` (original investigation); carried to `fix/audit-defects` for the precision corrections below  
Date: 28 October 2026  
RPC: `https://ethereum-sepolia-rpc.publicnode.com`  
Forge: `1.8.6` (solc `0.8.26+commit.8a97fa7a`, EVM `cancun` from HEAD artifact metadata)

The commit ids in this note are the ones the investigation named. `feature/sepolia-fork-demo` later reworded its own history. The same trees on that branch are listed in the [changelog](changelog-since-8a676f6d.md). `fix/router-source-of-truth` was not moved.

## Hypothesis (from EAE brief)

The deployed router was built from Lukman's uncommitted tree and exposes `protectedPoolId()` / `protectedHook()`, while committed source does not — so bytecode and repo disagree.

## On-chain proof

| Check | Result |
| --- | --- |
| `cast code 0x633282608B2fc66cD7572f5eF58e804063aa150D` | 5667 bytes → `docs/reviews/deployed-router-6332.hex` |
| Selector `protectedPoolId()` → `0xf976fd28` | **Absent** in runtime bytecode |
| Selector `protectedHook()` → `0x3ff8d5e4` | **Absent** in runtime bytecode |
| Selector `poolManager()` → `0xdc4c90d3` | **Present** |
| `cast call … poolManager()` | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` (matches deploy broadcast) |
| `cast call … protectedPoolId()` | **Reverts** (no function) |
| `cast call … protectedHook()` | **Reverts** (no function) |

Committed source at `ae3cc4f` also has **no** `protectedPoolId` / `protectedHook` symbols, and neither does the `319e240` tree that was checked out for the comparison (`git grep` empty at both refs).

## Bytecode comparison (CBOR stripped + `poolManager` immutables masked)

Rerun:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
node script/compare-router-bytecode.mjs docs/reviews/deployed-router-6332.hex \
  out/MEVShieldRouter.sol/MEVShieldRouter.json \
  /path/to/027c927/out/MEVShieldRouter.sol/MEVShieldRouter.json \
  /path/to/ae3cc4f/out/MEVShieldRouter.sol/MEVShieldRouter.json
```

Machine-readable output: `docs/reviews/router-bytecode-comparison.json`.

| Git ref | Router runtime bytecode (bytes) | Raw match deployed | Normalized match deployed |
| --- | ---: | --- | --- |
| `HEAD` at the time of the run, commit `319e240` (backend/UI alignment; not an ancestor of this branch) | 5667 | No (metadata + immutables) | **Yes** |
| `ae3cc4f` (22 Oct router work) | 5667 | No | **Yes** |
| `027c927` (broadcast-recorded commit) | 3029 | No | **No** (logic differs from day-one deploy) |

The column holds the length of the compiled runtime bytecode, not the size of `src/MEVShieldRouter.sol`. The sources for these builds are 9606 bytes at `ae3cc4f` and 5876 bytes at `027c927`. The `HEAD` row records the commit that was checked out when the comparison ran; it is named by its role rather than offered as an ancestor of this branch, because `319e240` is reachable from `feature/web-app-redesign` and not from `fix/router-source-of-truth`.

**Interpretation:** The live router matches the **post-`ae3cc4f` router implementation** (same normalized runtime as the build from the source checked out at `319e240`), not the smaller router at `027c927`. The broadcast file's recorded git commit (`027c927`) is **stale relative to the bytecode actually deployed** on 22 October. Lukman's WIP branch was **not** available for comparison.

Raw hex length matched deployed vs the `319e240` build (5667 bytes each), so the deployed runtime is the same size as that build. Masking is not an explanation for any length difference: stripping the CBOR metadata shortens both sides of a comparison and masking immutables overwrites bytes in place without changing the total, and the comparison script measures both lengths before either operation. If Lukman observed a genuine length mismatch, it came from a different artifact or a different source tree, not from comparing an unmasked build against a masked one.

## Verdict on hypothesis

| Claim | Verdict |
| --- | --- |
| Getters exist on deployed router | **Denied** (selectors absent; calls revert) |
| Getters exist only in uncommitted source | **Not proven**; committed + deployed both lack getters |
| Deployed bytecode ≠ committed source | **Partially denied** — normalized runtime matches `ae3cc4f` and the `319e240` build |
| Deployed from exact `027c927` tree | **Denied** — normalized mismatch vs `027c927` build |

Root cause for frontend/script callers of `protectedPoolId()` / `protectedHook()`: **those functions were never part of the deployed or committed router ABI**; any caller expecting them must use config (pool id, hook address) or the getters must be added, tested, and the router **redeployed**.

## Recommended fix (no redeploy in this branch)

1. **Short term (no new deploy):** Remove or guard all off-repo callers of the two getters; read protected pool id and hook from env / `frontend/src/lib/contracts.ts` (and backend config) — same addresses already used for deployment verification.
2. **Product path (Lukman):** If on-chain getters are required, add `protectedPoolId()` and `protectedHook()` to `src/MEVShieldRouter.sol` with tests, redeploy via `script/DeploySepolia.s.sol` from a clean tree, update broadcast + Etherscan verify, then run fork tests and re-enable the execute gate on the UI branch.

## Blockers for Lukman

- Push `wip/deployed-router` (or similar) if local source still differs from `ae3cc4f` or the `319e240` build.
- Redeploy + verify router if getters are required on-chain (needs deployer key; not done here).
- Run `SepoliaForkDeploymentVerification.t.sol` and `SepoliaForkV2Router.t.sol` against Sepolia after any redeploy.
- Confirm who still calls `protectedPoolId()` / `protectedHook()` outside this repo (scripts, frontend branch, wallet demos).

## Artifacts in this commit

- `docs/reviews/deployed-router-6332.hex`
- `docs/reviews/router-bytecode-comparison.json`
- `script/compare-router-bytecode.mjs`
- `foundry.toml` — pinned `solc_version` / `evm_version`

## Fork verification (28 October 2026)

Run on `fix/router-source-of-truth` at `2f1080eb` with a clean working tree. Read-only against public
Sepolia: **no transaction was signed, sent, or broadcast**, and no private key was supplied to any
command. Fork pinned at block `12011114`.

Toolchain, from `out/MEVShieldRouter.sol/MEVShieldRouter.json` metadata: `solc 0.8.26+commit.8a97fa7a`,
`evmVersion: cancun`, forge `1.8.6`.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
RPC=https://ethereum-sepolia-rpc.publicnode.com
BLOCK=12011114
```

### Baseline, no fork

| Command | Result |
| --- | --- |
| `forge build` | **Pass**, exit 0. Warnings only (forge-lint: unused return values, unsafe typecast in `src/MEVShieldRouter.sol`, `vm.warp` lint in `test/PolicyRegistry.t.sol`). No errors. |
| `forge test` | **Pass**. 10 suites, **88 passed, 0 failed, 5 skipped** (93 total). |

The 5 skips are the env-gated fork suites, which is their intended default-off behaviour. The pinned
`solc_version`/`evm_version` did not break anything.

### `test/SepoliaForkDeploymentVerification.t.sol`

Ungated, the suite skips in 1.21s because `RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION` is unset.

```bash
RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION=true SEPOLIA_FORK_BLOCK_NUMBER=$BLOCK \
forge test --fork-url $RPC --fork-block-number $BLOCK \
  --match-path test/SepoliaForkDeploymentVerification.t.sol -vvv
```

| Test | Result |
| --- | --- |
| `test_currentDeploymentAndProtectedPoolMatchExpectedConfiguration` | **PASS** (gas 72138) |

Observed: pool ID `0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602`, sqrtPriceX96
`1617238095152076543778314735768381`, tick `198487`, protocol fee `0`, LP fee `3000`, active liquidity
`1541399567004`.

**Scope:** this test *reads* the deployed router `0x6332…150D` (asserts code exists and
`poolManager()` returns the PoolManager) and the deployed hook `0xd15E…0080` (`authorization()` exists
and recognizes the hook). It **does not execute a swap through the deployed router.** It proves the
deployment is present, correctly wired, and that the protected pool has liquidity.

### `test/SepoliaForkV2Router.t.sol`

Ungated, the suite skips; `RUN_SEPOLIA_FORK_V2` is unset.

```bash
RUN_SEPOLIA_FORK_V2=true \
forge test --fork-url $RPC --fork-block-number $BLOCK \
  --match-path test/SepoliaForkV2Router.t.sol -vvv
```

| Test | Result | Observed |
| --- | --- | --- |
| `test_V2RouterEnforcesMinimumOutputForWethToUsdc` | **PASS** (gas 781124) | `2082949` micro-USDC out vs signed minimum `1` |
| `test_V2RouterEnforcesMinimumOutputForUsdcToWeth` | **PASS** (gas 806212) | `328454558298340` wei out vs signed minimum `1` |
| `test_V2RouterEnforcesExactMinimumBoundaryAndRollsBackNonce` | **PASS** (gas 2177034) | quote `2082949`; minimum equal to actual output succeeds; one unit above reverts `MinimumOutputNotMet`; nonce, WETH and USDC roll back |

Suite: 3 passed, 0 failed, 0 skipped.

**Scope, and this matters for the gate question:** this suite does **not** exercise the deployed router
or the deployed hook. `setUp` does `router = new MEVShieldRouter(manager)` (a fresh deployment in fork
state) and `vm.etch(HOOK, address(implementation).code)` onto `0xd8aE178f…C080`, which is *not* the
live hook `0xd15E…0080`. It then trades against pool `0x37d2…7c78`, not the protected pool `0x9275…b602`.
`grep` confirms the file never references `0x6332…150D` or `0xd15E…0080`. What it does prove is that
the **current router/hook/policy implementation** enforces the signed minimum against real PoolManager
and real Sepolia pool state.

### Supplementary fork suites, not required by the brief

Run for completeness. Both are gated the same way.

```bash
RUN_SEPOLIA_FORK_QUOTE=true \
forge test --fork-url $RPC --fork-block-number $BLOCK \
  --match-path test/SepoliaForkQuote.t.sol -vvv
```

| Test | Result | Observed |
| --- | --- | --- |
| `test_QuoteOnly_LegacyDeployedRouterOnSepoliaFork` | **PASS** (gas 727713) | `1e15` wei WETH in, `2888661` micro-USDC out, exact input fully consumed |
| `test_QuoteOnly_ReverseLegacyRouteOnSepoliaFork` | **PASS** (gas 1191300) | `100e6` micro-USDC in, `908511578555252` wei WETH out |

This suite targets an **older, separate deployment**: router `0xE5752567…3bba` (3029 bytes), hook
`0xd8aE178f…C080`, verifier `0x9DF6c29b…7544`. On chain at block `12011114`, verifier `0x9DF6…`
returns `POLICY_TYPEHASH` `0xd8be789417c1a86fc9ed80b5538ea5966dabbcdee4b9bab1ed51980cb4f34b75`, the
legacy 9-field schema without `minAmountOut`, which matches the constant the test asserts
(`test/SepoliaForkQuote.t.sol:129`). So these passes validate the legacy stack, not `0x6332…150D`.

```bash
RUN_SEPOLIA_FORK_V2=true \
forge test --fork-url $RPC --fork-block-number $BLOCK \
  --match-path test/SepoliaForkCurrentPoolQuote.t.sol -vvv
```

| Test | Result | Reason |
| --- | --- | --- |
| all (fails in `setUp`) | **FAIL** | `pool has no active liquidity` |

Hard-coded hook `0x5446D8C7568fC9bb9e699Ae94CFD47533118C080` / pool
`0xac5918607a0235904ea5157e2e63254350401fb21881136c3c7069db7c0a65f7`. Read-only check at block
`12011114`: slot0 is initialized (`0x0bb8000000f2761800000000000000000000000000000001000276a4`) but the
liquidity word is `0`, i.e. the pool exists with no active liquidity. This is stale test data pointing
at a superseded pool, not a regression in `src/`.

```bash
RUN_SEPOLIA_FORK_DEPLOYMENT_A_EXECUTION=true SEPOLIA_FORK_BLOCK_NUMBER=$BLOCK \
forge test --fork-url $RPC --fork-block-number $BLOCK \
  --match-path test/SepoliaForkDeploymentAExecution.t.sol -vvv
```

| Test | Result | Reason |
| --- | --- | --- |
| `test_deployedPolicyCanAuthorizeProtectedSwap` | **BLOCKED** | `vm.envUint: environment variable "SIGNER_PRIVATE_KEY" not found` (in `setUp`) |
| `test_impossibleMinimumOutputRevertsAndRollsBack` | **BLOCKED** | same `setUp` failure |

Reported as blocked, not failed: the suite requires the private key of the live authorized signer
`0x016B78a30CE176EF0B90c122e8677e13aAB2A815` so it can sign a policy and register it. Per the
engagement rules no key was supplied. Note it only signs and registers inside fork state, so even with
the key nothing would be broadcast; it still cannot run without the secret.

**This is the only suite that executes a protected swap through the actually-deployed router
`0x6332…150D` and the actually-deployed hook `0xd15E…0080`, against the protected pool `0x9275…b602`,
with the live verifier `0x716f…b79f` and registry `0xB289…1c9E`.** It is blocked.

### Live deployment wiring, read-only `cast call` at block `12011114`

| Call | Value |
| --- | --- |
| `hook.authorization()` on `0xd15E…0080` | `0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5` |
| `authorization.registry()` | `0xB2897da1CfC0c73C3983221a87C27586D1cE1c9E` |
| `authorization.verifier()` | `0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f` |
| `verifier.authorizedSigner()` | `0x016B78a30CE176EF0B90c122e8677e13aAB2A815` |
| `authorization.authorizedHook()` | `0xd15E4fDD391a68C2F1C385d1a819117a3aD40080` |
| live `verifier.POLICY_TYPEHASH()` on `0x716f…b79f` | `0x274faee7fd43329c5c5ae4722f876248b6c299b0cde79a77d1d78f3f49af60c1` |
| keccak of type string **with** `minAmountOut` | `0x274faee7…60c1`, **matches** |
| keccak of type string **without** `minAmountOut` | `0xd8be789417c1a86fc9ed80b5538ea5966dabbcdee4b9bab1ed51980cb4f34b75`, no match |

The live protected stack is on the v2 10-field schema that includes `minAmountOut`, and its addresses
agree exactly with `frontend/src/lib/contracts.ts` on `feature/web-app-redesign`. Deployed router
runtime at `0x6332…150D` measured 5667 bytes on this pass, matching the figure in the comparison
section above.

### Does this unblock the UI execute gate?

**No.** It narrows the objection but does not satisfy it.

`canExecute` in `frontend/src/lib/protectedQuote.ts` is
`canCheckRisk && policyBoundsVerified`, and `canCheckRisk` includes
`minimumOutputProtocolVerified`, which is wired to `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED`
(`frontend/src/config/env.ts:7`), still `false` in `frontend/.env.example`.

Grounds now established by fork evidence:

- The deployed router `0x6332…150D` is present, wired to the right PoolManager, and normalized-matches the
  committed implementation (earlier section of this document).
- The protected pool `0x9275…b602` is initialized with active liquidity `1541399567004`.
- The **current implementation** of router and hook enforces the signed minimum output, including the
  exact boundary and rollback on violation, against real PoolManager and real Sepolia pool state.
- The live verifier signs the v2 schema that includes `minAmountOut`.

What is still missing before flipping the gate is defensible:

1. **No fork test has executed a swap through the deployed router `0x6332…150D`.** The two suites the
   brief names each cover a different thing: deployment wiring reads, and a locally-deployed router
   against an etched hook at an old address. The one suite that does execute against the live stack,
   `SepoliaForkDeploymentAExecution.t.sol`, is **blocked on `SIGNER_PRIVATE_KEY`**. Passing the V2 suite
   plus the bytecode match is a strong *inference* that `0x6332…150D` behaves the same, but it is not the
   direct execution evidence a gate flip should rest on, and the immutables were masked in the
   normalized comparison.
2. `policyBoundsVerified` depends on backend quote and registered-policy bounds, unrelated to this fork
   run and not verified here.
3. Enabling the gate is a product decision. `canExecute` semantics were deliberately not touched.

So the fork results **clear the router-does-enforce-minimum-claim** and leave the
deployed-stack execution proof blocked. They should not be cited as unblocking the gate.

### Compiler pin propagation

`feature/web-app-redesign` was missing both pins. `foundry.toml` on that branch now matches
`fix/router-source-of-truth` exactly with `solc_version = "0.8.26"` and `evm_version = "cancun"`;
`diff` against the router branch's `foundry.toml` reports no differences. Commit `8cc026a8` on
`feature/web-app-redesign`.

Verification on that branch after `forge clean`:

| Command | Result |
| --- | --- |
| `forge build` | **Pass**. `Compiling 154 files with Solc 0.8.26`, `Compiler run successful with warnings` (22 warning lines, no errors) |
| artifact metadata (`out/MEVShieldRouter.sol/MEVShieldRouter.json`) | `compiler: 0.8.26+commit.8a97fa7a`, `evmVersion: cancun`, `optimizer: {enabled: true, runs: 1}` |
| `forge test` | **Pass**. 88 passed, 0 failed, 5 skipped (93 total) |

Only `foundry.toml` changed on that branch (2 insertions); the frontend and `canExecute` semantics were
not touched.
