# Configuration

Every environment variable read by any layer, in one table per layer, with the file that reads it. Values shown in the default column are the fallback the code applies when the variable is absent, not a recommendation.

Three general rules:

- No real secret belongs in any committed file. `.env` and `.env.*` are ignored, and the tracked `.env.example` files are the only dotfiles that survive the ignore rules ([.gitignore](../../.gitignore#L24)).
- Vite inlines `VITE_*` variables into the client bundle. Anything with that prefix is public.
- The backend refuses to start on a configuration it does not recognise. See the safety note on each backend row.

## Frontend variables

Read in [frontend/src/config/env.ts](../../frontend/src/config/env.ts), [frontend/src/config/chain.ts](../../frontend/src/config/chain.ts) and [frontend/src/config/chainEnv.ts](../../frontend/src/config/chainEnv.ts). Documented example: [frontend/.env.example](../../frontend/.env.example).

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `VITE_API_URL` | required for deployment | `http://localhost:4000` in Vite development; unset in production | Base URL for every backend call | Public. Must be reachable from the browser and allowed by the backend CORS origin. Set it to the Railway public URL for Vercel; no production localhost fallback exists |
| `VITE_SEPOLIA_DEMO_MODE` | optional | unset, treated as false | Requests demo mode | Only takes effect in a Vite dev build (or local chain 31337). Demo mode substitutes a fixed estimate, bypasses v2 deployment verification, and signs a 1-base-unit minimum output. Never use for value-bearing trades |
| `VITE_READ_ONLY_DEMO_MODE` | optional | unset, treated as false | Enables the hosted estimate and risk-preview demo | Only applies to production Sepolia bundles. It disables policy signing and execution, does not verify deployments, and must not be used to imply protected execution |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` | optional | unset, treated as false | Opens the normal readiness gate for signing and execution | Setting this to true should only follow a live-stack fork test. Explicit demo mode is a development-only exception and does not provide minimum-output protection. See [ADR 0005](../decisions/0005-execute-gate-stays-closed.md) |
| `VITE_CHAIN_ID` | optional | `11155111` | Chain the client reads and asks the wallet to switch to | Only decimal digits are accepted. A malformed value falls back to Sepolia rather than becoming the local chain. Set to `31337` for the local stack |
| `VITE_RPC_URL` | optional | public Sepolia RPC, or `http://localhost:8545` on the local chain | Read RPC endpoint | Unauthenticated and inlined into the bundle, so never put a provider key here |
| `VITE_EXPLORER_URL` | optional | `https://sepolia.etherscan.io`, none locally | Block explorer base | A local chain has no explorer unless one is configured |
| `VITE_TOKEN0_ADDRESS` | required when `VITE_CHAIN_ID=31337`, optional on Sepolia | Sepolia WETH9 `0xfff9…6b14` | First pool token | **No local default.** See the note below |
| `VITE_TOKEN1_ADDRESS` | required when `VITE_CHAIN_ID=31337`, optional on Sepolia | Sepolia USDC `0x1c7D…7238` | Second pool token | **No local default.** See the note below |
| `VITE_TOKEN0_SYMBOL`, `VITE_TOKEN1_SYMBOL` | optional | `WETH` / `USDC`, or `MBA` / `MBB` locally | Display labels | Cosmetic only; they change no address and open no gate |
| `VITE_*_ADDRESS` (contracts) | optional | Sepolia deployment, or the deterministic local deployment | Overrides for `lib/contracts.ts` | Display and read targets only. Changing them does not open the execute gate |
| `VITE_*` build mode | implicit | `development` in dev, `production` in build | Logged as `environment` in frontend log lines | Not set directly; derived from the Vite mode |

### Local deployment addresses are required, not defaulted

The local chain has **no** built-in pool token addresses. `script/SetupBackendSwap.s.sol` deploys a fresh mock pair to anvil, so any compiled-in local address could only be a guess about a chain the build has not seen. A wrong address in a swap app reads and trades against nothing and fails silently, which is worse than a missing one.

So for a local build (`VITE_CHAIN_ID=31337`):

- `VITE_TOKEN0_ADDRESS` and `VITE_TOKEN1_ADDRESS` must be supplied from the deploy output. `docker-compose.yml` injects both as build args ([docker-compose.yml:229](../../docker-compose.yml#L229)), and `script/docker-deploy-local.sh` prints the values that must match them.
- Omitting either one is an explicit configuration error. Resolution returns an `unconfigured` state naming the missing variables ([frontend/src/config/chainEnv.ts](../../frontend/src/config/chainEnv.ts)), never a zero address and never a fallback.
- The UI then reports the app as not ready and renders the message. Signing and execution stay disabled. The bundle still loads, so the failure is readable instead of a blank page or a crash at import time.

Sepolia is unaffected: with no environment at all, a build resolves to chain `11155111` and the published WETH9 / USDC addresses. That path is covered by `frontend/src/config/chainEnv.test.mjs`.

Vite exposes `import.meta.env.DEV` and `import.meta.env.MODE` from its own mode, not from the environment file ([frontend/src/config/env.ts:4](../../frontend/src/config/env.ts#L4), [frontend/src/lib/observability.ts:12](../../frontend/src/lib/observability.ts#L12)).


## Backend variables

Read in [backend/src/config/runtimeConfig.ts](../../backend/src/config/runtimeConfig.ts), [backend/src/server.ts](../../backend/src/server.ts), [backend/src/monitor/sepolia.ts](../../backend/src/monitor/sepolia.ts) and [backend/src/observability/logger.ts](../../backend/src/observability/logger.ts). Documented example: [backend/.env.example](../../backend/.env.example).

### Process

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `PORT` | optional | `4000` | Listen port, bound on `0.0.0.0` | Not validated. A non-numeric value becomes `NaN` and the listen call fails |
| `NODE_ENV` | optional | `development` | Reported in `/health` and in every log line | Must not be `production` for demo mode to be available |
| `LOG_LEVEL` | optional | `info` | Minimum level emitted | An unrecognised value falls back to `info` rather than failing |

### Chain and deployment pinning

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `CHAIN_ID` | required | none | Must equal `11155111` | Any other value throws at startup. There is no local-chain mode |
| `POLICY_VERIFIER_ADDRESS` | required, or one of the aliases | none | Verifier address | Must match the pinned verifier; conflicting aliases fail startup |
| `VERIFIER_ADDRESS` | alias | none | Second name for the verifier | Same pin applies; all configured aliases must agree |
| `POLICY_VERIFIER` | alias | none | Third name for the verifier | Same pin applies; all configured aliases must agree |
| `ROUTER_ADDRESS` | required, or the alias | none | Router address | Must match the pinned router; conflicting aliases fail startup |
| `MEVSHIELD_ROUTER` | alias | none | Second name for the router | Same pin applies; all configured aliases must agree |
| `MEVSHIELD_V2_DEPLOYMENT_VERIFIED` | optional | `false` | Enables the verified Sepolia deployment pin set | Set only after deployed addresses and pool pass the read-only migration preflight. This is an operator assertion, not an on-chain check performed by backend startup |
| `MEVSHIELD_SEPOLIA_SIGNER_ADDRESS`, `MEVSHIELD_SEPOLIA_VERIFIER_ADDRESS`, `MEVSHIELD_SEPOLIA_ROUTER_ADDRESS` | required when deployment verified | none | Replacement Sepolia signer, verifier, and router pins | Valid Ethereum addresses required; the signer key and configured contract addresses must match |
| `MEVSHIELD_SEPOLIA_REGISTRY_ADDRESS`, `MEVSHIELD_SEPOLIA_AUTHORIZATION_ADDRESS` | required when deployment verified | none | Replacement registry and authorization pins | Required and matched against the configured aliases |
| `MEVSHIELD_SEPOLIA_HOOK_ADDRESS`, `MEVSHIELD_SEPOLIA_POOL_ID` | required when deployment verified | none | Replacement pool hook and Pool ID pins | Must match the hook configured in the pool key and its recomputed Pool ID |
| `FRONTEND_URL` | optional | `http://localhost:5173` | The single allowed CORS origin | A wrong value silently blocks the browser client. It does not block non-browser clients |

### Protected pool

All six are required. A missing or malformed value throws at startup.

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `PROTECTED_POOL_CURRENCY0` | required | none | Lower-sorted currency | Must be a valid address, and must sort below `CURRENCY1` |
| `PROTECTED_POOL_CURRENCY1` | required | none | Higher-sorted currency | Must be a valid address |
| `PROTECTED_POOL_FEE` | required | none | Pool fee in hundredths of a bip | Must be a non-negative safe integer, and must be 3000 |
| `PROTECTED_POOL_TICK_SPACING` | required | none | Pool tick spacing | Same integer rules, and must be 60 |
| `PROTECTED_POOL_HOOK` | required | none | Hook address in the pool key | Must match `HOOK_ADDRESS`; with verified deployment pins it must also match `MEVSHIELD_SEPOLIA_HOOK_ADDRESS` |
| `PROTECTED_POOL_ID` | required | none | 32-byte pool id | Must match the ID recomputed from the other five values; with verified deployment pins it must also match `MEVSHIELD_SEPOLIA_POOL_ID` |

Without `MEVSHIELD_V2_DEPLOYMENT_VERIFIED=true`, the pool is additionally compared against the legacy Sepolia source pins. A replacement pool may use different hook and Pool ID pins only when the verified-deployment flag and complete replacement address set are present. Editing only one pool field still fails validation.

### Signing

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `MEVSHIELD_V2_POLICY_ENABLED` | optional | unset, treated as false | Requests policy signing | On Sepolia, both this and `MEVSHIELD_V2_DEPLOYMENT_VERIFIED=true` are required. The endpoint remains unauthenticated; do not enable before deployment and preflight |
| `SIGNER_PRIVATE_KEY` | required only when signing is enabled | none | The EIP-712 signing key | Loaded into an in-process wallet. Its derived address must equal the active signer pin. Validation errors never echo the key |
| `MEVSHIELD_SEPOLIA_DEMO_ENABLED` | optional | unset, treated as false | Enables demo signing | Requires `NODE_ENV` not `production` and `RAILWAY_ENVIRONMENT_NAME` unset. Demo mode signs a fixed 1-base-unit minimum |

### Monitor

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `SEPOLIA_RPC_URL` | required for the monitor | none | RPC endpoint | If missing along with the alias, the monitor reports `disabled` and the process still starts. Any provider key here stays server-side |
| `RPC_URL` | alias | none | Second name for the RPC | Same as above |
| `POLICY_REGISTRY_ADDRESS` | required for the monitor | none | Registry to scan | Not compared to the pinned deployment. A wrong value scans the wrong contract |
| `POLICY_REGISTRY` | alias | none | Second name for the registry | Same as above |
| `POLICY_AUTHORIZATION_ADDRESS` | required with verified deployment pins | none | Authorization contract pin | Must agree with `POLICY_AUTHORIZATION` if both are set, and with the verified authorization pin |
| `POLICY_AUTHORIZATION` | alias | none | Second name for authorization | Same as above |
| `HOOK_ADDRESS` | required for the monitor | none | Hook to scan | Not compared to the pinned deployment |
| `MEVSHIELD_HOOK_ADDRESS` | alias | none | Second name for the hook | Same as above |
| `ROUTER_ADDRESS` / `MEVSHIELD_ROUTER` | optional for the monitor | none | Router address used in `swap_confirmed` when the receipt has no `to` | A malformed value throws at startup. Reuses the same variables as the pinned router check |

`RAILWAY_ENVIRONMENT_NAME` is not set by this project. It is read only to veto demo mode, and is present on Railway deployments automatically ([backend/src/config/runtimeConfig.ts:149](../../backend/src/config/runtimeConfig.ts#L149)).

## Contract and deployment variables

Read by Foundry scripts and the gated fork tests. Foundry reads a root `.env` by default.

### Deployment

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `DEPLOYER_PRIVATE_KEY` | required by every deploy and setup script | none | Broadcast key | Never commit. `DeployLocal` and `DeploySepolia` require it explicitly; `RunProtectedSwap` defaults it to the first Anvil key |
| `SIGNER_PRIVATE_KEY` | required by `DeploySepolia` and `EnableUserPaidRegistrationSepolia` | none | Sets the authorized signer on the verifier | Must correspond to the address the backend will use. `DeployLocal` instead uses a hard-coded Anvil key |
| `POOL_MANAGER` | required by `RunProtectedSwap` and `SetupBackendSwap` | none | Existing PoolManager address | Read only |
| `MEVSHIELD_HOOK` | required by `RunProtectedSwap` and `SetupBackendSwap` | none | Existing hook address | Read only |
| `MEVSHIELD_ROUTER` | required by `SetupBackendSwap` | none | Existing router address | Read only |
| `POLICY_REGISTRY` | required by `RunProtectedSwap` and `EnableUserPaidRegistrationSepolia` | none | Existing registry | Read only |
| `POLICY_VERIFIER` | required by `RunProtectedSwap` and `EnableUserPaidRegistrationSepolia` | none | Existing verifier | Read only |
| `POLICY_AUTHORIZATION` | required by `RunProtectedSwap` | none | Existing authorization contract | Read only |

### Read-only migration preflight

Before and after a replacement deployment, run `PreflightSepoliaMigration.s.sol`
with `ROUTER_ADDRESS` (or `MEVSHIELD_ROUTER`), `HOOK_ADDRESS` (or
`MEVSHIELD_HOOK`), `POLICY_AUTHORIZATION` (or
`POLICY_AUTHORIZATION_ADDRESS`), `POLICY_REGISTRY` (or
`POLICY_REGISTRY_ADDRESS`), and `POLICY_VERIFIER` (or
`POLICY_VERIFIER_ADDRESS`) set to the candidate addresses. The script uses the
existing Sepolia PoolManager and WETH/USDC pair; optionally set
`EXPECTED_AUTHORIZED_SIGNER` and `EXPECTED_POOL_ID` to assert those values.

Run it without `--broadcast`:

```sh
forge script script/PreflightSepoliaMigration.s.sol:PreflightSepoliaMigration \
  --rpc-url "$SEPOLIA_RPC_URL"
```

It reports missing addresses, code and wiring mismatches, the calculated Pool
ID, and whether that pool is initialized with nonzero active liquidity. Before
deployment, missing candidate contracts are expected and reported as blockers.
A `READY` result is only a configuration/state preflight: it does not verify
deployed bytecode against source, prove swap execution, or open the frontend
execution gate.

For the new deployment, the following commands are **for review only**; do not
run them with `--broadcast` until deployment and funding are explicitly
authorized. Foundry loads `DEPLOYER_PRIVATE_KEY` and `SIGNER_PRIVATE_KEY` from
the root `.env`; keep both secret. The deployer must be the configured
authorized signer address.

```sh
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast -vvvv
```

After deployment, set `ROUTER_ADDRESS`, `HOOK_ADDRESS`,
`POLICY_AUTHORIZATION`, `POLICY_REGISTRY`, and `POLICY_VERIFIER` from the
deployment output. Run the preflight once to obtain the calculated Pool ID,
then set `EXPECTED_POOL_ID` to that value and run it again:

```sh
forge script script/PreflightSepoliaMigration.s.sol:PreflightSepoliaMigration \
  --rpc-url "$SEPOLIA_RPC_URL"
```

Only after reviewing the deployment output and the matching Pool ID should the
initialization command be prepared. Its `POOL_INITIAL_SQRT_PRICE_X96` must come
from a fresh, independently checked price source; do not reuse an old snapshot.
It also requires the deployment addresses above and `EXPECTED_POOL_ID`:

```sh
forge script script/InitializeSepoliaProtectedPool.s.sol:InitializeSepoliaProtectedPool \
  --rpc-url "$SEPOLIA_RPC_URL" --broadcast -vvvv
```

Initialization alone leaves active liquidity at zero. For a replacement-pool
liquidity plan, `PrepareSepoliaPool.s.sol` and
`CalculateInitializedSepoliaLiquidityAmounts.s.sol` require the deployed
`HOOK_ADDRESS` and matching `EXPECTED_POOL_ID`; both remain read-only. The
amount calculator also requires `POOL_INITIAL_SQRT_PRICE_X96`,
`POOL_TICK_LOWER`, `POOL_TICK_UPPER`, `POOL_LIQUIDITY`,
`POOL_AMOUNT0_MAX`, and `POOL_AMOUNT1_MAX`. The planner additionally requires
`POOL_SETUP_STAGE=liquidity`, `POOL_LP_OWNER`,
`POOL_POSITION_RECIPIENT`, and `POOL_POSITION_DEADLINE`. It prints calldata
but does not add liquidity; use a separately reviewed PositionManager
transaction only after checking balances and both approval layers.
Backend Sepolia address/pool pins and frontend `VITE_*_ADDRESS` overrides must
be updated together only after deployment verification; the execute gate
remains closed until then.

### Pool setup

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `HOOK_ADDRESS` | replacement liquidity planning | none | Deployed replacement hook |
| `EXPECTED_POOL_ID` | replacement pool scripts | none | Pool ID calculated from the replacement PoolKey |
| `POOL_INITIAL_SQRT_PRICE_X96` | varies by script | `PlanCurrentSepoliaPoolInitialization` defaults it | Initial pool price |
| `POOL_TICK_LOWER` | liquidity amount calculator and planner | none | Lower position tick, aligned to spacing 60 |
| `POOL_TICK_UPPER` | liquidity amount calculator and planner | none | Upper position tick, aligned to spacing 60 |
| `POOL_LIQUIDITY` | varies | none | Liquidity to add |
| `POOL_AMOUNT0_MAX` | varies | none | Currency0 cap |
| `POOL_AMOUNT1_MAX` | varies | none | Currency1 cap |
| `POOL_POSITION_DEADLINE` | varies | none | Position deadline |
| `POOL_POSITION_RECIPIENT` | varies | none | Position recipient |
| `POOL_LP_OWNER` | varies | none | LP owner |
| `POOL_SETUP_STAGE` | varies | none | Stage selector string |

`script/ApproveSepoliaPermit2.s.sol.bak` also reads `POOL_POSITION_DEADLINE`. It is a backup file and is not part of the build.

### Fork tests

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION` | optional | `false` | Enables `SepoliaForkDeploymentVerification.t.sol` |
| `RUN_SEPOLIA_FORK_DEPLOYMENT_A_EXECUTION` | optional | `false` | Enables `SepoliaForkDeploymentAExecution.t.sol`. Also requires `SIGNER_PRIVATE_KEY` |
| `RUN_SEPOLIA_FORK_V2` | optional | `false` | Enables `SepoliaForkV2Router.t.sol` and `SepoliaForkCurrentPoolQuote.t.sol` |
| `RUN_SEPOLIA_FORK_QUOTE` | optional | `false` | Enables `SepoliaForkQuote.t.sol` |
| `SEPOLIA_FORK_BLOCK_NUMBER` | optional | `0`, meaning latest | Pin the fork block |
| `SEPOLIA_FORK_WETH_INPUT` | optional | `1e15` | Legacy quote suite WETH amount |
| `SEPOLIA_FORK_USDC_INPUT` | optional | `100e6` | Legacy quote suite USDC amount |
| `QUOTE_AMOUNT_IN` | required inside `test_QuoteForRequest` | none | Current-pool quote amount |
| `QUOTE_DIRECTION` | required inside `test_QuoteForRequest` | none | Current-pool quote direction |

An unset `RUN_SEPOLIA_FORK_*` flag makes the suite skip in `setUp` with `vm.skip(true)`, which is the default behaviour. All five fork suites are inert unless a flag is set.

## Test-only variables

`backend/src/monitor/sepolia.test.ts` sets `TEST_CHAIN_ID` and `TEST_ROUTER_MODE` on a child process. They are not read by production code.

## Interaction summary

The most consequential combinations:

| Situation | Result |
| --- | --- |
| `MEVSHIELD_V2_POLICY_ENABLED` unset | `POST /policy` answers 503 to everything. Signing is unavailable |
| `MEVSHIELD_V2_POLICY_ENABLED=true` without `SIGNER_PRIVATE_KEY` | Startup throws, because the signer is required when signing is enabled |
| `MEVSHIELD_SEPOLIA_DEMO_ENABLED=true` with `NODE_ENV=production` | Demo mode is refused. The flag has no effect |
| `VITE_SEPOLIA_DEMO_MODE=true` in a production build | Demo mode is refused, because `import.meta.env.DEV` is false |
| Any `PROTECTED_POOL_*` different from the pin | Startup throws with a message naming the approved pool |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` unset or false | The UI cannot sign or execute |
| `VITE_CHAIN_ID=31337` without `VITE_TOKEN0_ADDRESS` / `VITE_TOKEN1_ADDRESS` | The UI reports an unconfigured pool naming the missing variables, and cannot sign or execute. Nothing falls back to a guessed address |
| `VITE_CHAIN_ID` unset with no token addresses | Resolves to Sepolia and the published WETH9 / USDC addresses. This is the supported default |
| Monitor variables missing | The monitor reports `disabled`, the rest of the backend works, `/health` still returns 200 |

## Related pages

- [Backend service](../services/backend.md).
- [Frontend service](../services/frontend.md).
- [Monitoring](../services/monitoring.md).
- [Testing](testing.md).
- [ADR 0004](../decisions/0004-fail-closed-sepolia-configuration.md).
