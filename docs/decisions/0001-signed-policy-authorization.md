# 0001 Signed policy authorization model

## Status

Accepted. Implemented. The signing route is gated closed by default.

## Context

A swap needs to be constrained by parameters that are decided off-chain, because the risk estimate, the minimum output calculation and the pool configuration all live outside the contracts. The constraint has to survive between the moment it is decided and the moment the swap executes, across two separate transactions: one to register the constraint, one to execute the swap.

Three properties are needed:

1. The constraint cannot be altered between decision and execution by anyone, including the user.
2. The constraint cannot be reused for a second execution.
3. The constraint cannot be applied to a different pool, a different direction or a different amount than the one it was decided for.

An on-chain registry alone gives (1) only if registration is restricted to a trusted writer, and gives (2) only if the execution path consults it. Neither addresses (3) without binding the execution parameters.

Alternatives considered were: a plain on-chain policy with no signature, trusted because the writer is restricted; a commit-reveal scheme over the policy hash; and a per-swap oracle attestation.

## Decision

Authorise policies with an EIP-712 signature produced by a single off-chain key, and verify that signature on-chain at swap time.

The signed type is the ten-field struct declared in `PolicyVerifier`: `poolId`, `trader`, `nonce`, `expiry`, `maxLoss`, `maxFee`, `zeroForOne`, `amountSpecified`, `sqrtPriceLimitX96`, `minAmountOut` ([src/PolicyVerifier.sol:8](../../src/PolicyVerifier.sol#L8), type hash at [src/PolicyVerifier.sol:21](../../src/PolicyVerifier.sol#L21)).

The domain is `EIP712("MEVShield", "1")` with the deployment's chain id and verifying contract address ([src/PolicyVerifier.sol:42](../../src/PolicyVerifier.sol#L42)). A signature is therefore bound to one chain and one verifier.

Execution is a two-transaction flow:

1. `PolicyAuthorization.registerPolicy` verifies the signature and writes the record to `PolicyRegistry`. Permissionless.
2. `PolicyAuthorization.authorize` re-verifies the signature, compares the presented policy against the stored record, and consumes the nonce. Hook-only.

Both transactions verify the signature. The registration step is not a trust anchor; it is a cache.

The signing key lives in the backend process, loaded from `SIGNER_PRIVATE_KEY`, and the derived address must equal the on-chain `authorizedSigner` ([backend/src/config/runtimeConfig.ts:192](../../backend/src/config/runtimeConfig.ts#L192)).

## Consequences

Benefits:

- The signature commits to the ten execution-relevant fields, so neither the user nor the registrar can substitute a different pool, direction, amount or limit.
- Replay is prevented by the `(trader, nonce)` consumption table, not by the signature alone, which means a signature cannot be reused even by someone who copies it.
- Because `authorize` re-verifies, rotating `authorizedSigner` immediately invalidates every outstanding policy including registered ones. That is a usable emergency stop for the whole flow.
- Registration is permissionless without weakening the model, since the signature is the authority and the nonce table prevents a second registration.
- No trusted writer needs to hold a key that can mint policies directly on-chain.

Costs and accepted risks:

- The backend becomes the sole minting authority. Anyone who can reach `POST /policy` can obtain a signature when signing is enabled, and the route has no caller authentication. This is accepted only while the route is gated closed by `MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=false` and the 503 feature gate.
- The key is a single hot key in process memory. Rotation requires an owner transaction plus a redeploy of the backend configuration.
- The registry stores seven of the ten signed fields, so the stored record is not a commitment to the full signed policy. Mitigated at execution time by the hook and router, which compare direction, amount and price limit against the live swap parameters. Not mitigated for a registry reader.
- A policy has no cancellation. Once registered, it is executable until consumed or expired.
- The signed `trader` is the router, not the user, because the hook requires `policy.trader == sender` and the caller of `PoolManager.swap` is the router. Payer and recipient are consequently outside the signed statement.

Related: [ADR 0002](0002-router-versus-hook-enforcement-split.md), [ADR 0005](0005-execute-gate-stays-closed.md).
