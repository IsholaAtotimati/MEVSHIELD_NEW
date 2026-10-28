import assert from "node:assert/strict";
import test from "node:test";
import { calculateRisk } from "./riskEngine.js";

test("positive amount uses absolute trade size for estimates", () => {
  const positive = calculateRisk({
    amountSpecified: 1_000_000n,
    zeroForOne: true,
  });

  assert.equal(positive.estimatedLoss, 1_000n);
  assert.equal(positive.estimatedFee, 100n);
  assert.equal(positive.maxLoss, 2_000n);
  assert.equal(positive.maxFee, 200n);
  assert.equal(positive.riskLevel, "LOW");
});

test("negative amount uses the same absolute trade size", () => {
  const negative = calculateRisk({
    amountSpecified: -1_000_000n,
    zeroForOne: false,
  });

  assert.equal(negative.estimatedLoss, 1_000n);
  assert.equal(negative.estimatedFee, 100n);
  assert.equal(negative.maxLoss, 2_000n);
  assert.equal(negative.maxFee, 200n);
  assert.equal(negative.riskLevel, "LOW");
});

test("zero amount yields zero estimates and LOW risk", () => {
  const zero = calculateRisk({
    amountSpecified: 0n,
    zeroForOne: true,
  });

  assert.equal(zero.estimatedLoss, 0n);
  assert.equal(zero.estimatedFee, 0n);
  assert.equal(zero.maxLoss, 0n);
  assert.equal(zero.maxFee, 0n);
  assert.equal(zero.riskLevel, "LOW");
});
