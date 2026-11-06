# MEVShield Production-Readiness Tracker

**Last updated:** 2026-11-06
**Overall status:** NOT production-ready. Deployment B, its pool initialization, and its liquidity position are verified; neither protected swap direction has live evidence yet.

## Canonical deployment

Deployment B is the only supported Sepolia deployment. Deployment A is retired and
must not be used by runtime configuration, tests, scripts, or execution tooling.

| Component | Address |
|---|---|
| Chain | Sepolia `11155111` |
| PoolManager | `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543` |
| USDC | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| WETH | `0xfff9976782d46cc05630d1f6eBAb18b2324d6B14` |
| Hook | `0x15D8C5eb1b839A4Fd86989348c1371c10168c080` |
| Router | `0x78ffC9Fd8cd6312Ac6f4038FBBFF4870d8dC4283` |
| Authorization | `0xEDC98B44349EDF0D0b71cBc5D4523352ffB8c821` |
| Registry | `0x3b1b05954b226633e87cC875593E5E8FB998eFBC` |
| Verifier | `0xD3635b589dB0B4E215283274937C0b7600314A6d` |
| Pool ID | `0xba95e58e09df6620bcf06cf124eb902eba371655696b14ba8b43ec1b9fc22235` |

Historical Deployment A transaction records remain below for auditability only.

This tracker distinguishes local implementation/test evidence from live Sepolia evidence. A simulated address is not a deployed address. Secret values were not displayed; key material was used locally only to derive and compare its public address.

## Architecture and dependency map

```text
Wallet / user
  └─ React app: App → TradePage / TradeContext
       ├─ wallet + network: useWallet, useProtocol
       ├─ readiness + live quote: useProtectedQuote → backend /quote
       ├─ risk and policy: usePolicy → backend /risk-preview, /policy
       └─ registration, execution, activity
            └─ wallet transactions → PolicyAuthorization / MEVShieldRouter
                 └─ Uniswap v4 PoolManager
                      ├─ beforeSwap → MEVShieldHook
                      │    └─ PolicyAuthorization
                      │         ├─ PolicyVerifier (EIP-712 signer)
                      │         └─ PolicyRegistry (registered/consumed nonce)
                      └─ token settlement / output transfer

Backend: Express routes → runtime configuration + risk/quote services
  ├─ Sepolia RPC → PoolManager state / quote inputs / monitor
  └─ authorized EIP-712 signer → signed policy returned to frontend
```

Relevant entry points:

- Contracts: [src/PolicyRegistry.sol](../src/PolicyRegistry.sol), [src/PolicyVerifier.sol](../src/PolicyVerifier.sol), [src/PolicyAuthorization.sol](../src/PolicyAuthorization.sol), [src/MEVShieldHook.sol](../src/MEVShieldHook.sol), [src/MEVShieldRouter.sol](../src/MEVShieldRouter.sol).
- Deployment and pool operations: [script/DeploySepolia.s.sol](../script/DeploySepolia.s.sol), [script/PreflightSepoliaMigration.s.sol](../script/PreflightSepoliaMigration.s.sol), [script/InitializeSepoliaProtectedPool.s.sol](../script/InitializeSepoliaProtectedPool.s.sol), [script/PrepareSepoliaPool.s.sol](../script/PrepareSepoliaPool.s.sol).
- Backend: [backend/src/server.ts](../backend/src/server.ts), [backend/src/config/runtimeConfig.ts](../backend/src/config/runtimeConfig.ts), [backend/src/risk/](../backend/src/risk/), [backend/src/policy/](../backend/src/policy/).
- Frontend: [frontend/src/App.tsx](../frontend/src/App.tsx), [frontend/src/pages/TradePage.tsx](../frontend/src/pages/TradePage.tsx), [frontend/src/hooks/](../frontend/src/hooks/), [frontend/src/lib/](../frontend/src/lib/).
- Tests and existing architecture documentation: [test/](../test/), [docs/architecture/overview.md](architecture/overview.md), [docs/architecture/contracts.md](architecture/contracts.md).

## Repository audit baseline

