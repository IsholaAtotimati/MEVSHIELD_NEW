import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLiveQuoteRequest,
  isInsufficientExecutableLiquidityError,
  MAX_SMALLER_QUOTE_ATTEMPTS,
  smallerQuoteCandidates,
} from "./quoteRequest.ts";

test("builds backend-compatible USDC-to-WETH quote payloads", () => {
  assert.deepEqual(
    buildLiveQuoteRequest(10_000n, true, 50),
    { amountIn: "10000", zeroForOne: true, slippageBps: 50 },
  );
});

test("builds backend-compatible WETH-to-USDC quote payloads", () => {
  assert.deepEqual(
    buildLiveQuoteRequest(4_110_759_352_367n, false, 50),
    { amountIn: "4110759352367", zeroForOne: false, slippageBps: 50 },
  );
});

test("preserves integer base units instead of formatting token amounts", () => {
  assert.equal(
    buildLiveQuoteRequest(1_500_000n, true, 125).amountIn,
    "1500000",
  );
});

test("smaller quote candidates decrease by a factor of ten and stop before zero", () => {
  assert.deepEqual(smallerQuoteCandidates(1_000_000_000_000n), [
    100_000_000_000n,
    10_000_000_000n,
    1_000_000_000n,
    100_000_000n,
    10_000_000n,
    1_000_000n,
    100_000n,
    10_000n,
    1_000n,
    100n,
    10n,
    1n,
  ]);
  assert.deepEqual(smallerQuoteCandidates(9n), []);
  assert.deepEqual(smallerQuoteCandidates(1_000n, 2), [100n, 10n]);
  assert.equal(MAX_SMALLER_QUOTE_ATTEMPTS, 12);
});

test("only retries quote failures caused by insufficient executable liquidity", () => {
  assert.equal(
    isInsufficientExecutableLiquidityError(
      "Insufficient executable liquidity before the configured price limit.",
    ),
    true,
  );
  assert.equal(
    isInsufficientExecutableLiquidityError("Quote simulation returned no output."),
    false,
  );
  assert.equal(
    isInsufficientExecutableLiquidityError(
      "Protected pool LP fee does not match the configured static pool fee.",
    ),
    false,
  );
});
