# 0003 Read pool id and hook from configuration rather than router getters

## Status

Accepted. Implemented. The router never had the getters.

## Context

Callers needed the protected pool id and the hook address. Two candidates existed:

1. Read them from the router, which would require `protectedPoolId()` and `protectedHook()` on `MEVShieldRouter`.
2. Read them from configuration: environment variables on the backend, constants in the frontend.

Several briefs asserted that `protectedPoolId()` and `protectedHook()` existed on the deployed router at `0x6332…150D`, and that this explained why callers were failing.

The investigation recorded in `docs/reviews/2026-10-28-router-bytecode-investigation.md` on the `fix/router-source-of-truth` branch established:

- The selectors for both functions are absent from the deployed runtime bytecode.
- `cast call` on both reverts.
- `git grep` finds neither symbol in committed source at HEAD or at `ae3cc4f`.
- After stripping the CBOR metadata tail and masking the `poolManager` immutable, the deployed runtime matches the HEAD build and the `ae3cc4f` build, and does not match the `027c927` build recorded in the deployment broadcast.

So the getters never existed. The premise of option 1 was false.

## Decision

Read pool identity from configuration.

- Backend: the six `PROTECTED_POOL_*` variables, validated at startup, with the pool id recomputed from the pool key and compared both to the configured value and to a pinned constant ([backend/src/config/runtimeConfig.ts:69](../../backend/src/config/runtimeConfig.ts#L69)).
- Frontend: `SWAP_POOL_KEY` and `SWAP_POOL_ID` derived from token addresses plus the fee, tick spacing and hook constant, with `SWAP_POOL_ID` computed by `calculatePoolId` rather than hard-coded ([frontend/src/config/swapPool.ts:38](../../frontend/src/config/swapPool.ts#L38)).
- No new getters were added to the router.

The frontend additionally verifies configuration against live chain state, so a wrong constant fails closed rather than silently producing a wrong pool id. `assessProtectedPool` recomputes the pool id from the key and the expectations, and `matchesBackendProtectedPoolConfig` compares the backend document to the same expectations.

## Consequences

Benefits:

- No contract change, no redeploy, no new pool. The fix is a documentation and caller correction.
- Configuration is visible and reviewable outside the contracts.
- The frontend's derivation is testable without a chain: `protectedQuote.test.mjs` covers pool id and pool key rejection cases.
- Because the pool id is recomputed rather than compared as a string in isolation, a mismatch between the key and the id is caught at startup on the backend and at page load in the frontend.

Costs:

- Two sources of truth for the same addresses, in `frontend/src/lib/contracts.ts` and in the backend environment and pinned constants. They must be kept in sync by hand, and nothing forces that.
- The backend pins the values in source, so a redeploy requires a code change, not a configuration change. That is stated as a feature in [ADR 0004](0004-fail-closed-sepolia-configuration.md) but it is still friction.
- The monitor reads its registry and hook addresses from separate environment variables that are not compared to the pin, so the monitor can be pointed at the wrong contracts while the rest of the backend refuses to start.
- Documentation must not describe the router as a source of pool identity. Any brief that does is wrong.

If on-chain getters are ever wanted, the correct sequence is: add them to the router with tests, redeploy through `script/DeploySepolia.s.sol` from a clean tree, update the broadcast record and Etherscan verification, rerun the fork suites, and only then let callers depend on them.

Related: [ADR 0002](0002-router-versus-hook-enforcement-split.md), [ADR 0004](0004-fail-closed-sepolia-configuration.md).
