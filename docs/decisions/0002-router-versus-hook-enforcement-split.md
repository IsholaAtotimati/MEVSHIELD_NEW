# 0002 Router versus hook enforcement split

## Status

Accepted, with known gaps. The split is recorded here as it exists, not as it should be.

## Context

A policy constrains ten fields. Some of them can be checked before a swap executes: the signature, the expiry, the nonce, the pool, the direction, the amount and the price limit. One cannot: whether the realized output met the minimum. That value only exists after the swap, in the `BalanceDelta` the PoolManager returns.

Uniswap v4 offers two natural places to check constraints.

The hook runs inside the swap. `beforeSwap` cannot see the result. `afterSwap` can, but only if the hook address declares the `afterSwap` permission bit.

The router runs around the swap. It opens the unlock, calls `swap`, and receives the delta, so it can compare the realized output before settling.

The hook address is derived from a mined CREATE2 salt so that its low 14 bits encode the permission set, and the pool id is a hash of the pool key which includes that address. Changing the permission set therefore changes the hook address and the pool id, and requires a new pool with new liquidity.

Alternatives considered: enable `afterSwap` and enforce everything in the hook, accepting a new pool; enforce everything in the router and drop the hook; keep the split and name it precisely.

## Decision

Split enforcement as follows.

**`beforeSwap` in the hook** enforces signature, expiry, nonce, pool binding, swap-parameter binding, a non-zero `minAmountOut`, and comparisons of `maxLoss` and `maxFee` against caller-supplied estimates ([src/MEVShieldHook.sol:76](../../src/MEVShieldHook.sol#L76)).

**`executeSwap` in the router** enforces realized minimum output against the `BalanceDelta` and the 600-tick price-limit distance against `slot0` ([src/MEVShieldRouter.sol:154](../../src/MEVShieldRouter.sol#L154), [src/MEVShieldRouter.sol:125](../../src/MEVShieldRouter.sol#L125)).

The hook address is mined for `beforeSwap` only. All other permission flags are false, including `afterSwap` and all return-delta flags ([script/DeploySepolia.s.sol:131](../../script/DeploySepolia.s.sol#L131)). `Hooks.validateHookPermissions` asserts this at deployment.

Documentation and UI copy must describe the router checks as checks for this router, not as protocol guarantees.

## Consequences

What the split buys:

- Realized-output enforcement exists today without a new pool. The PoolManager returns the delta to the router, and the router reverts before settling if the output is short.
- The 600-tick cap has access to `slot0` at execution time and rejects a limit on the wrong side of the current price, which a policy cannot express because the current price is not known when the policy is signed.
- Parameter binding is checked twice, once before the swap and once on the minimum-output path, so a mismatch in `hookData` fails in both places.

What the split costs:

- A caller who bypasses the router and calls `PoolManager.swap` directly, with valid `hookData`, passes every hook check and skips both router checks. The hook cannot detect that it was reached by a direct swap rather than through the router.
- The router trusts `hookData` for the policy. It does not verify the signature itself and relies on the hook having already authorized the policy earlier in the same unlock.
- The router has no notion of the protected pool. It will route any pool key whose hook accepts the supplied data.
- Loss and fee caps remain unenforced against reality, because the hook has no post-swap visibility and the router is not the place the policy's caps are described as being enforced.
- Two contracts must agree on the `hookData` layout. After the reuse refactor, the EIP-712 field list is declared once in `backend/src/policy/eip712.ts` and every backend consumer imports it, but the layout itself still appears in four Solidity declarations and once more in the frontend's ABI encoding of `hookData`.

The gap that follows from this decision, stated plainly: on this deployment, a protected swap is protected only if it goes through `MEVShieldRouter`. A direct PoolManager swap is authorized but not bounded on output or price distance.

The corrective path is to enable `afterSwap`, move realized-output enforcement into the hook, redeploy the hook, and initialise a new pool, then retire the router-side checks or keep them as defence in depth. That work is not done here. Doing it requires a new pool with new liquidity, which is why it is not a small change.

Related: [ADR 0001](0001-signed-policy-authorization.md), [ADR 0003](0003-config-sourced-pool-identity.md), [ADR 0005](0005-execute-gate-stays-closed.md).
