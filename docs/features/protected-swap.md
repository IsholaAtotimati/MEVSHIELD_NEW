# Protected swap

**Status: gated.** The path exists end to end in code. The UI gate that enables it is closed in the committed configuration, and the one check that would be needed to open it honestly has not passed.

The protected swap is the core capability: a swap that executes through Uniswap v4 only if a signed policy for that exact pool, trader and set of swap parameters is presented and has not been used before.

## What it does

1. The user picks a direction between Sepolia WETH and Sepolia USDC and enters an amount on `/`.
2. The app assesses the protected pool from RPC reads and computes a readiness verdict.
3. If readiness permits, the app asks the backend for a signed policy, then submits `registerPolicy` from the user's wallet.
4. A second button submits `executeSwap` to the router, which unlocks the PoolManager, calls `swap`, lets the hook authorize and consume the policy, enforces realized minimum output and the 600-tick cap, and settles the tokens.

Both legs of the pool are ERC-20. The "ETH" entry in the token selector is WETH9, and the page says so ([frontend/src/pages/TradePage.tsx:196](../../frontend/src/pages/TradePage.tsx#L196)).

## What it depends on

| Dependency | Why |
| --- | --- |
| `MEVShieldRouter` at `0x6332…150D` | The only supported execution path for the router-side checks |
| `MEVShieldHook` at `0xd15E…0080` | The policy check point, and it must be the hook in the pool key |
| `PolicyAuthorization` at `0xefC9…d7c5` | Verifies the signature and consumes the nonce |
| `PolicyRegistry` at `0xB289…1c9E` | Holds the registered policy and the nonce tables |
| `PolicyVerifier` at `0x716f…b79f` | Holds the authorized signer |
| Backend `POST /policy` with signing enabled | Produces the signature. Closed by default |
| Backend `POST /quote` | Simulates exact-input swaps against block-pinned PoolManager state and initialized ticks |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true` | The gate that lets the UI proceed |
| WETH balance and a router allowance | Execution spends WETH; the router pulls it with `transferFrom` |

## The gate chain in order

`calculateSwapReadiness` is the only decision point ([frontend/src/lib/protectedQuote.ts:312](../../frontend/src/lib/protectedQuote.ts#L312)).

| Gate | Current state | Effect |
| --- | --- | --- |
| Positive parsed amount | User-controlled | Blocks until a valid amount is typed |
| Pool key resolves a direction | True for WETH/USDC | Never blocks on this pair |
| Protected pool has initialized state | Required | Blocks if the pool is uninitialized; active liquidity is evaluated along the requested swap direction |
| Output estimate available | Required outside demo mode | Blocks unless the v4 simulator consumes the full input before the signed price limit |
| Backend pool key verified | True when the backend is reachable and configured | Blocks if the backend is down |
| Protocol addresses verified | True when the live reads match the constants | Blocks on a mismatch |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` | `false` in the example env | Blocks |
| Route authorization verified | True when the registry consumer equals the authorization contract | Blocks on a mismatch |
| Policy bounds verified | Only after a registered policy exists | Blocks `canExecute` until a policy is registered |

The live quote path pins slot0, active liquidity, tick bitmap and initialized tick reads to one block, applies v4 swap-step fee rounding, crosses initialized ticks, and rejects unconsumed input at the price limit. Quotes expire after 15 seconds and the backend accepts a non-demo policy request only when its parameters and minimum output match a quote still held in the backend's short-lived quote cache. The simulator is covered by local unit tests but has not yet been verified against a live Sepolia quote or transaction. Demo mode remains a separate fixed-rate estimate with a 1-base-unit minimum and is not safe for value-bearing trades.

## Enforcement on the execution path

| Check | Where | Enforced against |
| --- | --- | --- |
| Signature is from the authorized signer | `PolicyVerifier.verifyPolicy` via the hook | Recovered address |
| Policy matches the registered record | `PolicyAuthorization.authorize` | The signed stored fields |
| Nonce unused | `PolicyRegistry.consumePolicy` | `consumedNonces` |
| Policy unexpired | Hook, then registry | `block.timestamp` |
| Pool matches | Hook, then router | Pool key |
| Direction, amount, price limit match | Hook, then router | Swap params |
| Trader, payer, and recipient are the executing wallet | Router | `policy.trader == msg.sender`, payer is `msg.sender`, recipient must equal `msg.sender` |
| `minAmountOut` non-zero | Hook, then router | Value |
| Realized output at least `minAmountOut` | Router | Swap delta |
| Price limit within 600 ticks and on the correct side | Router | `slot0` |
| `maxLoss` and `maxFee` | Hook | Caller-supplied estimates in `hookData` |

The last row is not a measurement. See [overview](../architecture/overview.md#what-maxloss-and-maxfee-actually-compare).

## Known limitations

- **Normal mode cannot currently execute.** `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` is false. A quote simulator and `/quote` endpoint now exist, but no live Sepolia quote or protected swap has been verified. The normal-mode gate is documented in [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).
- **Direct PoolManager swaps bypass the router.** The hook address is mined for `beforeSwap` only. A caller calling `PoolManager.swap` with valid `hookData` passes the hook but skips the realized-minimum-output check and the tick cap. The router checks protect users of the router.
- **`maxLoss` and `maxFee` are not enforced against reality.** They are compared to caller-supplied integers excluded from the signature.
- **Payer/recipient binding is enforced by router identity, not separate signed fields.** The router requires the executing wallet to equal `policy.trader`, pays from that wallet, and now rejects any recipient other than that wallet. This is compatible with the current signature schema; a future arbitrary-recipient feature would require a versioned signed-field migration.
- **No signed cancel.** A registered policy stays executable until consumed or expired.
- **The UI expiry is derived from one shared constant.** `createPolicy` calls `buildPolicyExpiry(nowSeconds)` ([frontend/src/hooks/usePolicy.ts:305](../../frontend/src/hooks/usePolicy.ts#L305)), which adds `POLICY_TTL_SECONDS`, 10 minutes ([frontend/src/config/policy.ts:23](../../frontend/src/config/policy.ts#L23)). That sits well inside the backend ceiling of 30 minutes ([backend/src/policy/policyRequest.ts:6](../../backend/src/policy/policyRequest.ts#L6)), leaving headroom for wallet approval, the registration transaction and clock skew. The frontend keeps its own copy of the ceiling as `POLICY_MAX_TTL_SECONDS` ([frontend/src/config/policy.ts:10](../../frontend/src/config/policy.ts#L10)); the backend value remains the source of truth, and the copy exists only so the client can assert its own requests stay inside it. Drift between the two copies is caught at test time by `frontend/src/config/policy.test.mjs`, which asserts the requested TTL is below the mirrored ceiling and that the derived expiry is in the future.
- **The 600-tick cap is a fixed constant.** There is no per-policy or per-user configuration, and it is not part of the signed policy.
- **The pool-state reader depends on PoolManager storage slots** computed as `keccak256(poolId, 6)` and `slot0 + 3`. A layout change in v4 would break the read silently.
- **Demo mode signs a meaningless minimum.** A minimum output of 1 base unit is not slippage protection, and the backend logs a warning saying so ([backend/src/server.ts:388](../../backend/src/server.ts#L388)).

## Demo mode

Demo mode replaces the quote with a fixed 2000 USDC per WETH estimate and replaces the minimum output with 1 base unit. It is gated on all of: `VITE_SEPOLIA_DEMO_MODE=true`, `import.meta.env.DEV`, `MEVSHIELD_SEPOLIA_DEMO_ENABLED=true` in the backend, `NODE_ENV` not `production`, the backend URL being local, and `RAILWAY_ENVIRONMENT_NAME` being unset. A banner states that the estimates are not live ([frontend/src/layout/DemoBanner.tsx:4](../../frontend/src/layout/DemoBanner.tsx#L4)).

Demo mode bypasses deployment verification only in its gated development/local builds. It still requires a fresh initialized-pool check with nonzero active liquidity, matching backend configuration, matching protocol addresses, and verified route authorization. If the configured Sepolia pool has no active liquidity, signing and execution remain disabled because the swap cannot succeed. The execute button can be used to exercise the test flow once the pool is liquid, but its 1-base-unit minimum is not meaningful protection.

## Related pages

- [Contracts](../architecture/contracts.md).
- [Frontend service](../services/frontend.md).
- [Policy lifecycle](policy-lifecycle.md).
- [API reference](../api/reference.md).
