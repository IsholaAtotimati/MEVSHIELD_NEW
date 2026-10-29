# Running the full flow locally

How to open the app on your own machine and actually exercise it: connect a
wallet, enter an amount, check protection, and create a policy — against the
local anvil stack, with no Sepolia deployment involved.

```bash
./script/local-test-flow.sh
```

Then open <http://localhost:5599>.

This is the companion to [local-docker.md](local-docker.md). That runbook brings
up the stack; this one explains how to use it as an application and, in
particular, why the readiness gates behave differently on chain 31337.

> **Everything here is local only.** The chain is anvil, the wallet keys are
> anvil's published development keys, and the tokens are mock ERC-20s with no
> value. Nothing in this path may be pointed at a real network.

---

## 1. Prerequisites

| Requirement | Why |
| --- | --- |
| The local stack already running | `./script/docker-local-up.sh`. This script never starts, restarts or reconfigures it |
| Docker | Builds the demo-signing backend and serves the frontend in nginx |
| Node 20+ and `npm ci` in `frontend/` | The bundle is compiled on the host, because Vite inlines every `VITE_*` value at build time |
| A browser wallet, or none at all | The gates below can be verified without one; only policy creation needs an account |

The script discovers everything else. It reads the published anvil port from
`docker/.env.docker` when that file exists and from the running containers
otherwise, then reads the deployment record straight out of the stack's
`deployments` volume. It does not hard-code a port or an address, so a stack
running on non-default ports works unchanged.

---

## 2. One command

```bash
# build a bundle for chain 31337 and serve it
./script/local-test-flow.sh

# same, but with Vite's dev server and hot reload
./script/local-test-flow.sh --dev

# serve on a different port
./script/local-test-flow.sh --port 5610

# remove the containers this script created
./script/local-test-flow.sh --stop
```

The frontend goes on **5599** by default. That is deliberately not 5173, so it
does not clash with the nginx frontend the Docker stack already publishes.

### What the script sets

Every value below is baked into the bundle at build time. They are printed by
the script so a screenshot of a terminal records exactly what was tested.

| Variable | Value | Why |
| --- | --- | --- |
| `VITE_CHAIN_ID` | `31337` | Read anvil, not Sepolia |
| `VITE_RPC_URL` | the published anvil port, e.g. `http://localhost:8645` | The browser talks to anvil directly |
| `VITE_API_URL` | `http://localhost:4100`, or `http://localhost:4200` | See the demo-signing backend below |
| `VITE_SEPOLIA_DEMO_MODE` | `true` | Enables the deterministic estimate, see gate 3 |
| `VITE_LOCAL_DEPLOYMENT_RECORD` | the JSON from `/deployments/local.json` | See gate 2 |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` | **unset** | Deliberate; see gate 2 |
| `VITE_POOL_MANAGER_ADDRESS` | `0x5FbDB2315678afecb367f032d93F642f64180aa3` | From the record |
| `VITE_POLICY_REGISTRY_ADDRESS` | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` | From the record |
| `VITE_POLICY_VERIFIER_ADDRESS` | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` | From the record |
| `VITE_POLICY_AUTHORIZATION_ADDRESS` | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` | From the record |
| `VITE_MEVSHIELD_HOOK_ADDRESS` | `0x1e2F391574556815aE705895F2728543A7AD4080` | From the record |
| `VITE_MEVSHIELD_ROUTER_ADDRESS` | `0x8A791620dd6260079BF849Dc5567aDC3F2FdC318` | From the record |
| `VITE_AUTHORIZED_SIGNER_ADDRESS` | `0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7` | From the record |
| `VITE_TOKEN0_ADDRESS` | `0x610178dA211FEF7D417bC0e6FeD39F05609AD788` | From the record |
| `VITE_TOKEN1_ADDRESS` | `0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e` | From the record |

The addresses in the table are what a fresh stack produces. They are read from
the record at build time, so a redeploy that produces different addresses needs
no edit here.

### The demo-signing backend

Policy creation sends a signed minimum output of `1` base unit. `POST /policy`
accepts that **only** from a backend started with
`MEVSHIELD_SEPOLIA_DEMO_ENABLED=true` (`isLocalSepoliaDemoEnabled` in
[backend/src/config/runtimeConfig.ts](../../backend/src/config/runtimeConfig.ts)),
and the compose service pins that flag to `"false"` so the published stack
exercises the non-demo path.

Rather than reconfigure the running stack, the script starts a **second**
backend on port **4200**, against the same anvil, with the flag on. The
published backend on 4100 keeps running untouched. If the published backend is
already reporting `localDemoMode: true`, the script reuses it and starts
nothing.

---

## 3. The gates, by name

`calculateSwapReadiness` in
[frontend/src/lib/protectedQuote.ts](../../frontend/src/lib/protectedQuote.ts)
is the single decision point. It composes seven booleans into `canCheckRisk`
and `canExecute`. On the local chain, six of the seven open and one stays shut
on purpose.

### Gate 1 — `poolKeyMatches`

