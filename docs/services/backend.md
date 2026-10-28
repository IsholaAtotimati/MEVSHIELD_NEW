# Backend service

The backend is an Express 5 service in TypeScript, run with `tsx` in development and compiled with `tsc` for production. It has four responsibilities: serve static protected-pool configuration, compute a deterministic risk estimate, sign EIP-712 policies when the signing gate is open, and ingest logs and telemetry for correlation. It never holds user funds and never sends a transaction.

Source: `backend/src`. Entry point: [backend/src/server.ts](../../backend/src/server.ts). Package manifest: [backend/package.json](../../backend/package.json).

## Module layout

| Module | Files | Responsibility |
| --- | --- | --- |
| Configuration | `config/runtimeConfig.ts` | Reads and validates every startup variable, pins the deployment, derives the pool id |
| Risk | `risk/riskEngine.ts`, `risk/riskPreview.ts` | The closed-form estimate and the request schema for `/risk-preview` |
| Policy | `policy/policy.ts`, `policy/policyGenerator.ts`, `policy/policyRequest.ts`, `policy/policySigning.ts` | The policy type, the request schema for `/policy`, policy assembly, and the guarded signing call |
| Signer | `signer/policySigner.ts` | EIP-712 domain and types, `signTypedData` |
| Signer diagnostics | `signer/testSigner.ts`, `signer/verifyApiSignature.ts` | Standalone scripts. Excluded from the compiled build |
| Monitor | `monitor/sepolia.ts` | 12-second poll of registry and hook logs, receipt lookup, correlation |
| Observability | `observability/logger.ts`, `observability/requestCorrelation.ts` | Structured JSON logging and the policy-id to request-id map |
| Middleware | `middleware/requestId.ts`, `middleware/httpLifecycle.ts` | Request id assignment and per-request completion logging |