- Branch: `feature/router-only-wallet-auth`.
- At audit time, `git status --short` showed **40 modified tracked files** and **5 untracked paths**. These include Solidity contracts/tests/scripts, backend quote and policy code/tests, frontend quote/execution code/tests, and operational documentation. Treat all as existing user work; do not reset, clean, or overwrite them.
- The supplied task context identifies legacy `.env` settings and simulated V2 addresses; neither constitutes live deployment evidence.
- Current frontend/backend source defaults pin Deployment B, including router `0x78ff…4283`, hook `0x15D8…c080`, and pool ID `0xba95…2235`.
- A read-only Sepolia inspection confirmed Deployment B code, wiring, pool initialization at tick `198384`, and active liquidity `1,000,000,000,000`.
- Backend aliases were reconciled to Deployment B without exposing secrets. Sepolia policy signing remains gated by `MEVSHIELD_V2_POLICY_ENABLED` and `MEVSHIELD_V2_DEPLOYMENT_VERIFIED`; those gates were not opened by this configuration change.
- Read-only verification on 2026-11-05: Deployment B preflight passed all contract links, hook permissions, Pool ID derivation, initialization, and active-liquidity checks. Live `/quote` returned successful USDC → WETH and WETH → USDC quotes using pool ID `0xba95…2235`.
- The backend exposes `/health`, `/config/protected-pool`, `/quote`, `/risk-preview`, `/policy`, and `/observability/transaction`. Frontend execution also has a deployment-verification gate; keep it closed.
- Existing architecture prose needs a consistency pass against current changes. In particular, review recipient-binding descriptions against the current router behavior before relying on them operationally.

## Milestones

Allowed statuses: **NOT STARTED**, **IN PROGRESS**, **BLOCKED**, **IMPLEMENTED — NOT VERIFIED**, **VERIFIED**, **REQUIRES HUMAN APPROVAL**.