**Open locally.** The pool key is derived from the two token addresses and the
hook, all supplied from the deployment record, so the key matches by
construction. If the token addresses are missing the build reports the pool as
unconfigured and names the missing variables rather than guessing.

### Gate 2 — `minimumOutputProtocolVerified`

This is the interesting one, and the reason this runbook exists.

**On Sepolia: flag only, fail-closed.** The v2 minimum-output path (hook, router,
policy authorization) is trusted only after its deployed bytecode has been
checked. That deployment is somebody else's, and the app cannot audit it, so
the only honest answer is a human assertion in the build:
`VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true`. It defaults to false. This is
unchanged, and nothing in the local work loosens it.

**On chain 31337: verified by comparison.** Here the addresses the app reads are
the ones this machine's own deploy script wrote minutes earlier, and
`/deployments/local.json` is that deploy's output. So the build compiles the
record in as `VITE_LOCAL_DEPLOYMENT_RECORD`, and
[`resolveMinimumOutputVerification`](../../frontend/src/lib/minimumOutputVerification.ts)
compares it, field by field, against the configured addresses. Every address
must agree, the record must be complete, and its `chainId` must be 31337. Any
disagreement, a missing record, or an unparseable record keeps the gate shut.

That is a real check of the same claim the Sepolia flag stands for, not an
assertion of faith. It cannot be reached on any other chain: the function
returns the flag-only result before it looks at a record.

### Gate 3 — `outputEstimateReady`

**Open locally, only because of demo mode.**
`assessProtectedPool` always ends at `quote-simulation-unavailable`, because
pool spot state cannot reproduce tick traversal, fees and router effects, and
there is no quoter integration yet. So `isFreshQuote` is always false and no
genuine quote exists on any chain.

Demo mode substitutes a fixed `2000 USDC per WETH` estimate for the quote. It
requires `VITE_SEPOLIA_DEMO_MODE=true` and:

- on Sepolia, the Vite **dev server** (`import.meta.env.DEV`), so a production
  bundle can never sign a demo policy — **unchanged**;
- on chain 31337, a built bundle is allowed, because the only way to serve the
  local stack is a built bundle and the tokens are mock tokens worth nothing.

See `resolveDemoMode` in
[frontend/src/config/chainEnv.ts](../../frontend/src/config/chainEnv.ts).

The demo policy carries a **1-base-unit** minimum output. That is not slippage
protection and the UI says so on the page. It exists so the policy signing,
registration and authorization paths can be exercised end to end.

### Gate 4 — `backendPoolKeyVerified`

**Open locally.** The frontend fetches `GET /config/protected-pool` and compares
every field, the chain id and the pool id against its own expectation. It closes
if the backend answers with anything else, or if the frontend cannot reach the
backend at all.

### Gate 5 — `protocolAddressesVerified`

**Open locally.** Seven on-chain reads, compared against the configured
addresses: the hook's `poolManager` and `authorization`, the authorization's
`registry` and `verifier`, the registry's `owner` and `authorizedConsumer`, and
the verifier's `authorizedSigner`.

### Gate 6 — `authorizationVerified`

**Open locally.** The registry's `authorizedConsumer` must equal the
`PolicyAuthorization` address, so the route the app registers through is the one
the hook will later consume from.

> **This gate exposed a defect in `script/DeployLocal.s.sol`.** It set the
> registry's `authorizedRegistrar` to the deployer EOA
> (`setAuthorizedRegistrar(deployer)`), where `DeploySepolia.s.sol` sets it to
> the authorization contract. `PolicyAuthorization.registerPolicy` verifies the
> signature and then calls `registry.registerPolicy`, so with the EOA as
> registrar every registration reverted `Unauthorized()` *after* a successful
> signature check. Policy creation could never have worked locally. The script
> now matches Sepolia. See section 6.

### Gate 7 — `policyBoundsVerified` (the one that stays closed)

**Closed at first, by design.** No policy exists yet, so there are no registered
bounds to verify. This is why the checklist still shows

> Registered policy bounds are not verified.

with an amount entered, and why the button reads **Check protection** rather
than **Sign policy and swap**. It blocks `canExecute`, not `canCheckRisk`. Once
a policy registers, the bounds come from the on-chain policy and the gate
recomputes.

---

## 4. What "done" looks like

With the stack up and the script run:

1. Open <http://localhost:5599>. The top bar reads `Anvil Local · 31337` and
   `Backend online`, and an amber strip says demo mode is on.
2. Optionally connect a wallet. Account #0 and its key are printed by the
   script; add `http://localhost:<anvil port>` with chain id `31337` to your
   wallet first.
3. Type a positive amount, e.g. `0.5`. The receive field fills with the demo
   estimate.
4. The checklist loses the amount reason, the quote reason and the
   minimum-output reason. **Check protection** becomes enabled.
5. Click it. The shield report shows a risk level, a model name, max loss, max
   fee and an estimated loss.
