# How to test

This is the entry point for `feature/sepolia-fork-demo`. Run the three tests in order. The longer notes are [local-docker.md](local-docker.md), [local-test-flow.md](local-test-flow.md), and [sepolia-fork-sandwich.md](sepolia-fork-sandwich.md). Those pages own the gate list, the environment matrix, and the fork proof. This page tells you which command to run and what a pass looks like.

## Checkout

```bash
git checkout feature/sepolia-fork-demo
```

You need four tools on the machine:

- Docker Desktop, or Docker Engine with Compose v2. `./script/docker-local-up.sh` exits if `docker` is missing or the daemon is not running.
- Foundry (`forge`, `cast`, and `anvil`) on `PATH` for the contract suites and the fork test. Repository docs install it with foundryup and expect the binaries in `$HOME/.foundry/bin`. If `forge` is not found, run `export PATH="$HOME/.foundry/bin:$PATH"` before the Forge commands below. The same export is in [sepolia-fork-sandwich.md](sepolia-fork-sandwich.md) and [docs/operations/testing.md](../operations/testing.md).
- Node and npm. The local test page compiles on the host. [local-test-flow.md](local-test-flow.md) asks for Node 20 or newer, and for `npm ci` inside `frontend/` before the bundle build. CI uses Node 22.

Test A runs Foundry inside the contracts image, so a missing host `forge` does not block the Docker stack. Tests B and C need `forge` on `PATH`.

The up script initialises git submodules when `lib/forge-std`, `lib/v4-core`, `lib/openzeppelin-contracts`, or nested `lib/v4-core/lib/solmate` is missing. You can do that yourself with `git submodule update --init --recursive`.

## What you can prove today

1. Test A. A local anvil stack on chain 31337. Enter an amount, read a risk report, and register a policy.
2. Test B. The Forge, backend, and frontend unit suites. The Sepolia fork sandwich skips unless its flag is set.
3. Test C. A Foundry fork of Sepolia public state. A same-direction swap moves the tick, the unprotected victim receives less, and this repository's router reverts `MinimumOutputNotMet`. Nothing is broadcast.

What these tests do not prove:

- A live sandwich by a third-party bot will not happen. Test C is one process on a fork. It does not submit a transaction to Sepolia and it does not wait for another searcher.
- Swap execution stays gated. Test A stops at policy registration. `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` stays false for Sepolia, and the live signer key is not in this repository. See [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).
- The risk score estimates price impact from pool state. `/risk-preview` and `/policy` read `slot0` and active liquidity through the configured RPC. The score does not read the mempool. If that read fails, the API returns `503` with code `pool_state_unavailable`. It does not substitute `amount / 1000`.

## Test A, local stack

Start the stack from the repository root:

```bash
./script/docker-local-up.sh
```

The script builds the images, starts anvil, deploys the contracts, starts the backend and the published frontend, and waits until each layer is healthy. Host defaults, from `script/docker-local-up.sh`, are anvil port `8545`, backend port `4000`, and frontend port `5173`. The script prints the published frontend as `Frontend` followed by `FRONTEND_URL`. With no `docker/.env.docker`, that URL is `http://localhost:5173`.

That published page is not the one you use for Check protection. Compose pins `MEVSHIELD_SEPOLIA_DEMO_ENABLED` to false, so policy creation needs a second backend. Leave the stack running and start the local test page:

```bash
(cd frontend && npm ci)
./script/local-test-flow.sh
```

`npm ci` is required once. The script exits with `frontend/node_modules is missing` if you skip it. The script does not restart anvil, the contract deploy, or the published backend. It reads `ANVIL_PORT` and `BACKEND_PORT` from `docker/.env.docker` when that file exists, and from the running containers otherwise. It builds a chain `31337` bundle and serves it in nginx.

The script prints this line, with `5599` unless you passed `--port`:

```text
    Open   http://localhost:5599
```

Open that URL. `5599` is `LOCAL_TEST_PORT`. It is separate from the published frontend on `5173`.

