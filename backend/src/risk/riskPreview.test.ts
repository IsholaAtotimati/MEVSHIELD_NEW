import assert from "node:assert/strict";
import test from "node:test";
import type { ActivePoolState } from "./poolState.js";
import { RiskPreviewRequestSchema, previewRisk } from "./riskPreview.js";

const UNIT_SQRT_PRICE_X96 = 1n << 96n;

const deepPool: ActivePoolState = {
  sqrtPriceX96: UNIT_SQRT_PRICE_X96,
  liquidity: 10n ** 30n,
  feePips: 3000n,
};

test("accepts a valid risk-preview request", () => {
  assert.equal(
    RiskPreviewRequestSchema.safeParse({
      amountSpecified: "1000000000000000000",
      zeroForOne: true,
    }).success,
    true,
  );
});

test("rejects malformed, missing, or invalid fields", () => {
  const invalidRequests = [
    { amountSpecified: "abc", zeroForOne: true },
    { amountSpecified: "1.2", zeroForOne: true },
    { amountSpecified: "1" },
    { zeroForOne: true },
    { amountSpecified: "1", zeroForOne: "true" },
  ];

  for (const request of invalidRequests) {
    assert.equal(RiskPreviewRequestSchema.safeParse(request).success, false);
  }
});

test("rejects zero amount", () => {
  const result = previewRisk(
    { amountSpecified: "0", zeroForOne: true },
    deepPool,
  );
  assert.deepEqual(result, {
    ok: false,
    error: "amountSpecified must not be zero",
  });
});

test("returns a pool-state price-impact estimate for a deep-pool trade", () => {
  const result = previewRisk(
    {
      amountSpecified: "1000000000000000000",
      zeroForOne: true,
    },
    deepPool,
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.estimatedLoss, "994010");
  assert.equal(result.data.estimatedFee, "3000000000000000");
  assert.equal(result.data.maxLoss, "1988020");
  assert.equal(result.data.maxFee, "6000000000000000");
  assert.equal(result.data.riskLevel, "LOW");
  assert.equal(result.data.model, "active-liquidity-impact");
  assert.match(
    result.data.disclaimer,
    /current pool state for this trade size/,
  );
  assert.doesNotMatch(result.data.disclaimer, /sandwich-attack probability/);
});

test("the same absolute amount and direction produce the same estimate", () => {
  const positive = previewRisk(
    {
      amountSpecified: "30501",
      zeroForOne: true,
    },
    {
      sqrtPriceX96: UNIT_SQRT_PRICE_X96,
      liquidity: 10_000_000n,
      feePips: 0n,
    },
  );
  const negative = previewRisk(
    {
      amountSpecified: "-30501",
      zeroForOne: true,
    },
    {
      sqrtPriceX96: UNIT_SQRT_PRICE_X96,
      liquidity: 10_000_000n,
      feePips: 0n,
    },
  );

  assert.equal(positive.ok, true);
  assert.equal(negative.ok, true);
  if (positive.ok && negative.ok) {
    assert.equal(positive.data.estimatedLoss, negative.data.estimatedLoss);
    assert.equal(positive.data.estimatedFee, negative.data.estimatedFee);
    assert.equal(positive.data.riskLevel, "MEDIUM");
    assert.equal(negative.data.riskLevel, "MEDIUM");
  }
});

test("preview can return HIGH when liquidity cannot support the trade", () => {
  const result = previewRisk(
    { amountSpecified: "5000", zeroForOne: false },
    {
      sqrtPriceX96: UNIT_SQRT_PRICE_X96,
      liquidity: 1_000n,
      feePips: 0n,
    },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.data.estimatedLoss, "5000");
  assert.equal(result.data.riskLevel, "HIGH");
});