6. Click **Sign policy and swap**. The status becomes
   *Policy signed and registered on-chain*, a registered-policy box appears with
   the nonce, expiry and signed minimum, and the lifecycle shows
   `Policy registered: On`.

Step 6 needs a wallet. Steps 1, 3, 4 and 5 do not: the readiness gate is
rendered from the same state either way.

The **Execute** button may still be disabled. That is the `canExecute` path,
which additionally requires `policyBoundsVerified` and is out of scope for this
runbook. Registration is the end of the flow this runbook claims.

---

## 5. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Script exits with *"No JSON-RPC answer"* | The stack is not up | `./script/docker-local-up.sh` |
| Script exits with *"expected 31337"* | `VITE_CHAIN_ID` pointing at another chain, or anvil on a different port | Check `docker/.env.docker`, or unset `VITE_CHAIN_ID` |
| Script exits with *"No deployments volume"* | The stack was never started under this project name, or `contracts-deploy` failed | `docker compose ps`; `docker compose logs contracts-deploy` |
| Script exits with *"deployment record is empty"* | `contracts-deploy` did not finish | `docker compose up contracts-deploy` and read its log |
| Top bar says **Backend offline** | Backend not reachable from the browser | `curl http://localhost:4100/health`; check the port the script printed |
| Checklist says *"A valid deterministic demo estimate is unavailable"* | `VITE_SEPOLIA_DEMO_MODE` not `true`, or the pool inspection is stale (`isFreshDemoPoolReadiness` has a 15s window) | Rebuild through the script; click **Refresh quote** |
| Checklist says *"A fresh quote for the protected pool is unavailable"* | Demo mode is off, so the demo branch is not taken | Same as above — this is the expected Sepolia production message |
| Checklist says *"The signed-minimum-output v2 contracts are not deployed and verified"* | Chain is not 31337, or the record does not match the configured addresses | Read `MINIMUM_OUTPUT_V2_DEPLOYMENT_UNVERIFIED_REASON` on the Network page; it names the mismatched field |
| Checklist says *"The backend pool-key configuration is unverified"* | Frontend and backend disagree about the pool, or CORS blocked the fetch | Compare `GET /config/protected-pool` with the record; check `FRONTEND_URL` |
| **Check protection** stays disabled with a valid amount | One of gates 1–6 above is shut | The checklist names it. There is no silent failure |
| Top bar warns **Wrong network** | The wallet is on a different chain | Switch the wallet to chain id `31337` |
| **Sign policy and swap** fails with *Invalid request* | Backend rejected the body — historically a `sqrtPriceLimitX96` bound mismatch | Check the backend log for `policy_request_failed` and the field it names |
| **Sign policy and swap** fails with *Policy registration transaction failed* | The on-chain call reverted, usually `Unauthorized()` from the registry | Check the registry's `authorizedRegistrar`; see gate 6 and section 6 |
| **Sign policy and swap** says the backend is not in demo mode | The frontend reached the published backend on 4100, not the demo one on 4200 | Check `VITE_API_URL`; the script starts 4200 automatically when needed |

The Network page is the fastest way to see why a gate is shut: it renders the
same addresses the gates compare, plus
`MINIMUM_OUTPUT_V2_DEPLOYMENT_UNVERIFIED_REASON` when the deployment is not
verified.

---

## 6. The deploy defect this path found

`script/DeployLocal.s.sol` registered the deployer EOA as the registry's
authorized registrar:

```
PolicyRegistry(info.registry).setAuthorizedRegistrar(deployer);
```

`DeploySepolia.s.sol` registers the authorization contract:

```
PolicyRegistry(info.registry).setAuthorizedRegistrar(info.authorization);
```

`PolicyAuthorization.registerPolicy` verifies the EIP-712 signature and then
calls `registry.registerPolicy`, which is `onlyAuthorizedRegistrar`. With the
EOA registered, the signature check passed and the registry write reverted
`Unauthorized()` — so no policy created through the app could ever register on
the local chain, and the failure surfaced only after the wallet had already sent
the transaction.

The deploy script now matches Sepolia. Two consequences worth knowing:

- **An already-deployed stack keeps the old wiring.** anvil state is in memory
  and `contracts-deploy` skips a live deployment, so an existing stack needs
  `docker compose down -v` to pick the fix up. That is why the verification
  recorded for this change was done against a fresh isolated anvil rather than
  by reconfiguring a running stack.
- **`docs/runbook/local-docker.md` §10 claims policy registration works
  locally.** It did not, before this change. It does now.

---

## 7. What is still not covered

- **No live quote.** There is no quoter. Demo mode is an estimate and the UI
  says so. Gate 3 opens only through the demo path.
- **Execution is out of scope.** `canExecute` needs `policyBoundsVerified` and a
  matching policy; the Execute button is left to the execute-gate ADR.
- **This runbook does not certify Sepolia.** Locally the tokens are 18-decimal
  mocks, the signer is `0xA11CE`, and there is no Permit2. A pass here says the
  application wiring works, not that a Sepolia swap will.