The two script files under `signer/` are excluded from the build by [backend/tsconfig.json](../../backend/tsconfig.json#L12) and are not imported by `server.ts`. `testSigner.ts` and `verifyApiSignature.ts` each carry a hard-coded domain and type list with chain id `31337` and a fixed verifying contract, so they exercise a local Anvil deployment, not Sepolia.

## Request pipeline

```mermaid
graph LR
  req["HTTP request"] --> rid["requestIdMiddleware"]
  rid --> life["httpLifecycleMiddleware"]
  life --> cors["cors with one origin"]
  cors --> json["express.json"]
  json --> route["route handler"]
  route --> err["error middleware"]
```

`requestIdMiddleware` accepts an `x-request-id` header matching `^[A-Za-z0-9._:-]{1,128}$` and otherwise generates a UUID. It stores the id on `res.locals.requestId` and echoes it in the response header ([backend/src/middleware/requestId.ts:6](../../backend/src/middleware/requestId.ts#L6)).

`httpLifecycleMiddleware` logs one `http_request` record per completed response with method, path, status and duration ([backend/src/middleware/httpLifecycle.ts:5](../../backend/src/middleware/httpLifecycle.ts#L5)).

CORS allows exactly one origin, `FRONTEND_URL`, defaulting to `http://localhost:5173`, and exposes `x-request-id` ([backend/src/server.ts:85](../../backend/src/server.ts#L85)).

The JSON body limit is the Express default. A malformed JSON body is caught by the final error middleware and answered with 400 and `{ "error": "Invalid JSON body" }` ([backend/src/server.ts:327](../../backend/src/server.ts#L327)).

## Startup requirements

`loadAppDependencies` runs before the listener starts and throws on any configuration error, so the process exits rather than serving a misconfigured deployment ([backend/src/server.ts:54](../../backend/src/server.ts#L54)).

Startup requires, in order:

1. `CHAIN_ID` present and equal to `11155111`. Anything else throws ([backend/src/config/runtimeConfig.ts:73](../../backend/src/config/runtimeConfig.ts#L73)).
2. The six `PROTECTED_POOL_*` variables present, well formed, in ascending currency order, with a 32-byte `PROTECTED_POOL_ID` ([backend/src/config/runtimeConfig.ts:63](../../backend/src/config/runtimeConfig.ts#L63)).
3. The pool id recomputed from the pool key, and compared to the configured id. A mismatch throws ([backend/src/config/runtimeConfig.ts:87](../../backend/src/config/runtimeConfig.ts#L87)).
4. The whole pool key and derived id compared to the pinned Sepolia WETH/USDC pool constants. A mismatch throws ([backend/src/config/runtimeConfig.ts:91](../../backend/src/config/runtimeConfig.ts#L91)).
5. A verifier address from any of `POLICY_VERIFIER_ADDRESS`, `VERIFIER_ADDRESS`, `POLICY_VERIFIER`, compared to the pinned verifier. A mismatch throws ([backend/src/config/runtimeConfig.ts:172](../../backend/src/config/runtimeConfig.ts#L172)).
6. A router address from `ROUTER_ADDRESS` or `MEVSHIELD_ROUTER`, compared to the pinned router. A mismatch throws ([backend/src/config/runtimeConfig.ts:212](../../backend/src/config/runtimeConfig.ts#L212)).
7. `SIGNER_PRIVATE_KEY`, but only when signing is enabled. The derived address must equal the pinned signer ([backend/src/config/runtimeConfig.ts:191](../../backend/src/config/runtimeConfig.ts#L191) to [backend/src/config/runtimeConfig.ts:210](../../backend/src/config/runtimeConfig.ts#L210)).

`SIGNER_PRIVATE_KEY` being optional when signing is disabled is the reason the process can run in a read-only configuration. Error messages never include the key material, and `runtimeConfig.test.ts` asserts that.

The monitor starts during dependency loading, not on the first request ([backend/src/server.ts:74](../../backend/src/server.ts#L74)). It is started once and memoised, so repeated calls return the same snapshot function ([backend/src/monitor/sepolia.ts:59](../../backend/src/monitor/sepolia.ts#L59)).

The listener binds `0.0.0.0` on `PORT`, defaulting to 4000 ([backend/src/server.ts:337](../../backend/src/server.ts#L337)). `startServer` logs a warning when local demo signing is on, naming the 1-base-unit minimum as not meaningful slippage protection ([backend/src/server.ts:353](../../backend/src/server.ts#L353)).

## Fail-closed Sepolia pinning

The backend is pinned to one deployment. This is deliberate and it is the main safety property of the service.

| Pinned constant | Value | Enforced against |
| --- | --- | --- |
| `SEPOLIA_CHAIN_ID` | `11155111` | `CHAIN_ID` and the monitor's `eth_chainId` |
| `EXPECTED_SEPOLIA_VERIFIER` | `0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f` | Any configured verifier alias |
| `EXPECTED_SEPOLIA_ROUTER` | `0x633282608B2fc66cD7572f5eF58e804063aa150D` | Any configured router alias |
| `EXPECTED_AUTHORIZED_SIGNER` | `0x016B78a30CE176EF0B90c122e8677e13aAB2A815` | The address derived from `SIGNER_PRIVATE_KEY` |
| `EXPECTED_PROTECTED_POOL` | pool key plus pool id `0x9275…b602` | The six `PROTECTED_POOL_*` variables, both individually and through the derived id |

The constants are declared at [backend/src/config/runtimeConfig.ts:3](../../backend/src/config/runtimeConfig.ts#L3) to [backend/src/config/runtimeConfig.ts:16](../../backend/src/config/runtimeConfig.ts#L16).

Consequences a reader should internalise:

- The backend cannot be pointed at a local Anvil deployment or a different Sepolia pool without editing source. There is no override flag.
- A stale environment file is a startup failure, not a degraded mode. That is the intent.
- The pinned values must be edited in code, reviewed, and redeployed when the contracts are redeployed. A configuration file alone cannot retarget the service.

The pool configuration is exposed to clients through `GET /config/protected-pool`, which reports `configurationStatus: "valid"` and `poolReadiness: "not-checked"` ([backend/src/config/runtimeConfig.ts:114](../../backend/src/config/runtimeConfig.ts#L114)). The `not-checked` value is not a placeholder for an unimplemented check that would return `ready`: the backend has no pool-state read path at all. Pool readiness is assessed by the frontend from RPC reads. `runtimeConfig.test.ts` has a test asserting the response does not claim the pool is initialised or liquid.

## Policy signing gate

Signing is enabled by `resolvePolicySigningEnabled`, which returns true when `MEVSHIELD_V2_POLICY_ENABLED` is exactly `"true"`, or when local demo mode is on ([backend/src/server.ts:47](../../backend/src/server.ts#L47)).

Local demo mode requires `MEVSHIELD_SEPOLIA_DEMO_ENABLED=true`, `NODE_ENV` not equal to `production`, and `RAILWAY_ENVIRONMENT_NAME` unset ([backend/src/config/runtimeConfig.ts:137](../../backend/src/config/runtimeConfig.ts#L137)). Demo mode therefore cannot be enabled on Railway or in a production build by setting the flag alone.

When signing is disabled, `POST /policy` answers 503 before reading the body, so a disabled endpoint returns 503 for every body including an invalid one ([backend/src/server.ts:140](../../backend/src/server.ts#L140)). This ordering is deliberate and is covered by two tests in `server.test.ts`, one with an empty body and one with a valid body.

When signing is enabled, the route performs these steps in order:

1. Parse the body with `PolicyRequestSchema`.
2. In demo mode, require `minAmountOut` to be exactly `"1"`; outside demo mode, reject `minAmountOut` of `"1"` ([backend/src/server.ts:154](../../backend/src/server.ts#L154), [backend/src/server.ts:162](../../backend/src/server.ts#L162)).
3. Require a signer wallet, else 503.
4. Require the requested pool id to equal the configured protected pool id, else 400.
5. Require the requested trader to equal the configured router, else 400.
6. Log `risk_analysis_started`.
7. `generatePolicy` to compute `maxLoss` and `maxFee`.
8. Log `risk_analysis_completed` and `policy_created`.
9. `signProtectedPolicy`, which re-asserts the pool id before signing, then logs `policy_signed`.
10. Derive `policyId` and record the request id correlation.
11. Respond with the policy, the signature, `policyId`, `requestId` and `demoMode`.

Any thrown error after step 1 is logged as `policy_request_failed` and answered with 500 plus `{ "error": "Internal error", "requestId": … }` ([backend/src/server.ts:280](../../backend/src/server.ts#L280)). A Zod error is answered with 400 instead.

## Risk model

`calculateRisk` is a pure function ([backend/src/risk/riskEngine.ts:12](../../backend/src/risk/riskEngine.ts#L12)).

```
absolute    = amountSpecified < 0 ? -amountSpecified : amountSpecified
estimatedLoss = absolute / 1000
estimatedFee  = absolute / 10000
maxLoss       = estimatedLoss * 2
maxFee        = estimatedFee * 2
riskLevel     = "LOW"
```

`zeroForOne` is accepted in the input type and is not used by the calculation. The result type narrows `riskLevel` to the literal `"LOW"`, so `MEDIUM` and `HIGH` cannot be produced. The frontend validator still accepts all three strings ([frontend/src/lib/apiValidation.ts:62](../../frontend/src/lib/apiValidation.ts#L62)), because it validates a wire format rather than the current model.

The same function feeds two paths: `/risk-preview`, which returns the estimate directly, and `/policy`, which writes `maxLoss` and `maxFee` into the signed policy. So the signed caps are always exactly twice a fixed fraction of the trade size. That is a modelling limitation rather than an enforcement bug, and the disclaimer field says so in the response body.

## Signing

`signPolicy` builds the ethers domain `{ name: "MEVShield", version: "1", chainId, verifyingContract }` and the ten-field `Policy` type list, then calls `wallet.signTypedData` ([backend/src/signer/policySigner.ts:29](../../backend/src/signer/policySigner.ts#L29)). The field list matches `PolicyVerifier.POLICY_TYPEHASH` exactly, and `policySigning.test.ts` has a test asserting that `minAmountOut` is part of the signed digest.

`signProtectedPolicy` wraps the signer with a pool-id assertion, so even a caller that bypasses the route cannot obtain a signature for a foreign pool ([backend/src/policy/policySigning.ts:24](../../backend/src/policy/policySigning.ts#L24)).

The signing key is loaded into memory once at startup as an ethers `Wallet`. There is no KMS, HSM or remote signer integration. Restarting the process reloads it from the environment.

## Observability

`logEvent` writes one JSON object per line to stdout or stderr depending on level ([backend/src/observability/logger.ts:20](../../backend/src/observability/logger.ts#L20)). Every record carries `service`, `environment`, `timestamp`, `level` and `event`, plus caller fields. Bigints are stringified. `LOG_LEVEL` filters records by a weight table, defaulting to `info`, and an unrecognised level falls back to `info`.

`requestCorrelation.ts` keeps an in-memory map from `policyId` to `requestId`, lowercased, with a one-hour TTL and a 10,000-entry ceiling that evicts the oldest entry when full ([backend/src/observability/requestCorrelation.ts:8](../../backend/src/observability/requestCorrelation.ts#L8)). The map is process-local and is lost on restart. It is also the mechanism by which a later `SwapPolicyEnforced` log is attributed back to the HTTP request that produced the policy.

## Known limitations

These are behaviours of the current code that a reader should not have to discover by testing.

- No caller authentication on any route. CORS restricts browsers to one origin; it does not restrict non-browser clients. When signing is enabled, any client that can reach the process can obtain a signature from the authorized on-chain signer for any `minAmountOut`, subject only to the schema and the pinned pool and trader. There is no rate limit.
- No request-size or numeric bound beyond the schema. `amountSpecified` and `expiry` are bounded by regex and by the 30-minute expiry window; `poolId` and `trader` are regex-checked hex.
- The frontend's expiry is one hour, the backend's ceiling is 30 minutes. A UI request is rejected with 400 unless the frontend expiry is reduced. See [data model](../architecture/data-model.md#nonce-lifecycle).
- `generatePolicy` has no direct unit test. It is exercised only through the route tests, and only up to the point where a signer would be required.
- The risk model ignores direction, pool state and amount of liquidity.
- The monitor is fail-open for policy correlation. If the monitor is disabled or erroring, the swap still happens; only the correlation log is missing. See [monitoring](monitoring.md).

## Running the service

```
cd backend
npm ci
npm run dev     # tsx src/server.ts
npm run demo    # tsx with NODE_ENV=development and MEVSHIELD_SEPOLIA_DEMO_ENABLED=true
npm test        # node:test across eight suites
npm run build   # tsc, output to backend/dist
npm start       # node dist/server.js
```

`npm run demo` sets the demo flag inline, so it still requires the rest of the pinned configuration to be present and correct. It does not bypass the Sepolia pinning.

Deployment: [railway.json](../../railway.json) sets the build command to install and build the backend and the start command to `npm --prefix backend start`, with `/health` as the health check path.

## Related pages

- [API reference](../api/reference.md).
- [Configuration](../operations/configuration.md).
- [Monitoring](monitoring.md).
- [ADR 0004](../decisions/0004-fail-closed-sepolia-configuration.md).