Reset warning. An already-running stack that was started before the DeployLocal registrar fix still has the deployer EOA as `authorizedRegistrar`. Registration then reverts `Unauthorized` after the signature check. `contracts-deploy` skips a chain that already has the router, so a second `up` does not repair it. Recreate the stack with the down command the up script supports, then start it again, then run the test flow:

```bash
./script/docker-local-up.sh --down
./script/docker-local-up.sh
./script/local-test-flow.sh
```

`--down` runs `docker compose down --volumes --remove-orphans` and exits. That removes the in-memory chain. A fresh `up` deploys `PolicyAuthorization` as the registrar, which is what `script/DeployLocal.s.sol` does now.

Wallet. Use a local anvil account on chain `31337`. The test script prints account `#0`:

```text
RPC         http://localhost:<anvil port>
Chain ID    31337
Account #0  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Key         0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

That key is anvil's published development key. It is local only. Add the RPC and chain id `31337` in the wallet before you connect. The RPC host port is the anvil port the script printed (`8545` unless `docker/.env.docker` moved it).

What Check protection should do. The top bar should read `Anvil Local · 31337` and `Backend online`, with an amber strip that demo mode is on. Enter a positive amount, for example `0.5`. The receive field fills with the demo estimate, the checklist drops the amount, quote, and minimum-output reasons, and **Check protection** becomes enabled. Click it. The shield report shows a risk level, a model name, max loss, max fee, and an estimated loss. The primary button then reads **Sign policy and swap**. Click that. The status becomes `Policy signed and registered on-chain`, a registered-policy box shows the nonce, expiry, and signed minimum, and the lifecycle shows `Policy registered: On`. The risk report does not need a wallet. Registration does.

What stays disabled. Stop at registration. Execute is not the pass for this test. The published stack leaves `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` false, so that UI will not execute a swap. The local test script prints `execute / swap` as open because the local deployment record and the demo estimate are open. [local-test-flow.md](local-test-flow.md) still ends the flow at registration: `canExecute` also needs registered policy bounds, and execution is out of scope. Do not read a local registration as a live protected swap.

To remove only the containers this script added, run `./script/local-test-flow.sh --stop`. That leaves the published stack running.

## Test B, unit suites

The root `package.json` has no scripts. Run the three suites from the package scripts and the Foundry commands this branch already uses.

Contracts. From the repository root, with Foundry on `PATH`:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge test
```

CI runs the same suite as `forge test -vvv` after `forge fmt --check` and `forge build --sizes` (`.github/workflows/test.yml`). No CI job sets a `RUN_SEPOLIA_FORK_*` flag.

`test/SepoliaForkSandwich.t.sol` calls `vm.skip(true)` in `setUp` when `RUN_SEPOLIA_FORK_SANDWICH` is absent. A plain `forge test` skips that file, including when you pass no fork URL. The other fork suites skip the same way unless their own flags are set. [sepolia-fork-sandwich.md](sepolia-fork-sandwich.md) records `forge test --offline` on this tree as 88 passed, 6 skipped, 0 failed, 94 total. [docs/operations/testing.md](../operations/testing.md) still describes an earlier total with five skipped fork suites. The later record is the sandwich runbook.

Backend. The `test` script in `backend/package.json` is:

```bash
tsx --test src/config/runtimeConfig.test.ts src/config/env.test.ts src/policy/eip712.test.ts src/policy/policyRequest.test.ts src/policy/policySigning.test.ts src/risk/riskEngine.test.ts src/risk/poolState.test.ts src/observability/requestCorrelation.test.ts src/risk/riskPreview.test.ts src/monitor/sepolia.test.ts src/server.test.ts
```

Run it as:

```bash
cd backend
npm ci
npm test
```

The sandwich runbook records that `npm test` as 102 passed, 0 failed, and records `npm run build` as completed.

Frontend. The `test` script in `frontend/package.json` is:

