# Risk preview

**Status: shipped.** The estimate is price impact for one trade size against the protected pool's current active liquidity.

`POST /risk-preview` accepts an amount and a direction. The backend reads the pool's `sqrtPriceX96`, active liquidity, and fee, then returns `estimatedLoss`, `estimatedFee`, `maxLoss`, `maxFee`, `riskLevel`, `model` and `disclaimer`. The trade page's primary button calls it while the step is `check`, then renders the metrics in the shield report ([frontend/src/pages/TradePage.tsx:88](../../frontend/src/pages/TradePage.tsx#L88), [frontend/src/pages/TradePage.tsx:333](../../frontend/src/pages/TradePage.tsx#L333)).

The same calculation runs inside `POST /policy` through `generatePolicy`, and it is what fills `maxLoss` and `maxFee` in the signed policy ([backend/src/policy/policyGenerator.ts:16](../../backend/src/policy/policyGenerator.ts#L16)). For the same amount, direction, and pool state, the preview and the signed caps agree. A failed pool read returns `503` `pool_state_unavailable` on both routes. Neither route substitutes `amount / 1000`.

## The formula

`calculateRisk` in [backend/src/risk/riskEngine.ts](../../backend/src/risk/riskEngine.ts#L81) is a within-tick constant-product quote. Active liquidity `L` is a depth proxy: virtual reserves `x = L / sqrt(P)` and `y = L * sqrt(P)`, with `sqrt(P)` stored as `sqrtPriceX96`. The quote does not walk neighboring ticks.

```text
Q96 = 2^96
amount = abs(amountSpecified)
fee = amount * feePips / 1_000_000          // pool swap fee, not impact
amountIn = amount - fee
estimatedFee = fee

zeroForOne (token0 in, price down):
  nextSqrt = ceil(L * Q96 * sqrtP / (L * Q96 + amountIn * sqrtP))
  amountOut = L * (sqrtP - nextSqrt) / Q96
  outputValueInInput = amountOut * Q96 / sqrtP * Q96 / sqrtP

oneForZero (token1 in, price up):
  nextSqrt = sqrtP + amountIn * Q96 / L
  amountOut = L * Q96 * (nextSqrt - sqrtP) / (nextSqrt * sqrtP)
  outputValueInInput = amountOut * sqrtP / Q96 * sqrtP / Q96

estimatedLoss = amountIn - outputValueInInput
lossBps = estimatedLoss * 10_000 / amount
maxLoss = estimatedLoss * 2
maxFee = estimatedFee * 2
```

`sqrtP` is `sqrtPriceX96`. `zeroForOne` selects the direction. `estimatedLoss` is the curvature shortfall against selling `amountIn` at the spot price, in input-token units. Integer division rounds the quoted output value down, so those divisions do not understate the shortfall.

| `lossBps` | Level |
| --- | --- |
| `<= 10` | `LOW` |
| `<= 50` | `MEDIUM` |
| `> 50` | `HIGH` |

A zero amount returns zeros and `LOW`. If the fee is unusable, the price is outside Uniswap v4 bounds, liquidity is zero, the input is at least the virtual reserve, the next price would leave tick bounds, or the quote rounds to zero output, `estimatedLoss` is the full input amount and the level is `HIGH`.

`model` is the literal `active-liquidity-impact`.

## The disclaimer

The API text, returned on both `/risk-preview` and `/policy`, is:

> Estimates price impact from the current pool state for this trade size. It does not read the mempool or detect sandwich attacks.

Declared at [backend/src/risk/riskPreview.ts:6](../../backend/src/risk/riskPreview.ts#L6).

The trade page prints that string. It also prints its own callout: "On a public route a bot can trade ahead of this fill. The figures below are a deterministic MVP estimate for this amount and direction, not live market analysis." That callout is page copy. It is not a detection result, and the model does not read the mempool or compare transactions.

## What it depends on

| Dependency | Why |
| --- | --- |
| Backend reachable | The calculation lives only in the backend |
| A positive parsed amount | The UI disables the button without one |
| A resolvable direction | `zeroForOne` selects which quote to run |
| A successful read of the protected pool | `slot0`, active liquidity, and the fee. A failed read is `503`, not another formula |

It does not depend on the wallet, the quote, or a mempool.

## Known limitations

- The quote stops at the current tick. A trade that leaves the active range can cost more on chain than this number.
- The values are in the input token's raw units. Basis points do not take a separate decimals argument. The trade page formats them with the input token's decimals ([frontend/src/pages/TradePage.tsx:349](../../frontend/src/pages/TradePage.tsx#L349)).
- `maxLoss` and `maxFee` are twice the estimates. The hook compares those caps with the estimates the caller puts in `hookData`. The hook does not measure this loss.
- The estimate is computed from the requested amount and the pool state at request time. The page hides the metrics when the input no longer matches what was previewed ([frontend/src/pages/TradePage.tsx:65](../../frontend/src/pages/TradePage.tsx#L65)).
- The score does not detect a sandwich and does not say whether `minAmountOut` will be met.

## Related pages

- [API reference](../api/reference.md#post-risk-preview).
- [Policy lifecycle](policy-lifecycle.md).
- [Backend service](../services/backend.md).
