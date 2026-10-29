# HTTP API reference

The backend exposes five routes. All are under the same Express app and all accept and return JSON. There is no API version prefix, no API key, and no caller authentication on any route.

Base URL: the value of `VITE_API_URL` in the frontend, defaulting to `http://localhost:4000`. In production it is the Railway service host.

Source: [backend/src/server.ts](../../backend/src/server.ts).

## Route summary

| Method | Path | Auth | Success | Failure modes |
| --- | --- | --- | --- | --- |
| GET | `/health` | none | 200 | none |
| GET | `/config/protected-pool` | none | 200 | none |
| POST | `/risk-preview` | none | 200 | 400 |
| POST | `/policy` | none, gated by a 503 feature flag | 200 | 400, 500, 503 |
| POST | `/observability/transaction` | none | 202 | 400 |
| any | any other path or method | none | none | 404 |

Every response carries an `x-request-id` header. The value is the caller's `x-request-id` when it matches `^[A-Za-z0-9._:-]{1,128}$`, and a generated UUID otherwise ([backend/src/middleware/requestId.ts:6](../../backend/src/middleware/requestId.ts#L6)).

Four behaviours apply to all routes:

- A malformed JSON body is answered with 400 and `{ "error": "Invalid JSON body", "code": "invalid_json", "requestId": "..." }` before the route handler runs ([backend/src/server.ts:363](../../backend/src/server.ts#L363)).
- An unknown path or method is answered with 404 and `code: "not_found"` in the same JSON shape, not Express's default HTML page ([backend/src/server.ts:346](../../backend/src/server.ts#L346)).
- Every error body carries `error`, `code` and `requestId`. See [Error body shape](#error-body-shape).
- CORS allows one origin, `FRONTEND_URL`, and exposes `x-request-id` ([backend/src/server.ts:86](../../backend/src/server.ts#L86)).

---

## GET /health

Readiness and capability probe. Also the Railway health check target ([railway.json](../../railway.json#L8)).

### Request

No parameters, no body.

### Response 200

```json
{
  "status": "ok",
  "service": "mevshield-backend",
  "environment": "development",
  "chainId": 11155111,
  "policySigningEnabled": false,
  "localDemoMode": false,
  "sepoliaMonitor": {
    "status": "connected",
    "lastCheckedBlock": 12011114
  }
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `status` | string | Always `"ok"`. This is a liveness assertion, not a dependency check |
| `service` | string | Always `"mevshield-backend"` |
| `environment` | string | `NODE_ENV`, default `"development"` |
| `chainId` | number | The validated chain id, always `11155111` |
| `policySigningEnabled` | boolean | Whether `POST /policy` will sign |
| `localDemoMode` | boolean | Whether demo mode is active |
| `sepoliaMonitor.status` | string | `starting`, `connected`, `error` or `disabled` |
| `sepoliaMonitor.lastCheckedBlock` | number, optional | Omitted until a block has been scanned |

`status` does not change when the monitor is disabled or erroring, when signing fails, or when the RPC is unreachable. The route always returns 200.

Source: [backend/src/server.ts:106](../../backend/src/server.ts#L106). The snapshot assembly is at [backend/src/monitor/sepolia.ts:324](../../backend/src/monitor/sepolia.ts#L324).

The frontend validates this body with `parseHealthBody`, which drops an unrecognised `sepoliaMonitor` shape rather than rendering it ([frontend/src/lib/apiValidation.ts:78](../../frontend/src/lib/apiValidation.ts#L78)).

---

## GET /config/protected-pool

Returns the static protected pool configuration that the backend validated at startup.

### Request

No parameters, no body.

### Response 200

```json
{
  "configurationStatus": "valid",
  "poolReadiness": "not-checked",
  "chainId": 11155111,
  "poolKey": {
    "currency0": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "currency1": "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    "fee": 3000,
    "tickSpacing": 60,
    "hooks": "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080"
  },
  "poolId": "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602"
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `configurationStatus` | string | Always the literal `"valid"`. The route cannot serve an invalid configuration because startup would have failed |
| `poolReadiness` | string | Always the literal `"not-checked"`. This route does not read the pool |
| `chainId` | number | Always `11155111` |
| `poolKey.currency0` | address | USDC on Sepolia |
| `poolKey.currency1` | address | WETH on Sepolia |
| `poolKey.fee` | number | 3000 |
| `poolKey.tickSpacing` | number | 60 |
| `poolKey.hooks` | address | The MEVShield hook |
| `poolId` | bytes32 | Recomputed from the pool key and compared to `PROTECTED_POOL_ID` |

`poolReadiness` is a fixed literal, not a status that another code path might upgrade. A caller that reads it as "the pool is usable" is reading it wrong: initialisation and liquidity for the trade page are checked by the frontend over RPC. `/risk-preview` and `/policy` read `slot0` and active liquidity separately, and only to price the impact estimate.

Source: [backend/src/config/runtimeConfig.ts:120](../../backend/src/config/runtimeConfig.ts#L120).

The frontend requires every field, including `configurationStatus === "valid"` and `poolReadiness === "not-checked"`, to match before it sets `backendPoolKeyVerified` ([frontend/src/lib/protectedQuote.ts:70](../../frontend/src/lib/protectedQuote.ts#L70)).

---

## POST /risk-preview

Returns the price-impact estimate for a swap size against the protected pool's current active liquidity. Does not sign, does not register, and does not submit a transaction. It does read pool state over RPC. A failed read is `503`, not a substitute formula.

### Request body

```json
{
  "amountSpecified": "-1000000000000000",
  "zeroForOne": false
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `amountSpecified` | string | yes | Must match `^-?\d{1,78}$`. Parsed as `BigInt`. Zero is rejected after parsing |
| `zeroForOne` | boolean | yes | Strict boolean |

The schema is not `.strict()`, so additional properties are ignored rather than rejected ([backend/src/risk/riskPreview.ts:9](../../backend/src/risk/riskPreview.ts#L9)). Pool price and liquidity are not request fields. The server reads them.

`amountSpecified` is not bounded by the schema beyond the 78-digit limit. A value beyond `2^255 - 1` would overflow the `int256` the policy uses, but this route does not construct a policy, so it does not check that bound.

### Response 200

`model` is always `active-liquidity-impact`. The disclaimer is always:

> Estimates price impact from the current pool state for this trade size. It does not read the mempool or detect sandwich attacks.

The numbers are not a fixed fraction of `amountSpecified`. They come from `calculateRisk` ([backend/src/risk/riskEngine.ts:81](../../backend/src/risk/riskEngine.ts#L81)) for the pool state read on this request. The same body can return `LOW`, `MEDIUM`, or `HIGH` as that state changes. The JSON below is the unit-test case in `riskPreview.test.ts`: amount `10^18`, `zeroForOne` true, `sqrtPriceX96 = 2^96`, liquidity `10^30`, fee `3000`. It is not what the sample request above returns on Sepolia.

```json
{
  "estimatedLoss": "994010",
  "estimatedFee": "3000000000000000",
  "maxLoss": "1988020",
  "maxFee": "6000000000000000",
  "riskLevel": "LOW",
  "model": "active-liquidity-impact",
  "disclaimer": "Estimates price impact from the current pool state for this trade size. It does not read the mempool or detect sandwich attacks."
}
```

`L` is active liquidity. `sqrtP` is `sqrtPriceX96`. `amount` is `abs(amountSpecified)`.

```text
fee = amount * feePips / 1_000_000
amountIn = amount - fee
estimatedFee = fee

zeroForOne (token0 in, price down):
  nextSqrt = ceil(L * 2^96 * sqrtP / (L * 2^96 + amountIn * sqrtP))
  amountOut = L * (sqrtP - nextSqrt) / 2^96
  outputValueInInput = amountOut * 2^96 / sqrtP * 2^96 / sqrtP

oneForZero (token1 in, price up):
  nextSqrt = sqrtP + amountIn * 2^96 / L
  amountOut = L * 2^96 * (nextSqrt - sqrtP) / (nextSqrt * sqrtP)
  outputValueInInput = amountOut * sqrtP / 2^96 * sqrtP / 2^96

estimatedLoss = amountIn - outputValueInInput
lossBps = estimatedLoss * 10_000 / amount
```

| Field | Type | Meaning |
| --- | --- | --- |
| `estimatedLoss` | decimal string | Curvature shortfall of `amountIn` against the spot price, in input-token units. The full input amount when the pool cannot support the trade |
| `estimatedFee` | decimal string | `amount * feePips / 1_000_000`, the pool swap fee, not the impact |
| `maxLoss` | decimal string | `estimatedLoss * 2` |
| `maxFee` | decimal string | `estimatedFee * 2` |
| `riskLevel` | string | `LOW` when `lossBps <= 10`, `MEDIUM` when `lossBps <= 50`, `HIGH` above that. An unsupported quote is `HIGH` |
| `model` | string | Always `"active-liquidity-impact"` |
| `disclaimer` | string | Fixed text, stated above |

All numeric fields are strings to avoid JavaScript precision loss. The values are in the base units of `amountSpecified`. The route does not apply a separate decimals scale. The quote does not walk neighboring ticks, read the mempool, or detect a sandwich.

### Errors

| Status | `code` | `error` | Cause |
| --- | --- | --- | --- |
| 400 | `invalid_preview` | `Invalid risk-preview request` | Schema validation failed. `details` is the Zod issue array |
| 400 | `invalid_preview` | `amountSpecified must not be zero` | Zero after parsing |
| 503 | `pool_state_unavailable` | The `PoolStateUnavailableError` message | RPC missing, pool uninitialized, or the `slot0` / liquidity read failed. No estimate is returned |
| 500 | `internal_error` | `Internal error` | Any other thrown error |

Each row carries `requestId`. See [Error body shape](#error-body-shape).

Source: [backend/src/server.ts:133](../../backend/src/server.ts#L133).

---

## POST /policy

Requests an EIP-712 signature over a fully specified policy.

**This route has no caller authentication.** CORS restricts which browser origins may call it. It does not restrict non-browser clients, and there is no API key, no bearer token, no rate limit and no per-user quota. Any client that can reach the process can obtain a signature from the on-chain authorized signer, subject only to the schema, the pinned pool check, and the pinned trader check.

**It is disabled by default.** Signing requires `MEVSHIELD_V2_POLICY_ENABLED=true` or local demo mode. With signing off, the route returns 503 for every request body, including an invalid one, because the gate is evaluated before validation ([backend/src/server.ts:144](../../backend/src/server.ts#L144)). That ordering is intentional: a disabled endpoint should not leak schema diagnostics. `server.test.ts` covers both an empty body and a fully valid body.

### Request body

```json
{
  "poolId": "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602",
  "trader": "0x633282608B2fc66cD7572f5eF58e804063aa150D",
  "nonce": "1730123456789",
  "expiry": "1730127056",
  "amountSpecified": "-1000000000000000",
  "zeroForOne": false,
  "sqrtPriceLimitX96": "1461446703485210103287273052203988822378723970340",
  "minAmountOut": "1900000"
}
```

### Field-level validation

The schema is `.strict()`, so an unknown property is a validation failure, not an ignored field. That prevents a caller from smuggling a `chainId` or a pool-key override into a body that the server otherwise controls.

| Field | Pattern or rule | On failure |
| --- | --- | --- |
| `poolId` | `^0x[0-9a-fA-F]{64}$` | 400 |
| `trader` | `^0x[0-9a-fA-F]{40}$` | 400 |
| `nonce` | `^[1-9]\d{0,77}$`, so no leading zero and not zero | 400 |
| `expiry` | `^\d{1,78}$`, then parsed. Must be strictly greater than now, and at most 30 minutes ahead | 400 |
| `amountSpecified` | `^-?\d{1,78}$`, then parsed. Must not be zero | 400 |
| `zeroForOne` | boolean | 400 |
| `sqrtPriceLimitX96` | `^\d{1,78}$`, then parsed. Must be strictly between `4295128740` and `1461446703485210103287273052203988822378723970341` | 400 |
| `minAmountOut` | `^[1-9]\d*$`, so any positive integer, no upper bound | 400 |

Declared at [backend/src/policy/policyRequest.ts:12](../../backend/src/policy/policyRequest.ts#L12). The 30-minute ceiling is `POLICY_MAX_TTL_SECONDS` at [backend/src/policy/policyRequest.ts:6](../../backend/src/policy/policyRequest.ts#L6). The sqrt bounds are Uniswap v4's `MIN_SQRT_PRICE` and `MAX_SQRT_PRICE`, declared at [backend/src/policy/policyRequest.ts:3](../../backend/src/policy/policyRequest.ts#L3).

Beyond the schema, the route applies six more rules, in this order:

| Order | Rule | Status on failure |
| --- | --- | --- |
| 1 | Feature gate. Signing must be enabled | 503, `"Policy signing is disabled until the v2 minimum-output contracts are deployed and verified."` |
| 2 | In demo mode, `minAmountOut` must be exactly `"1"` | 400, `"Invalid demo minimum output"` |
| 3 | Outside demo mode, `minAmountOut` must not be `"1"` | 400, `"Invalid minimum output"` |
| 4 | A signer wallet must be loaded | 503, `"Policy signing is enabled but no signer wallet is configured."` |
| 5 | `poolId` must equal the configured protected pool id | 400, `"Invalid protected pool"` |
| 6 | `trader` must equal the configured router address | 400, `"Invalid policy trader"` |

Rules 5 and 6 are the only content checks that tie the request to the deployment. A caller may still choose `nonce`, `expiry`, `amountSpecified`, `zeroForOne`, `sqrtPriceLimitX96` and, outside demo mode, any positive `minAmountOut`. After those checks the route reads `slot0` and active liquidity and prices `maxLoss` and `maxFee` with `calculateRisk`. It still does not check whether the price limit is on the correct side of the tick, whether it is inside the router's 600-tick cap, or whether `minAmountOut` is achievable.

### Response 200

```json
{
  "policy": {
    "poolId": "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602",
    "trader": "0x633282608B2fc66cD7572f5eF58e804063aa150D",
    "nonce": "1730123456789",
    "expiry": "1730127056",
    "maxLoss": "<estimatedLoss * 2>",
    "maxFee": "<estimatedFee * 2>",
    "zeroForOne": false,
    "amountSpecified": "-1000000000000000",
    "sqrtPriceLimitX96": "1461446703485210103287273052203988822378723970340",
    "minAmountOut": "1900000"
  },
  "estimatedLoss": "<curvature shortfall, input-token units>",
  "estimatedFee": "<amount * feePips / 1000000>",
  "riskLevel": "<LOW, MEDIUM, or HIGH>",
  "model": "active-liquidity-impact",
  "disclaimer": "Estimates price impact from the current pool state for this trade size. It does not read the mempool or detect sandwich attacks.",
  "signature": "0x...",
  "policyId": "0x...",
  "requestId": "3f2b...",
  "demoMode": false
}
```

| Field | Type | Notes |
| --- | --- | --- |
| `policy.poolId` | bytes32 string | Echoed from the request after the configured-pool check |
| `policy.trader` | address string | Echoed from the request after the router check |
| `policy.nonce` | decimal string | Echoed |
| `policy.expiry` | decimal string | Echoed |
| `policy.maxLoss` | decimal string | `estimatedLoss * 2` from the price-impact quote. Not caller-supplied |
| `policy.maxFee` | decimal string | `estimatedFee * 2` from the same quote. Not caller-supplied |
| `policy.zeroForOne` | boolean | Echoed |
| `policy.amountSpecified` | decimal string, may be negative | Echoed |
| `policy.sqrtPriceLimitX96` | decimal string | Echoed |
| `policy.minAmountOut` | decimal string | Echoed |
| `estimatedLoss` | decimal string | Curvature shortfall from the formula under [POST /risk-preview](#post-risk-preview). The value the frontend later puts in `hookData` |
| `estimatedFee` | decimal string | Pool swap fee, `amount * feePips / 1_000_000`. The value the frontend later puts in `hookData` |
| `riskLevel` | string | `LOW` at `lossBps <= 10`, `MEDIUM` at `lossBps <= 50`, `HIGH` above that |
| `model` | string | Always `"active-liquidity-impact"` |
| `disclaimer` | string | Fixed text. States the estimate uses current pool state for this trade size and does not read the mempool or detect sandwich attacks |
| `signature` | 65-byte hex | EIP-712 signature from the authorized signer |
| `policyId` | bytes32 string | `keccak256(abi.encode(poolId, trader, nonce))` |
| `requestId` | string | The request id for this call, also in the response header |
| `demoMode` | boolean | Whether demo mode was active |

The frontend cross-checks every echoed field against what it sent, and compares `requestId` to the id it generated, before it will submit a registration transaction ([frontend/src/lib/policyMatch.ts:18](../../frontend/src/lib/policyMatch.ts#L18), [frontend/src/hooks/usePolicy.ts:365](../../frontend/src/hooks/usePolicy.ts#L365)).

### Errors

| Status | `code` | `error` | Cause |
| --- | --- | --- | --- |
| 503 | `policy_signing_disabled` | `Policy signing is disabled until the v2 minimum-output contracts are deployed and verified.` | Feature gate closed, before the body is read |
| 503 | `signer_unavailable` | `Policy signing is enabled but no signer wallet is configured.` | Gate open, no wallet loaded |
| 400 | `invalid_minimum_output` | `Invalid demo minimum output` | Demo mode with a minimum other than 1 |
| 400 | `invalid_minimum_output` | `Invalid minimum output` | Non-demo with a minimum of exactly 1 |
| 400 | `invalid_pool` | `Invalid protected pool` | `poolId` is not the configured pool |
| 400 | `invalid_trader` | `Invalid policy trader` | `trader` is not the configured router |
| 400 | `invalid_request` | `Invalid request` | Zod validation failed. `details` is the issue array |
| 400 | `invalid_json` | `Invalid JSON body` | Body was not parseable JSON |
| 503 | `pool_state_unavailable` | The `PoolStateUnavailableError` message | Pool `slot0` or liquidity could not be read. The route does not sign |
| 500 | `internal_error` | `Internal error` | Any other thrown error, including a signing failure |

Every row carries `requestId`. `pool_state_unavailable` puts the read failure in `error` and does not add `details`. The 500 body also omits `details`. See [Error body shape](#error-body-shape).

The 500 body is a fixed message, the `internal_error` code and the request id. It deliberately does not include the exception message, so a signing error cannot leak key material or internal paths. The exception is logged server-side as `policy_request_failed` against the same request id. Source: [backend/src/server.ts:354](../../backend/src/server.ts#L354).

Every failure after the gate is also logged as `policy_request_failed` at error level with the error name and message.

### What this route does not do

- It does not register the policy. Registration is a wallet transaction to `PolicyAuthorization.registerPolicy`.
- It does not check that the policy's `minAmountOut` is achievable.
- It reads pool price and active liquidity for the price-impact estimate. It does not check the 600-tick distance or whether the limit is legal at the current tick.
- It does not read the mempool or detect a sandwich.
- It does not limit how many signatures a caller may request.
- It does not verify that the caller controls `trader`. The `trader` field must equal the router, which is a contract, so no caller ever controls it directly.

---

## POST /observability/transaction

Accepts a client-reported transaction lifecycle event and writes it to the backend log.

### Request body

```json
{
  "event": "swap_submitted",
  "txHash": "0x4a3f...",
  "chainId": 11155111,
  "router": "0x633282608B2fc66cD7572f5eF58e804063aa150D",
  "nonce": "1730123456789"
}
```

| Field | Type | Required | Validation |
| --- | --- | --- | --- |
| `event` | enum string | yes | One of `policy_registration_submitted`, `policy_registration_failed`, `swap_submitted`, `swap_failed` |
| `txHash` | string | no | `^0x[0-9a-fA-F]{64}$` |
| `chainId` | number | yes | Integer. Not compared to `11155111` |
| `contract` | string | no | `^0x[0-9a-fA-F]{40}$` |
| `router` | string | no | `^0x[0-9a-fA-F]{40}$` |
| `nonce` | string | no | Unvalidated. Any string |
| `errorName` | string | no | Max 100 characters |
| `errorMessage` | string | no | Max 300 characters |

Declared at [backend/src/server.ts:90](../../backend/src/server.ts#L90). The schema is a plain `z.object`, so unknown properties are stripped rather than rejected.

### Response 202

```json
{ "accepted": true, "requestId": "3f2b..." }
```

202 rather than 200 because the event is logged for later inspection, not processed synchronously.

### Errors

| Status | `code` | `error` | Cause |
| --- | --- | --- | --- |
| 400 | `invalid_request` | `Invalid transaction event` | Schema validation failed |
| 400 | `invalid_json` | `Invalid JSON body` | Body was not parseable JSON |

Both carry `requestId`. See [Error body shape](#error-body-shape).

### Trust properties

This route is unauthenticated and unvalidated against reality. Any client can post any `txHash`, any `chainId` and any `errorMessage` within the length limits. The backend logs it as given. A log record from this route is a client claim, not an observation, and should not be treated as evidence that a transaction exists. Real on-chain evidence comes from the monitor, which reads logs and receipts from the RPC.

Log level is `error` when the event name ends in `_failed` and `info` otherwise ([backend/src/server.ts:336](../../backend/src/server.ts#L336)).

Source: [backend/src/server.ts:323](../../backend/src/server.ts#L323).

---

## Cross-cutting behaviour

### Content type

Request bodies are parsed by `express.json`, so the content type must be `application/json`. A request with no body and no content type reaches the handler with an empty object.

### Request ids

Supply `x-request-id` to correlate a client operation with backend records. The value must match `^[A-Za-z0-9._:-]{1,128}$`; anything else is replaced by a generated UUID, and the replacement is what appears in the response header. A client that supplies an invalid id and then compares the echoed value will see a mismatch. The frontend's own id always matches the pattern because it is a UUID.

### Status code conventions

| Status | Used for |
| --- | --- |
| 200 | Successful read or successful signing |
| 202 | Accepted telemetry |
| 400 | Schema or semantic validation failure in the request |
| 404 | No route matched the method and path |
| 500 | Unexpected server error during policy signing |
| 503 | A feature gate or a missing dependency that prevents the operation |

No handler returns 401, 403, 405 or 429.

### Error body shape

Every non-2xx response is built by one helper, `sendApiError`, so the shape is identical across all statuses ([backend/src/http/apiError.ts:54](../../backend/src/http/apiError.ts#L54)). Success bodies are untouched by that helper; it shapes failures only.

```json
{
  "error": "Invalid protected pool",
  "code": "invalid_pool",
  "requestId": "22f762d0-69fd-4c38-8584-7b87bf84b2e3",
  "details": "The requested pool ID does not match the configured Sepolia WETH/USDC pool."
}
```

| Field | Type | Always present | Meaning |
| --- | --- | --- | --- |
| `error` | string | yes | Human-readable message. The wording is unchanged from earlier releases, so clients that read `body.error` keep working |
| `code` | string | yes | Machine-readable reason from a closed union. Safe to switch on |
| `requestId` | string | yes | The request id for this call. Also returned in the `x-request-id` header |
| `details` | unknown | no | Omitted entirely when absent. Usually the Zod issue array, or a string hint for a semantic rejection |

`requestId` is present on every error status, including 400, 404, 500 and 503. A client can therefore quote it without first inspecting the status, and the value matches the `x-request-id` response header.

`code` is a closed union declared as `ApiErrorCode` ([backend/src/http/apiError.ts:22](../../backend/src/http/apiError.ts#L22)). The current members:

| `code` | Typical status | Meaning |
| --- | --- | --- |
| `invalid_json` | 400 | The request body was not parseable JSON |
| `invalid_request` | 400 | Schema validation failed, or the telemetry event schema rejected the body |
| `invalid_preview` | 400 | The risk-preview body failed schema validation, or the amount was zero |
| `invalid_pool` | 400 | `poolId` is not the configured protected pool |
| `invalid_trader` | 400 | `trader` is not the configured router |
| `invalid_minimum_output` | 400 | The minimum-output rule for the active mode was violated |
| `not_found` | 404 | No route matched the method and path |
| `policy_signing_disabled` | 503 | The `POST /policy` feature gate is closed |
| `signer_unavailable` | 503 | Signing is enabled but no signer wallet was loaded |
| `internal_error` | 500 | An unexpected error was thrown while handling a policy request |

#### 400 Bad request

Returned for a malformed JSON body, a schema failure, or a semantic rejection that the schema cannot express. `details` is usually the Zod issue array ([backend/src/server.ts:339](../../backend/src/server.ts#L339)).

```json
{
  "error": "Invalid request",
  "code": "invalid_request",
  "requestId": "3f2b9c14-0d1e-4a6b-9f2c-77a1b0c9d8e4",
  "details": [{ "path": ["trader"], "message": "Invalid", "code": "invalid_format" }]
}
```

A malformed body produces `invalid_json` with no `details`, from the error middleware rather than a route ([backend/src/server.ts:363](../../backend/src/server.ts#L363)).

#### 404 Not found

Returned by a terminal handler registered after every route, so an unknown path or an undeclared method answers with the same JSON shape as every other failure instead of Express's default HTML page ([backend/src/server.ts:346](../../backend/src/server.ts#L346)). The message names the attempted method and path.

```json
{
  "error": "No route for GET /no-such-route",
  "code": "not_found",
  "requestId": "07afc621-c4c3-46ed-8a9c-c2be07f4fe3c"
}
```

#### 500 Internal error

Returned when a policy request throws something other than a `ZodError`. The body deliberately carries only a fixed message, the `code`, and the request id, so a signing failure cannot leak key material or internal paths ([backend/src/server.ts:346](../../backend/src/server.ts#L346)). The exception is logged server-side as `policy_request_failed` with the request id, so an operator can join the client report to the log record.

```json
{
  "error": "Internal error",
  "code": "internal_error",
  "requestId": "b1d4f0a2-5c88-4f31-9e77-2a6c3b5d9e10"
}
```

#### 503 Service unavailable

Returned by two distinct gates on `POST /policy`, told apart by `code`.

The feature gate runs before the body is read, so it answers 503 for every body including a malformed one ([backend/src/server.ts:147](../../backend/src/server.ts#L147)):

```json
{
  "error": "Policy signing is disabled until the v2 minimum-output contracts are deployed and verified.",
  "code": "policy_signing_disabled",
  "requestId": "9c0e5b31-77a2-4d55-8b1f-3e64c2a7f018"
}
```

The signer gate runs after validation, when signing is enabled but no wallet loaded ([backend/src/server.ts:186](../../backend/src/server.ts#L186)):

```json
{
  "error": "Policy signing is enabled but no signer wallet is configured.",
  "code": "signer_unavailable",
  "requestId": "9c0e5b31-77a2-4d55-8b1f-3e64c2a7f018"
}
```

Neither 503 body includes `details`.

### Errors are not authenticated

A 404 for an unknown path is served before any route logic, and no error body reveals whether an endpoint would have accepted the request. The backend still applies no caller authentication on any route, so an error response should not be read as evidence that the caller was checked. See [Backend service](../services/backend.md#known-limitations).

## Related pages

- [Backend service](../services/backend.md).
- [Monitoring](../services/monitoring.md).
- [Configuration](../operations/configuration.md).
