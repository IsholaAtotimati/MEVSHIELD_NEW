import assert from "node:assert/strict";
import test from "node:test";
import { calculateRisk } from "./riskEngine.js";

/**
 * Spot price of 1 raw token1 per 1 raw token0. Basis points then depend only
 * on trade size versus active liquidity, which keeps the threshold cases exact.
 */
const UNIT_SQRT_PRICE_X96 = 1n << 96n;
const THRESHOLD_LIQUIDITY = 10_000_000n;

test("small trade in a deep pool is LOW", () => {
  const amount = 10n ** 18n;
  const result = calculateRisk({
    amountSpecified: amount,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: 10n ** 30n,
    feePips: 3000n,
  });

  assert.equal(result.estimatedFee, 3_000_000_000_000_000n);
  assert.equal(result.estimatedLoss, 994_010n);
  assert.equal(result.maxFee, 6_000_000_000_000_000n);
  assert.equal(result.maxLoss, 1_988_020n);
  assert.equal(result.riskLevel, "LOW");
  assert.equal((result.estimatedLoss * 10_000n) / amount, 0n);
  assert.notEqual(result.estimatedLoss, amount / 1000n);
});

test("10 bps of impact is LOW and 30 bps is MEDIUM", () => {
  const low = calculateRisk({
    amountSpecified: 9_501n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  });
  assert.equal(low.estimatedLoss, 10n);
  assert.equal(low.estimatedFee, 0n);
  assert.equal(low.maxLoss, 20n);
  assert.equal((low.estimatedLoss * 10_000n) / 9_501n, 10n);
  assert.equal(low.riskLevel, "LOW");

  const medium = calculateRisk({
    amountSpecified: 30_501n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  });
  assert.equal(medium.estimatedLoss, 93n);
  assert.equal(medium.maxLoss, 186n);
  assert.equal((medium.estimatedLoss * 10_000n) / 30_501n, 30n);
  assert.equal(medium.riskLevel, "MEDIUM");
  assert.notEqual(medium.estimatedLoss, 30_501n / 1000n);
});

test("50 bps of impact is MEDIUM and 51 bps is HIGH", () => {
  const medium = calculateRisk({
    amountSpecified: 50_501n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  });
  assert.equal(medium.estimatedLoss, 254n);
  assert.equal((medium.estimatedLoss * 10_000n) / 50_501n, 50n);
  assert.equal(medium.riskLevel, "MEDIUM");

  const high = calculateRisk({
    amountSpecified: 51_501n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  });
  assert.equal(high.estimatedLoss, 264n);
  assert.equal(high.maxLoss, 528n);
  assert.equal((high.estimatedLoss * 10_000n) / 51_501n, 51n);
  assert.equal(high.riskLevel, "HIGH");
});

test("active liquidity too small to support the trade is HIGH", () => {
  const result = calculateRisk({
    amountSpecified: 5_000n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: 1_000n,
    feePips: 0n,
  });

  assert.equal(result.estimatedLoss, 5_000n);
  assert.equal(result.estimatedFee, 0n);
  assert.equal(result.maxLoss, 10_000n);
  assert.equal(result.riskLevel, "HIGH");
  assert.notEqual(result.riskLevel, "LOW");
});

test("zeroForOne changes the estimate when the spot price is not 1", () => {
  const shared = {
    amountSpecified: 100_000n,
    sqrtPriceX96: 2n * UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  };
  const token0In = calculateRisk({ ...shared, zeroForOne: true });
  const token1In = calculateRisk({ ...shared, zeroForOne: false });

  assert.equal(token0In.estimatedLoss, 1_961n);
  assert.equal(token0In.riskLevel, "HIGH");
  assert.equal(token1In.estimatedLoss, 500n);
  assert.equal(token1In.riskLevel, "MEDIUM");
  assert.notEqual(token0In.estimatedLoss, token1In.estimatedLoss);
});

test("the sign of amountSpecified does not change the estimate", () => {
  const positive = calculateRisk({
    amountSpecified: 30_501n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  });
  const negative = calculateRisk({
    amountSpecified: -30_501n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: THRESHOLD_LIQUIDITY,
    feePips: 0n,
  });

  assert.deepEqual(positive, negative);
  assert.equal(negative.riskLevel, "MEDIUM");
});

test("zero amount yields zero estimates and LOW risk", () => {
  const zero = calculateRisk({
    amountSpecified: 0n,
    zeroForOne: true,
    sqrtPriceX96: 0n,
    liquidity: 0n,
    feePips: 0n,
  });

  assert.equal(zero.estimatedLoss, 0n);
  assert.equal(zero.estimatedFee, 0n);
  assert.equal(zero.maxLoss, 0n);
  assert.equal(zero.maxFee, 0n);
  assert.equal(zero.riskLevel, "LOW");
});