| # | Milestone | Status | Evidence, limitation, or blocker |
|---|---|---|---|
| 1 | Repository audit | VERIFIED | Evidence: `git status --short`, `git diff --stat`, source-tree inventory, and inspection of architecture docs, package scripts, backend routes, quote/execution hooks, and address pins. Result: 40 modified tracked files and 5 untracked paths; architecture map and configuration drift recorded above. Limitation: this is a baseline inventory, not the detailed contract/backend/frontend reviews in milestones 2, 4, and 5. No behavior test applies to a read-only audit. |
| 2 | Contract security review | NOT STARTED | Architecture docs exist, but no fresh full review of current dirty contract changes has been recorded for this tracker. |
| 3 | Contract tests | VERIFIED | Fresh evidence: `$HOME/.foundry/bin/forge test --match-contract 'PolicyRegistryTest\|PolicyAuthorizationTest\|PolicyVerifierTest\|MEVShieldIntegrationTest\|MEVShieldHookTest'` — compiler run successful; 90 passed, 0 failed, 0 skipped (21 registry, 24 authorization, 18 verifier, 17 integration, 10 hook). Relevant files: `test/PolicyRegistry.t.sol`, `test/PolicyAuthorization.t.sol`, `test/PolicyVerifier.t.sol`, `test/MEVShieldIntegration.t.sol`, `test/MEVShieldHook.t.sol`. Limitation: no live deployment transaction evidence. |
| 4 | Backend validation | VERIFIED | The earlier complete backend run passed 120 tests and the backend build passed. Independently reproduced targeted quote/policy validation run: 119 passed, 1 failed in the pre-existing `missing optional router still allows Sepolia monitor scanning` case; no quote-lifecycle failure was reported. The quote-cache regression matrix verifies that both the 15-second cache TTL and advertised `expiresAt` must remain valid, and expired entries are deleted. The `/policy` flow rejects missing, stale, or mismatched quote references before signing. Limitation: the on-chain policy schema does not bind quote ID or quote expiry, so a previously signed policy can remain registrable/executable until its own policy expiry. No policy-registration or swap transaction is evidenced here. |
| 5 | Frontend validation | IMPLEMENTED — NOT VERIFIED | `cd frontend && npm run build` — passed; Node 22 test command — 90 passed, 0 failed. The lifecycle fix in `frontend/src/hooks/usePolicy.ts` performs exact approval before policy signing/registration, requires a minimum remaining quote window, and rechecks freshness after approval and before registration. `frontend/src/hooks/useExecution.ts` no longer approves after registration, fails closed on insufficient allowance, and rechecks the quote window before swap estimation. Browser inspection remains unverified because no injected wallet is available and the Sepolia browser RPC failed to load. Build reports a non-blocking large-chunk warning. |
| 6 | Deployment simulation | VERIFIED | Fresh no-broadcast simulation on 2026-11-05: `$HOME/.foundry/bin/forge script script/DeploySepolia.s.sol:DeploySepolia --rpc-url "$RPC_URL" -vv` — script succeeded; 32,888,549 aggregate script gas. Predicted Registry `0x3b1b05954b226633e87cC875593E5E8FB998eFBC`, Verifier `0xD3635b589dB0B4E215283274937C0b7600314A6d`, Authorization `0xEDC98B44349EDF0D0b71cBc5D4523352ffB8c821`, Hook `0x15D8C5eb1b839A4Fd86989348c1371c10168c080`, Router `0x78ffC9Fd8cd6312Ac6f4038FBBFF4870d8dC4283`; deployer and signer both derived as `0x016B78a30CE176EF0B90c122e8677e13aAB2A815`. Simulation only; no transaction hash.
| 7 | Deployment fee verification | VERIFIED | User selected a 0.0329 ETH maximum deployment cost. Broadcast used `--with-gas-price 1gwei`; total actual fees from nine successful receipts were `0.000637224267945987 ETH`, below cap. The pre-broadcast simulation estimated the cap at `0.032888549 ETH`. RPC fee methods disagreed, so this evidence verifies this deployment's actual fee only, not future fee estimates. |
| 8 | V2 contract deployment | VERIFIED | Broadcast on Sepolia chain 11155111. Nine transactions succeeded, deployed all five contracts, and the post-deployment RPC check found code at every predicted address. Actual transaction hashes and fee evidence are in the Sepolia transaction log below. Read-only preflight at block `12065901` verified all constructor wiring, ownership, registry/verifier authorization, trusted router, authorized hook/signer, and BEFORE_SWAP permission bits. |
| 9 | Replacement pool initialization | VERIFIED | Fresh quote before broadcast: CoinGecko ETH/USD `$2,424.10`, USDC/USD `$0.999690`, timestamp `1793839194`; stale Sepolia USDC/USD Chainlink feed was not used. `sqrtPriceX96=1608929415753579531813955534048791`, implied tick 198384, Pool ID `0xba95e58e09df6620bcf06cf124eb902eba371655696b14ba8b43ec1b9fc22235`. No-broadcast simulation passed at 1 gwei, estimating max `0.000196294 ETH`. Transaction `0xa177a7272260716ae9ff6d48e8ed3e20e565eb6d9c3380d33c1175a2f3e4f55e` succeeded in block `12066060`, 134219 gas, actual fee `3422591076731 wei` (`0.000003422591076731 ETH`). Read-only preflight confirmed the expected initialized price/tick and deployment links/permissions; active liquidity was subsequently added and is verified in milestone 10. An earlier broadcast attempt failed without sending a transaction; one user-authorized retry succeeded.
| 10 | Liquidity provisioning | VERIFIED | Live calculation at block `12066143` for liquidity `1000000000000` and ticks `198300–198480` required `233648` raw USDC (`0.233648 USDC`) and `85991482586126` wei WETH (`0.000085991482586126 WETH`); caps were `250000` USDC and `150000000000000` wei WETH. `PrepareSepoliaPool.executeLiquidity()` reuses planner validations and requires `POOL_SETUP_EXECUTE=true`. `forge build script/PrepareSepoliaPool.s.sol` and `forge fmt --check script/PrepareSepoliaPool.s.sol` passed; the no-broadcast `executeLiquidity()` simulation passed at 1 gwei, estimating `0.001858584 ETH`. Transaction `0xd6b628dee7f2498e5de379801a9ddfd798b12cec52385e880369aebbc4c5d8c4` succeeded in block `12066165`, using 1,345,582 gas and costing `706430559419074 wei` (`0.000706430559419074 ETH`). LP spend was exactly `233648` USDC raw and `85991482586126` WETH wei; PositionManager NFT `41352` belongs to the LP owner. Post-state preflight at block `12066166` verified the expected Pool ID, price, tick `198384`, active liquidity `1000000000000`, and deployment wiring. Root `.env` remains unchanged. |
| 11 | Protected USDC → WETH swap | BLOCKED | Fresh transaction-simulation audit on 2026-11-06 confirmed the live `registerPolicy` estimate at `938573` gas for a fresh nonce `224` policy; the live quote had only 4 seconds remaining at capture. An isolated local Sepolia fork at block `12075191` then simulated the full sequence with a separate local RPC and impersonated account (no real private key): approval estimate/use `29889/29825`, registration estimate/use `935426/921608`, protected swap estimate/use `351099/330906`; local registry state became registered and consumed. The quote expired during the local simulation/reporting window, so these are local control-flow results only, not live readiness evidence. On Sepolia, allowance remains `0`, nonce `222` remains unregistered/unconsumed, and no transaction authorization has been granted. |
| 12 | Protected WETH → USDC swap | BLOCKED | Both current and prior read-only reviews produced genuine quotes and signer-valid policies, but the current WETH allowance to the Deployment B router is `0` and no policy is registered. No transaction authorization has been granted. The swap remains unexecuted; approval, policy registration, fresh gas estimation, and receipt/balance verification are still required. |
| 13 | Production readiness review | BLOCKED | Deployment B contracts, wiring, pool initialization, active liquidity, genuine quote generation, policy signing, off-chain quote-expiry validation, and an isolated local-fork end-to-end simulation are verified. Live Sepolia fee data returned `eth_gasPrice=17 wei`, latest base fee `15 wei`, and priority fee `2 wei`; fee-history rewards ranged from a few wei to approximately `1 gwei`, so `1 gwei` remains only a planning assumption. Live registration estimate was `938573` gas. Local fork estimates were approval `29889`, registration `935426`, and swap `351099`; they are not substitutes for live estimates. The frontend has no automatic expiry restart after registration; it fails closed and requires a new policy flow. The on-chain policy does not bind quote ID or quote expiry. The repository-root `.env` still contains stale legacy aliases, but backend `.env` and frontend source defaults used for this preflight are Deployment B-only; the root file was not loaded or changed. Both swaps remain unexecuted and no transaction authorization has been granted. Browser wallet UX remains unverified. |

