# 0005 Execute gate stays closed until a live-stack fork test passes

## Status

Accepted. Currently in effect. `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` is `false` in the committed example environment.

## Context

The UI has one flag that opens the path from readiness to signing and execution. Until it is true, `calculateSwapReadiness` cannot return `canCheckRisk` or `canExecute`, so the trade page cannot submit anything.

The question is what evidence would justify setting it true.

Available evidence at the time of this decision:

| Evidence | What it shows | What it does not show |
| --- | --- | --- |
| 100 Forge tests, all passing, 5 skip | The source behaves as specified against a local PoolManager | Anything about the deployed addresses |
| `SepoliaForkDeploymentVerification.t.sol` passes | The deployed router and hook exist, are wired to the right PoolManager, and the protected pool has liquidity | That the deployed code matches this source, or that a swap succeeds |
| `SepoliaForkV2Router.t.sol` passes, all three cases | The current router and hook implementation enforces minimum output against the real pool's real liquidity | The deployed router and hook, because the suite deploys its own router and etches fresh hook code onto the hook address |
| Router bytecode comparison | The deployed runtime matches the HEAD build after CBOR and immutable normalisation | That a full protected swap succeeds on the deployed stack |
| `SepoliaForkDeploymentAExecution.t.sol` | Would drive the live router, hook, verifier, registry and pool together | Blocked: it requires `SIGNER_PRIVATE_KEY` in `setUp`, and no key was supplied |

The strongest available evidence is therefore a patchwork. Each item is real, and together they make a passing deployment plausible. None of them is a run of the actual deployment performing an actual protected swap.

Actors who can influence the flag: anyone with write access to the deployment environment. The flag is not enforced on-chain and not enforced by the backend.

Alternatives considered: open the gate on the strength of the V2 fork suite; open it once the bytecode comparison matched; leave it closed indefinitely with no stated condition.

## Decision

Keep the gate closed until `test/SepoliaForkDeploymentAExecution.t.sol` passes against the deployed router, hook, verifier, registry and protected pool, with a signer key supplied, at a pinned block.

The suite exists and is written for exactly this purpose. It contains two tests: `test_deployedPolicyCanAuthorizeProtectedSwap` and `test_impossibleMinimumOutputRevertsAndRollsBack`. The second is the one that matters most, because it verifies the rollback of nonce consumption on the real deployment, not on a freshly deployed copy.

Until that run passes and its output is recorded, `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` stays unset or false, and the UI execute path stays unreachable.

The same condition applies to opening the backend signing gate, since a signature is useless without an executable path and the signing route is unauthenticated.

## Consequences

Benefits:

- The gate is tied to a specific, reproducible test outcome rather than to a judgement about how much evidence feels like enough.
- The test that would open the gate is the one that exercises the deployed contracts, which is precisely the gap all the other evidence leaves.
- Keeping the gate closed also keeps the unauthenticated signing route closed, so the two exposure points are coupled to one condition.
- The condition is checkable by a reviewer: run one command, read the result.

Costs:

- The product cannot execute a protected swap through its own UI in its current state, on any branch, regardless of configuration.
- The gate does not prevent a determined user from bypassing the UI. A valid signed policy can be submitted directly to the router, and a direct `PoolManager.swap` skips the router checks entirely. The gate is a product control, not a security control.
- The condition is unreachable without access to the signer key, which means the decision rests on a party who holds it. Until then the gate stays closed by default, which is the safe failure mode but also a permanent block.
- A passing run at one block does not guarantee behaviour later. The gate should be re-run after any contract change, and the result recorded.

Note that a passing live-stack test would not close the other open findings. Loss and fee caps would still compare caller estimates, the registry would still store seven of ten fields, payer and recipient would still be outside the signed statement, and `POST /policy` would still have no caller authentication. Opening the gate would need to be accompanied by a decision about each of those.

Related: [ADR 0002](0002-router-versus-hook-enforcement-split.md), [ADR 0004](0004-fail-closed-sepolia-configuration.md), [Testing](../operations/testing.md).
