import assert from "node:assert/strict";
import test from "node:test";

import { buildLiveQuoteRequest } from "./quoteRequest.ts";

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