### Sepolia transaction log

Deployment operation (nine successful receipts; all target addresses verified by code presence and read-only wiring preflight):

| Transaction hash | Block | Result | Gas used | Effective gas price | Fee |
|---|---:|---|---:|---:|---:|
| `0x07e32ddbede35cccf0e6d7175835b0ed6c2f561f622aec6ee5a083506c19226e` | 12065885 | success; Registry created | 3166944 | 25500051 wei | 80757233514144 wei |
| `0xb4bfe46f83dca56ade9ec3841ca8425a518bd7ab64bf82ed3ac10578e43d06e0` | 12065886 | success; Verifier created | 3798695 | 25500051 wei | 96866916233445 wei |
| `0x93d08952ab2716dfc8facce0935ad68f8616c96a2cd69cb83a11223c4cd6e437` | 12065887 | success; Authorization created | 3581259 | 25500051 wei | 91322287144209 wei |
| `0x58e6e177d9e3b4218de9252c5602acb62a08ea92a857b60145f2366d2b34dc06` | 12065888 | success; verifier signer configured | 129584 | 25500051 wei | 3304398608784 wei |
| `0x1d3949b56e4268a17f46be6cc9a8d0d945c8d75ed4f84f25670fe56977b46060` | 12065889 | success; registry registrar configured | 129578 | 25500051 wei | 3304245608478 wei |
| `0x782f1a957bb63f4f9eb2518a06831217fae4b9b3e611ed5e2a6a645aa3832faf` | 12065890 | success; registry consumer configured | 129490 | 25500051 wei | 3302001603990 wei |
| `0xb78c005d651654cc408dd9105cbbae285ac6a3b8ead53c28ae8541a5c5daa46e` | 12065891 | success; Router created | 9745261 | 25500051 wei | 248504652508311 wei |
| `0x97507554f71f9dfb4ed42d8c6d8ffe4773b9ec5e43abfb3c356cdcea3da861c9` | 12065892 | success; Hook CREATE2 deployment | 4182350 | 25500051 wei | 106650138299850 wei |
| `0x910f3f5356a297241ee1afa829101dd37732875225aa36c5a86a1febfb628510` | 12065893 | success; authorization hook configured | 125976 | 25500051 wei | 3212394424776 wei |

Total deployment fee: `637224267945987 wei` (`0.000637224267945987 ETH`).

Pool initialization transaction: `0xa177a7272260716ae9ff6d48e8ed3e20e565eb6d9c3380d33c1175a2f3e4f55e` (successful receipt and post-transaction read-only state verification; see milestone 9).

Token and Permit2 approvals (all successful Sepolia receipts; amounts are capped at the liquidity plan maxima):

