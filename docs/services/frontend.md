# Frontend service

The frontend is a React 19 single-page application built with Vite. It is the only component that reads pool state, decides whether the user may ask for a policy, and submits the two transactions. All of its guards are advisory: they stop this UI from submitting, and nothing else.

Source: `frontend/src`. Entry point: [frontend/src/main.tsx](../../frontend/src/main.tsx). Package manifest: [frontend/package.json](../../frontend/package.json).

## Route map

Routing uses `react-router-dom` in browser-history mode. There are five routes under one shell layout and a catch-all that redirects to the trade page ([frontend/src/App.tsx:15](../../frontend/src/App.tsx#L15)).

| Path | Component | Purpose |
| --- | --- | --- |
| `/` | `TradePage` | The protected swap flow: amount, direction, risk check, policy signing, execution |
| `/activity` | `ActivityPage` | Local and on-chain activity for the connected wallet, with CSV export |
| `/portfolio` | `PortfolioPage` | ETH, WETH and USDC balances, wrap and unwrap, exact-amount router allowances |
| `/policies` | `PoliciesPage` | Inspect a policy by id and edit local defaults |
| `/network` | `NetworkPage` | Contract address verification, authorized signer, backend health and monitor state |
| `*` | redirect to `/` | Unmatched paths |

The shell renders a fixed side navigation, a demo banner that appears only in demo mode, a top bar with wallet, network, gas and backend status, and the routed page ([frontend/src/layout/AppShell.tsx:7](../../frontend/src/layout/AppShell.tsx#L7)).

Navigation labels come from a static list ([frontend/src/layout/SideNav.tsx:3](../../frontend/src/layout/SideNav.tsx#L3)). There is no route-level authentication and no route-level data guard: every page renders without a wallet and shows a connect prompt where a wallet is required.

## Configuration modules

Three small modules under `frontend/src/config` hold values that other layers also know, and each is a copy rather than a fetched value:

| Module | Holds |
| --- | --- |
| `config/env.ts` | The backend URL, the demo flag, the deployment-verified flag, and the local-URL helper |
| `config/swapPool.ts` | Token addresses, the pool key, the derived pool id, and the v4 price bounds |
| `config/policy.ts` | `POLICY_TTL_SECONDS` (10 minutes), a mirrored `POLICY_MAX_TTL_SECONDS` (30 minutes), and the pure `buildPolicyExpiry` |

`config/policy.ts` is the newest of the three and exists because the expiry is a security parameter. The backend ceiling in `backend/src/policy/policyRequest.ts` remains authoritative; the frontend keeps a copy only so it can assert its own requests stay inside it, and `config/policy.test.mjs` asserts that relationship at test time ([frontend/src/config/policy.ts:4](../../frontend/src/config/policy.ts#L4)).

## Context

`TradeContext` is the single shared state container. `TradeProvider` wraps the router ([frontend/src/App.tsx:15](../../frontend/src/App.tsx#L15)), and `useTrade()` throws when called outside it ([frontend/src/context/TradeContext.tsx:219](../../frontend/src/context/TradeContext.tsx#L219)).

`useTradeState` composes seven hooks and derives the readiness inputs ([frontend/src/context/TradeContext.tsx:48](../../frontend/src/context/TradeContext.tsx#L48)):

| Composed hook | Contributes |
| --- | --- |
| `useWallet` | Account, native balance, chain id, `ensureSepolia`, wrong-network flag |
| `useProtocol` | Deployment addresses read from chain, `protocolAddressesVerified`, `hasAuthorization` |
| `useProtectedQuote` | Pool snapshot assessment, backend pool-key verification, quote age |
| `useBackendHealth` | `/health` polling every 15 seconds |
| `usePolicy` | Risk preview, policy request, registration, action status |
| `useExecution` | Approval, gas estimate, `executeSwap`, receipt |
| `useTokenBalance` | ERC-20 balance of the selected input token |

The context also owns the inputs that reset the flow: `inputToken`, `outputToken`, `inputAmount`, `slippageBps`. Changing any of them, or switching direction, clears the policy, the risk preview and the execution result ([frontend/src/context/TradeContext.tsx:147](../../frontend/src/context/TradeContext.tsx#L147) to [frontend/src/context/TradeContext.tsx:178](../../frontend/src/context/TradeContext.tsx#L178)). The intent is that a policy can never be reused for a changed form.

## Hooks

| Hook | Polling | Responsibility | Source |
| --- | --- | --- | --- |
| `useWallet` | none | `requestAddresses`, native balance, `switchChain` to Sepolia | [frontend/src/hooks/useWallet.ts:8](../../frontend/src/hooks/useWallet.ts#L8) |
| `useProtocol` | once | Reads `poolManager` and `authorization` from the hook, `registry` and `verifier` from the authorization contract, `owner` and `authorizedConsumer` from the registry, `authorizedSigner` from the verifier | [frontend/src/hooks/useProtocol.ts:23](../../frontend/src/hooks/useProtocol.ts#L23) |
| `useProtectedQuote` | 10 s | Reads chain id, code at PoolManager, code at the hook, the hook's two immutables, and `slot0` and liquidity through `extsload`; assesses a snapshot; verifies the backend pool-key document | [frontend/src/hooks/useProtectedQuote.ts:23](../../frontend/src/hooks/useProtectedQuote.ts#L23) |
| `useBackendHealth` | 15 s | Fetches `/health` and validates the body | [frontend/src/hooks/useBackendHealth.ts:10](../../frontend/src/hooks/useBackendHealth.ts#L10) |
| `usePolicy` | none | `POST /risk-preview`, `POST /policy`, `registerPolicy`, policy inspection | [frontend/src/hooks/usePolicy.ts:63](../../frontend/src/hooks/usePolicy.ts#L63) |
| `useExecution` | none | Balance and allowance checks, approval, gas estimate, `executeSwap`, receipt | [frontend/src/hooks/useExecution.ts:49](../../frontend/src/hooks/useExecution.ts#L49) |
| `useTokenBalance` | on account or token change | ERC-20 balance, cached per owner and token | [frontend/src/hooks/useTokenBalance.ts:20](../../frontend/src/hooks/useTokenBalance.ts#L20) |
| `useActivityFeed` | on demand | `getLogs` over the last 50,000 blocks for `PolicyRegistered` and `SwapPolicyEnforced`, merged with local rows | [frontend/src/hooks/useActivityFeed.ts:19](../../frontend/src/hooks/useActivityFeed.ts#L19) |

`useProtectedQuote` reads pool state without an indexer. `poolStateSlots` computes the `slot0` slot as `keccak256(poolId, 6)` and the liquidity slot as `slot0 + 3` ([frontend/src/lib/protectedQuote.ts:370](../../frontend/src/lib/protectedQuote.ts#L370)). This is a direct dependency on PoolManager's storage layout: if the layout changes in a v4 release, these slots move and the read silently returns the wrong word. The `sqrtPriceX96` and `activeLiquidity` decoders mask the low 160 and 128 bits respectively ([frontend/src/lib/protectedQuote.ts:380](../../frontend/src/lib/protectedQuote.ts#L380)).

## Readiness gate chain

`frontend/src/lib/protectedQuote.ts` is the single source of truth for whether the UI may proceed. No page re-implements any part of it.

### Stage 1: the pool snapshot

`assessProtectedPool` takes a snapshot and expectations and returns either an unavailable result with a reason, or an available quote ([frontend/src/lib/protectedQuote.ts:212](../../frontend/src/lib/protectedQuote.ts#L212)). The checks run in this order, and the first failure wins.

| Order | Reason | Condition |
| --- | --- | --- |
| 1 | `wrong-chain` | Snapshot chain id differs from the expected chain id |
| 2 | `pool-manager-mismatch` | The hook's `poolManager` differs from the expected PoolManager |
| 3 | `pool-manager-missing` | No code at the PoolManager address |
| 4 | `hook-mismatch` | Hook address, hook's PoolManager or hook's authorization differ from expected |
| 5 | `hook-missing` | No code at the hook address |
| 6 | `unsupported-pool-key` | Recomputed pool id differs, currencies are not sorted, fee is not 3000, or tick spacing is not 60 |
| 7 | `pool-id-mismatch` | Snapshot pool id differs from the expected pool id |
| 8 | `stale-pool-state` | Observation time is in the future, or older than 15 seconds |
| 9 | `uninitialized-pool` | `sqrtPriceX96` is zero |
| 10 | `zero-active-liquidity` | Active liquidity is zero |
| 11 | `quote-simulation-unavailable` | Always, at present |

Step 11 is not a bug in the ordering. The function ends by returning `quote-simulation-unavailable` unconditionally, with the comment that pool spot state cannot reproduce tick traversal, fees and router effects ([frontend/src/lib/protectedQuote.ts:260](../../frontend/src/lib/protectedQuote.ts#L260)). There is no quoter integration, so an `available` quote is never produced by this build. The `available` variant exists in the type, and the tests construct one directly, but runtime code cannot reach it.

`loadProtectedPoolQuote` wraps the same assessment and converts a thrown RPC error into `rpc-failure` ([frontend/src/lib/protectedQuote.ts:268](../../frontend/src/lib/protectedQuote.ts#L268)).

### Stage 2: backend pool-key agreement

`matchesBackendProtectedPoolConfig` compares `GET /config/protected-pool` against the same expectations: `configurationStatus` must be `"valid"`, `poolReadiness` must be `"not-checked"`, the chain id and pool id must match, and all five pool-key fields must match ([frontend/src/lib/protectedQuote.ts:70](../../frontend/src/lib/protectedQuote.ts#L70)). Failure sets `backendPoolKeyVerified` to false.

`backendPoolKeyVerified` is additionally gated on demo mode being off or the backend URL being local ([frontend/src/hooks/useProtectedQuote.ts:138](../../frontend/src/hooks/useProtectedQuote.ts#L138)). A demo build pointed at a remote backend reports the pool key as unverified.

### Stage 3: deployment and policy readiness

`calculateSwapReadiness` composes eight booleans into two decisions and a reason list ([frontend/src/lib/protectedQuote.ts:312](../../frontend/src/lib/protectedQuote.ts#L312)).

Inputs:

| Input | Source |
| --- | --- |
| `amountInBaseUnits` | Parsed form amount |
| `quote` and `nowMs` | `useProtectedQuote` |
| `poolId` | `SWAP_POOL_ID`, recomputed from the pool key |
| `poolKeyMatches` | Direction resolved from token addresses |
| `backendPoolKeyVerified` | Stage 2 |
| `protocolAddressesVerified` | `useProtocol` |
| `minimumOutputProtocolVerified` | `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` |
| `authorizationVerified` | Registry consumer equals authorization address |
| `policyBoundsVerified` | A registered policy with decimal-string bounds |
| `demoMode`, `demoEstimateAvailable` | Demo configuration and the fixed-rate estimate |

`canCheckRisk` is the conjunction of the first eight, with the output-estimate term satisfied either by a fresh quote or, in demo mode, by a demo estimate. `canExecute` is `canCheckRisk` and `policyBoundsVerified`. Every failed input also appends a human-readable reason, which the trade page renders as a checklist ([frontend/src/pages/TradePage.tsx:218](../../frontend/src/pages/TradePage.tsx#L218)).

`VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` is `false` in the committed example environment ([frontend/.env.example:5](../../frontend/.env.example#L5)). While it is false, `canCheckRisk` is false, `canExecute` is false, and the trade page cannot progress past the amount field. This is the intended state described in [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).

### Stage 4: re-checks at click time

Both mutating actions recompute readiness rather than trusting the render-time value.

- `createPolicy` calls `calculateSwapReadiness` again with `policyBoundsVerified: false`, because no policy exists yet, and requires `canCheckRisk` ([frontend/src/hooks/usePolicy.ts:193](../../frontend/src/hooks/usePolicy.ts#L193)).
- `executeProtectedSwap` requires `swapReadiness.canExecute`, then re-checks quote freshness with a fresh `Date.now()` for demo readiness, and re-compares the registered policy's `poolId`, `trader`, `amountSpecified`, `zeroForOne` and `minAmountOut` against the current form ([frontend/src/hooks/useExecution.ts:128](../../frontend/src/hooks/useExecution.ts#L128) to [frontend/src/hooks/useExecution.ts#L146](../../frontend/src/hooks/useExecution.ts#L146)).

The re-comparison is what prevents a policy signed for one amount from being executed with another. It compares strings, so a form change that rounds to the same base units still matches.

## Page responsibilities

### Trade

One primary button advances through check, then sign ([frontend/src/pages/TradePage.tsx:51](../../frontend/src/pages/TradePage.tsx#L51)). A second button executes, and is rendered only after a policy is registered. The page renders the readiness checklist, the action status, a shield report with the risk metrics, a lifecycle strip of quoted, registered, executed, consumed, and a receipt panel with an Etherscan link.

The pay field shows the ERC-20 balance of the selected input token. For the ETH entry that is the WETH balance, and the page says so inline with a link to the portfolio page for wrapping ([frontend/src/pages/TradePage.tsx:196](../../frontend/src/pages/TradePage.tsx#L196)).

The slippage control offers three presets and a free-form field, and the free-form field is hidden in demo mode ([frontend/src/pages/TradePage.tsx:119](../../frontend/src/pages/TradePage.tsx#L119)).

### Activity

Rows come from two sources: the local store, and `getLogs` over a 50,000-block lookback filtered to the connected account by fetching each transaction to read its sender ([frontend/src/hooks/useActivityFeed.ts:74](../../frontend/src/hooks/useActivityFeed.ts#L74)). Rows are de-duplicated by id and sorted by the local `time` field, which for on-chain rows is the time of the refresh, not the block time. Amount columns are em dashes for chain-derived rows because the events carry no amounts.

The status filter offers registered, executed, enforced, failed and reverted. Only registered, enforced and executed are ever produced by current code; `failed` and `reverted` are reachable only through locally stored rows.

### Portfolio

Balances for ETH, WETH and USDC, wrap and unwrap through the WETH9 deposit and withdraw functions, and two allowance cards for exact-amount approval and revoke to zero ([frontend/src/pages/PortfolioPage.tsx:111](../../frontend/src/pages/PortfolioPage.tsx#L111)). All writes go through one `submit` helper that ensures Sepolia, waits for a receipt and refreshes ([frontend/src/pages/PortfolioPage.tsx:90](../../frontend/src/pages/PortfolioPage.tsx#L90)).

### Policies

Shows the current session policy, inspects any policy id through `getPolicy` and `isConsumed`, and edits local defaults for slippage, max loss and max fee ([frontend/src/pages/PoliciesPage.tsx:10](../../frontend/src/pages/PoliciesPage.tsx#L10)). The defaults are stored in `localStorage` and only the slippage value is applied to the trade form; the loss and fee values are labelled as stored locally and are not used when requesting a policy.

### Network

Six contract rows compared against expected constants, an authorized-signer row, backend health and monitor state, and the registry owner. The three rows sourced from `useProtocol` show a live pass or mismatch. Two rows, `MEVShieldHook` and `MEVShieldRouter`, compare a constant against itself and so always pass; `PolicyAuthorization` compares against `CONTRACTS.poolAuthorization`, which is the same literal as `CONTRACTS.policyAuthorization` ([frontend/src/pages/NetworkPage.tsx:18](../../frontend/src/pages/NetworkPage.tsx#L18)). Those three rows are static assertions of the configuration, not verification of on-chain state.

## Wallet interaction

`getWalletClient` requires `window.ethereum` and throws a readable error otherwise ([frontend/src/lib/viem.ts:17](../../frontend/src/lib/viem.ts#L17)). There is no WalletConnect or other connector.

`ensureSepolia` switches the chain when the wallet is on another network ([frontend/src/hooks/useWallet.ts:34](../../frontend/src/hooks/useWallet.ts#L34)). It is called before registration and before execution.

The public client uses a fixed public RPC endpoint, `https://ethereum-sepolia-rpc.publicnode.com`, hard-coded in both the chain definition and the transport ([frontend/src/lib/contracts.ts:3](../../frontend/src/lib/contracts.ts#L3), [frontend/src/lib/viem.ts:12](../../frontend/src/lib/viem.ts#L12)). There is no environment variable for the read RPC, and no fallback transport.

## Telemetry

`reportTransactionEvent` posts four event types to `/observability/transaction` with the request id that produced the policy ([frontend/src/lib/telemetry.ts:9](../../frontend/src/lib/telemetry.ts#L9)). Delivery failure is swallowed and logged locally, so a backend outage does not block the swap flow.

Frontend logs are JSON lines on the browser console, prefixed with `service: "mevshield-frontend"` ([frontend/src/lib/observability.ts:9](../../frontend/src/lib/observability.ts#L9)). `safeError` redacts long hex blobs and truncates to 240 characters before any message is logged or posted ([frontend/src/lib/observability.ts:24](../../frontend/src/lib/observability.ts#L24)).

## Known limitations

- No quote is ever produced. Stage 1 always ends at `quote-simulation-unavailable`, so outside demo mode the UI cannot reach the risk check at all, independently of the `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` gate.
- The expiry the UI requests comes from `buildPolicyExpiry` in [frontend/src/config/policy.ts](../../frontend/src/config/policy.ts), which adds `POLICY_TTL_SECONDS` (10 minutes) to the current clock ([frontend/src/hooks/usePolicy.ts:305](../../frontend/src/hooks/usePolicy.ts#L305)). The file also exports `POLICY_MAX_TTL_SECONDS`, a copy of the backend ceiling, so the client can assert its request stays inside it. The backend constant remains the source of truth; the copy is a mirror, and `frontend/src/config/policy.test.mjs` catches drift between the two at test time rather than at runtime.
- The pool-state reader depends on PoolManager storage slots computed by hand.
- The read RPC is hard-coded and unauthenticated, so the UI's notion of pool state inherits that endpoint's availability and correctness.
- The activity feed fetches one transaction per log to filter by sender, over a 50,000-block window, with no batching or caching. A wallet with many interactions will issue many RPC calls per refresh.
- Three of the six Network page rows are static comparisons and cannot detect a mismatch.
- `frontend/src/App.tsx.before-swap-label-fix`, an unused copy of an earlier `App.tsx`, has been removed from the tree.

## Running the app

```
cd frontend
npm ci
npm run dev     # vite
npm run demo    # vite --mode demo
npm test        # node --experimental-strip-types --test src/lib/*.test.mjs
npm run lint    # oxlint
npm run build   # tsc -b && vite build
```

`npm run demo` runs Vite in the `demo` mode. Demo mode in the app additionally requires `VITE_SEPOLIA_DEMO_MODE=true` at build time and `import.meta.env.DEV` to be true ([frontend/src/config/env.ts:4](../../frontend/src/config/env.ts#L4)), so a production build cannot enter demo mode.

## Related pages

- [API reference](../api/reference.md).
- [Features](../features/protected-swap.md).
- [Configuration](../operations/configuration.md).
- [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).
