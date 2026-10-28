# 0004 Fail-closed Sepolia configuration

## Status

Accepted. Implemented.

## Context

The backend signs policies and reports on a specific deployment. If it were pointed at the wrong chain, the wrong verifier, the wrong router or the wrong pool, three failures become possible:

1. It signs a policy whose `poolId` belongs to a pool the user did not intend.
2. It reports a verifier address that does not match the one its signatures are bound to, so every policy it produces fails at swap time with no useful diagnostic.
3. It accepts a request for an arbitrary pool and signs it, turning a signing service into an open oracle for any pool.

The service runs on Railway with a health check at `/health`. A process that starts and serves a wrong configuration is worse than a process that refuses to start, because the platform health check will report it healthy.

Alternatives considered: warn on mismatch and continue; allow an explicit override flag for local development; validate lazily on first request.

## Decision

Validate every deployment identity at startup and throw on any mismatch, so the process exits.

Pinned in source:

| Constant | Value |
| --- | --- |
| `SEPOLIA_CHAIN_ID` | `11155111` |
| `EXPECTED_AUTHORIZED_SIGNER` | `0x016B78a30CE176EF0B90c122e8677e13aAB2A815` |
| `EXPECTED_SEPOLIA_VERIFIER` | `0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f` |
| `EXPECTED_SEPOLIA_ROUTER` | `0x633282608B2fc66cD7572f5eF58e804063aa150D` |
| `EXPECTED_PROTECTED_POOL` | the WETH/USDC pool key and pool id `0x9275…b602` |

Declared at [backend/src/config/runtimeConfig.ts:9](../../backend/src/config/runtimeConfig.ts#L9) to [backend/src/config/runtimeConfig.ts:22](../../backend/src/config/runtimeConfig.ts#L22).

Enforced in `loadBackendConfig`, which throws for a wrong chain id, a missing or malformed pool variable, a pool id that does not match the pool key, a pool key that does not match the pin, a wrong verifier, a wrong router, a missing signer key when signing is enabled, and a signer key whose address does not match the pin ([backend/src/config/runtimeConfig.ts:157](../../backend/src/config/runtimeConfig.ts#L157)).

There is no override flag. Two aliases exist per address so that old environment files keep working, but every alias is checked against the same pin.

Demo mode is separately closed: it requires `MEVSHIELD_SEPOLIA_DEMO_ENABLED=true`, `NODE_ENV` not `production`, and `RAILWAY_ENVIRONMENT_NAME` unset ([backend/src/config/runtimeConfig.ts:145](../../backend/src/config/runtimeConfig.ts#L145)). A single flag cannot turn on demo behaviour on a hosted deployment.

The signing key is read only when signing is enabled, so a read-only deployment does not need secret material in its environment ([backend/src/config/runtimeConfig.ts:195](../../backend/src/config/runtimeConfig.ts#L195)).

## Consequences

Benefits:

- A misconfigured deployment fails at boot, in CI or in the platform's deploy log, rather than at the first user request.
- The health check cannot report green for a service that is pointing at the wrong contracts.
- The pool id is derived from the pool key and checked twice, so a partial edit of the environment cannot produce a consistent-looking but wrong configuration.
- No secrets are required for the read-only configuration, which reduces the blast radius of a leaked environment file.
- `runtimeConfig.test.ts` pins the behaviour with 21 named cases, including that a validation error never echoes the key.

Costs:

- Local development against Anvil requires source edits, not environment changes. `npm run dev` cannot be pointed at a local chain.
- Every contract redeploy requires editing constants in backend source, reviewing, and redeploying the backend. The environment file alone is not enough.
- The pins live in TypeScript rather than in a manifest, so tooling cannot read them and other components must duplicate them. The frontend does duplicate them in `frontend/src/lib/contracts.ts`.
- The monitor's own addresses bypass this validation and read environment variables directly, so the fail-closed property does not extend to log ingestion.
- A stale `.env` copied from an older deployment fails with a message about the approved pool, which is correct but requires the operator to read the source to know the right values.

Related: [ADR 0003](0003-config-sourced-pool-identity.md), [ADR 0005](0005-execute-gate-stays-closed.md).