```bash
node --experimental-strip-types --test src/lib/protectedQuote.test.mjs src/lib/apiValidation.test.mjs src/lib/format.test.mjs src/lib/statusTone.test.mjs src/lib/shieldReport.test.mjs src/lib/networkVerification.test.mjs src/config/policy.test.mjs src/config/chainEnv.test.mjs src/lib/minimumOutputVerification.test.mjs
```

Run it as:

```bash
cd frontend
npm ci
npm test
```

## Test C, the Sepolia fork sandwich

Use the command from [sepolia-fork-sandwich.md](sepolia-fork-sandwich.md). It needs network access to the public RPC. It does not broadcast, and it does not use a live signer key.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
RUN_SEPOLIA_FORK_SANDWICH=true forge test --match-path test/SepoliaForkSandwich.t.sol \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
```

`-vv` is what prints the measurements. Look for these log lines from `test/SepoliaForkSandwich.t.sol`:

```text
fork block
tick before
tick after attacker
quoted amount out before attack
unprotected amount out
protected revert reason
```

`protected revert reason` should be `MinimumOutputNotMet`.

The runbook records two unpinned runs. The trade numbers matched. The block moved.

| Measurement | First run | Later run (29 October 2026) |
| --- | --- | --- |
| Fork block | 12018873 | 12018906 |
| Tick before | 198487 | 198487 |
| Tick after attacker | 198477 | 198477 |
| Quoted WETH out (wei) | 8306140005511 | 8306140005511 |
| Unprotected WETH out (wei) | 8297097263431 | 8297097263431 |
| Protected revert | MinimumOutputNotMet | MinimumOutputNotMet |

An unpinned fork follows the chain head, so a later run can log a different block, tick, or output. Compare the relationship. Unprotected out is strictly less than quoted out, and the protected swap reverts `MinimumOutputNotMet`. Do not treat the integers as a permanent pool state. The test does not assert this table.

To repeat the first block, the runbook pins it:

```bash
RUN_SEPOLIA_FORK_SANDWICH=true SEPOLIA_FORK_BLOCK_NUMBER=12018873 \
forge test --match-path test/SepoliaForkSandwich.t.sol \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com \
  --fork-block-number 12018873 -vv
```

## Troubleshooting

Use the existing runbooks for the full gate list. The four failures below are the ones that stop this page.

**Backend offline.** The top bar says `Backend offline` when the browser cannot reach the API the bundle was built with. Curl the backend URL `./script/local-test-flow.sh` printed. The published backend defaults to `http://localhost:4000/health`. When the published backend is not in demo mode, the script starts a second one and prints `http://localhost:4200`. A curl to the wrong port looks like an outage. Detail: [local-test-flow.md](local-test-flow.md) section 5, and [local-docker.md](local-docker.md) section 13.

**Check protection stays disabled.** With a positive amount entered, one of gates 1 to 6 is shut. The checklist names the reason. There is no separate silent failure. Detail: [local-test-flow.md](local-test-flow.md) sections 3 and 5. The Network page shows the same address comparisons.

**Policy 400.** **Sign policy and swap** fails with `Invalid request` when the backend rejects the body. That is HTTP 400, before a transaction. The backend log event is `policy_request_failed`, and it names the field. An earlier build rejected the frontend's legal `sqrtPriceLimitX96` because the bounds were off by one. That rejection is fixed on this branch. If you still see 400, read the field in the log rather than guessing the chain. A registration revert after the wallet sends a transaction is a different row in the same table (`Unauthorized` when the registrar is still the deployer). Detail: [local-test-flow.md](local-test-flow.md) sections 5 and 6.

**Port 4000 taken.** `./script/docker-local-up.sh` fails with `the stack did not become healthy`. The compose error recorded in the Docker runbook is `ports are not available: exposing port TCP 0.0.0.0:4000 ... address already in use`. Anvil can already be healthy and `contracts-deploy` can already have exited 0. Set `BACKEND_PORT` in `docker/.env.docker` (the verification run used `4100`), keep `VITE_API_URL` and `FRONTEND_URL` on that same port, and start again through the up script. The verify script reads those ports from the same file. Detail: [local-docker.md](local-docker.md) sections 11 and 13.