| Transaction hash | Block | Result | Gas used | Effective gas price | Fee |
|---|---:|---|---:|---:|---:|
| `0x099bb67754bee3d5ef114ddcb6b42a95ced5cd788b191047e5a4becbdb7825a5` | 12066098 | USDC ERC-20 approval to Permit2; allowance `250000` raw units | 39777 | 999999999 wei | 39776999960223 wei |
| `0x026d3f7cb285cb3936445eff0000a8c6ef3cb739f1ae266ddc8dda9414eebd2c` | 12066099 | WETH ERC-20 approval to Permit2; allowance `150000000000000` wei | 29980 | 999999999 wei | 29979999970020 wei |
| `0x50e1ace22d0bc56b93531369e535b16b9eb5a291edaea5218b127bb7c05b3fd7` | 12066119 | Permit2 USDC allowance to PositionManager; amount `250000`, expiry `1793840988` | 31690 | 999999998 wei | 31689999936620 wei |
| `0xe1b509bf3de49908c5e4657267702eb0b7550e9bd88493ea23aab49805694910` | 12066120 | Permit2 WETH allowance to PositionManager; amount `150000000000000`, expiry `1793840988` | 31714 | 999999998 wei | 31713999936572 wei |

Combined liquidity-setup approval fees: `133160999803435 wei` (`0.000133160999803435 ETH`). Post-approval liquidity preflight at block `12066127` passed the live pool, owner, token-balance, token-allowance, Permit2-allowance, and deadline checks. Swap-input approvals and swap receipts are recorded in milestones 11 and 12.

Liquidity provisioning transaction: `0xd6b628dee7f2498e5de379801a9ddfd798b12cec52385e880369aebbc4c5d8c4` (block `12066165`; success; 1,345,582 gas; effective gas price `525000007 wei`; fee `706430559419074 wei`). The receipt minted PositionManager NFT `41352` to `0x016B78a30CE176EF0B90c122e8677e13aAB2A815`. Post-state balances were `10.941417 USDC` and `0.000738041507137325 WETH`, exactly reflecting the calculated token spends. Read-only preflight at block `12066166` reported `MIGRATION PREFLIGHT: READY FOR SEPARATE REVIEW` and active liquidity `1000000000000`.

## Execution-first immediate blockers and shortest sequence

The deployment, pool initialization, and liquidity are verified. The protected swap directions remain blocked and unexecuted: live swap-input allowance is zero, no live policy is registered, and no transaction authorization has been granted. The browser still lacks an injected wallet and could not reach its local API/public RPC, so frontend execution remains unverified.

1. **Deployment inputs:** The root `.env` has `RPC_URL` and `DEPLOYER_PRIVATE_KEY`; the deployment script now defaults `SIGNER_PRIVATE_KEY` to the deployer key. The derived deployer/signer identity matches the script's expected address. Use an explicit RPC URL (or map `RPC_URL` to `SEPOLIA_RPC_URL` in the process); shell expansion of an unset `SEPOLIA_RPC_URL` happens before Foundry reads `.env`.
2. **Deployment completed:** The nine receipts, actual total fees, and replacement wiring preflight are recorded above. The deployment was within the user-selected 0.0329 ETH cap.
3. **Wiring verified:** Deployment and post-initialization preflights verified the actual replacement addresses, links, hook permissions, Pool ID, and pool state.
4. **Pool initialized and funded:** Active liquidity `1000000000000` at tick 198384 is verified. Required liquidity token approvals have been made at the exact planned caps.
5. **Application configuration:** Backend V2 addresses and signing were enabled with process-only overrides for checks; `.env` files remain untouched. Frontend was built with matching V2 pins; its browser check is blocked by missing injected wallet and browser network access.
6. **Swap preflight and execution:** Read-only preflight and isolated local-fork simulation verified the control flow and contract protections, but did not change Sepolia state. Live swap-input allowance remains zero; no live approval, policy registration, or protected swap receipt exists.
7. **Remaining validation:** Repeat the same flow through a real injected-wallet browser session and update the frontend V2 build configuration before treating the user-facing path as verified.

The deployment, initialization, liquidity-token approvals, Permit2 allowances, and liquidity provisioning are recorded above. Both protected swaps remain unexecuted; no swap-input approval, policy registration, or swap transaction has been authorized or broadcast. No `.env` file was modified; backend signing and frontend deployment trust were process-only validation settings.

The quote-lifecycle hardening is implemented and frontend-validated: approval now precedes policy signing and registration, a minimum quote window is required, and stale execution fails closed. This does not bind quote identity or quote expiry on-chain and does not remove the need for a fresh, explicitly authorized live transaction sequence.

## Next recommended task

Run the browser flow with an injected Sepolia wallet using the verified V2 configuration, then capture frontend transaction/activity evidence. Keep production readiness blocked until that user-facing path is independently verified.
