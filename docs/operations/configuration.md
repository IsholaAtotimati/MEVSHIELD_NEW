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
| `VITE_API_URL` | optional | `http://localhost:4000` | Base URL for every backend call | Public. Must be reachable from the browser and allowed by the backend CORS origin. In demo mode a non-local URL forces `backendPoolKeyVerified` to false |
| `VITE_SEPOLIA_DEMO_MODE` | optional | unset, treated as false | Requests demo mode | Only takes effect when `import.meta.env.DEV` is also true, so a production build cannot enable it. Demo mode signs a 1-base-unit minimum output, which is not slippage protection |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` | optional | unset, treated as false | Opens the readiness gate for signing and execution | Setting this to true is the single action that enables execution in the UI. It should only be set after a live-stack fork test passes. See [ADR 0005](../decisions/0005-execute-gate-stays-closed.md) |
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
| `POLICY_VERIFIER_ADDRESS` | required, or one of the aliases | none | Verifier address | Must equal the pinned verifier `0x716f…b79f` or startup throws |
| `VERIFIER_ADDRESS` | alias | none | Second name for the verifier | Same pin applies. Listed second in resolution order |
| `POLICY_VERIFIER` | alias | none | Third name for the verifier | Same pin applies. Listed third |
| `ROUTER_ADDRESS` | required, or the alias | none | Router address | Must equal the pinned router `0x6332…150D` or startup throws |
| `MEVSHIELD_ROUTER` | alias | none | Second name for the router | Same pin applies. Lower precedence than `ROUTER_ADDRESS` |
| `FRONTEND_URL` | optional | `http://localhost:5173` | The single allowed CORS origin | A wrong value silently blocks the browser client. It does not block non-browser clients |

### Protected pool

All six are required. A missing or malformed value throws at startup.

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `PROTECTED_POOL_CURRENCY0` | required | none | Lower-sorted currency | Must be a valid address, and must sort below `CURRENCY1` |
| `PROTECTED_POOL_CURRENCY1` | required | none | Higher-sorted currency | Must be a valid address |
| `PROTECTED_POOL_FEE` | required | none | Pool fee in hundredths of a bip | Must be a non-negative safe integer, and must be 3000 to match the pin |
| `PROTECTED_POOL_TICK_SPACING` | required | none | Pool tick spacing | Same integer rules, and must be 60 to match the pin |
| `PROTECTED_POOL_HOOK` | required | none | Hook address in the pool key | Must equal the pinned hook `0xd15E…0080` |
| `PROTECTED_POOL_ID` | required | none | 32-byte pool id | Must be 32-byte hex, and must equal the id recomputed from the other five values. The derived id is then compared to the pinned id |

The whole pool block is compared against `EXPECTED_PROTECTED_POOL` ([backend/src/config/runtimeConfig.ts:97](../../backend/src/config/runtimeConfig.ts#L97)). Editing one variable to point at a different pool fails startup rather than serving a mismatch.

### Signing

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `MEVSHIELD_V2_POLICY_ENABLED` | optional | unset, treated as false | Opens `POST /policy` | The literal string `true` is required. Any other value leaves the route at 503. Opening it exposes an unauthenticated signing endpoint |
| `SIGNER_PRIVATE_KEY` | required only when signing is enabled | none | The EIP-712 signing key | Loaded into an in-process wallet. The derived address must equal `0x016B…A815` or startup throws. Validation errors never echo the key |
| `MEVSHIELD_SEPOLIA_DEMO_ENABLED` | optional | unset, treated as false | Enables demo signing | Requires `NODE_ENV` not `production` and `RAILWAY_ENVIRONMENT_NAME` unset. Demo mode signs a fixed 1-base-unit minimum |

### Monitor

| Name | Required | Default | Purpose | Safety note |
| --- | --- | --- | --- | --- |
| `SEPOLIA_RPC_URL` | required for the monitor | none | RPC endpoint | If missing along with the alias, the monitor reports `disabled` and the process still starts. Any provider key here stays server-side |
| `RPC_URL` | alias | none | Second name for the RPC | Same as above |
| `POLICY_REGISTRY_ADDRESS` | required for the monitor | none | Registry to scan | Not compared to the pinned deployment. A wrong value scans the wrong contract |
| `POLICY_REGISTRY` | alias | none | Second name for the registry | Same as above |
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

### Pool setup

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `POOL_INITIAL_SQRT_PRICE_X96` | varies by script | `PlanCurrentSepoliaPoolInitialization` defaults it | Initial pool price |
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
