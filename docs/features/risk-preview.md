# Risk preview

**Status: shipped, with a formula that does not vary by risk.**

The risk preview returns a deterministic estimate for a swap size and displays it in the trade page shield report. It is a pure function of the amount. It is not a market assessment, and the response says so.

## What it does

`POST /risk-preview` accepts an amount and a direction and returns `estimatedLoss`, `estimatedFee`, `maxLoss`, `maxFee`, `riskLevel`, `model` and `disclaimer`. The trade page's first primary button calls it, then renders four metrics from the response in the shield report ([frontend/src/pages/TradePage.tsx:282](../../frontend/src/pages/TradePage.tsx#L282)).

The same calculation runs inside `POST /policy` through `generatePolicy`, and it is what fills `maxLoss` and `maxFee` in the signed policy ([backend/src/policy/policyGenerator.ts:21](../../backend/src/policy/policyGenerator.ts#L21)). So the preview and the signed caps always agree.

## The formula

```
absolute      = abs(amountSpecified)
estimatedLoss = absolute / 1000     (integer division)
estimatedFee  = absolute / 10000    (integer division)
maxLoss       = estimatedLoss * 2
maxFee        = estimatedFee * 2
riskLevel     = "LOW"               (always)
```

Source: [backend/src/risk/riskEngine.ts:14](../../backend/src/risk/riskEngine.ts#L14).

Consequences a reader should expect and does not get:

- Loss scales linearly with size and nothing else. Every trade of the same notional produces the same estimate.
- `zeroForOne` is accepted in the input type and never read. Direction has no effect.
- `riskLevel` is a literal type, so `MEDIUM` and `HIGH` are unreachable. The frontend validator accepts all three strings because it validates a wire type, not the current model ([frontend/src/lib/apiValidation.ts:99](../../frontend/src/lib/apiValidation.ts#L99)).
- `maxLoss` is exactly twice `estimatedLoss`, so the cap is always satisfied by the estimate it is compared against. In that sense the cap is a constant ratio, not a limit derived from anything.

## The disclaimer

The constant is:

> Formula-based estimates only. Not a live market-risk measurement or a prediction of sandwich-attack probability.

Declared at [backend/src/risk/riskPreview.ts:5](../../backend/src/risk/riskPreview.ts#L5) and returned on both `/risk-preview` and `/policy`. The trade page also renders its own wording for the risk status line, describing the result as a deterministic MVP estimate.

## What it depends on

| Dependency | Why |
| --- | --- |
| Backend reachable | The calculation lives only in the backend |
| A positive parsed amount | The UI disables the button without one |
| A resolvable direction | Needed for the request, though not used by the calculation |

It does not depend on the pool, the quote, the wallet, or the chain.

## Known limitations

- The estimate uses only trade size. Price impact, volatility, liquidity depth and MEV exposure are named in the source comment as future inputs and are not implemented ([backend/src/risk/riskEngine.ts:20](../../backend/src/risk/riskEngine.ts#L20)).
- The values are in the base units of whatever token the caller meant. The route has no token context, so a 6-decimal amount and an 18-decimal amount of the same magnitude produce the same numbers.
- `riskLevel` carries no information.
- The trade page shows the metrics in the input token's decimals, which matches the base units if the amount came from that token ([frontend/src/pages/TradePage.tsx:293](../../frontend/src/pages/TradePage.tsx#L293)). The route itself cannot enforce that.
- The estimate is not tied to the quote. It is computed from the requested amount, so changing the amount invalidates the displayed metrics, and the page hides them when the input no longer matches what was previewed ([frontend/src/pages/TradePage.tsx:45](../../frontend/src/pages/TradePage.tsx#L45)).

## Related pages

- [API reference](../api/reference.md#post-risk-preview).
- [Policy lifecycle](policy-lifecycle.md).
- [Backend service](../services/backend.md).
