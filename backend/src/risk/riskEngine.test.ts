import assert from "node:assert/strict";
import { calculateRisk } from "./riskEngine.js";

const positive = calculateRisk({
  amountSpecified: 1_000_000n,
  zeroForOne: true
});

assert.equal(positive.actualLoss, 1_000n);
assert.equal(positive.actualFee, 100n);
assert.equal(positive.maxLoss, 2_000n);
assert.equal(positive.maxFee, 200n);
assert.equal(positive.riskLevel, "LOW");

const negative = calculateRisk({
  amountSpecified: -1_000_000n,
  zeroForOne: false
});

assert.equal(negative.actualLoss, 1_000n);
assert.equal(negative.actualFee, 100n);
assert.equal(negative.maxLoss, 2_000n);
assert.equal(negative.maxFee, 200n);
assert.equal(negative.riskLevel, "LOW");

const zero = calculateRisk({
  amountSpecified: 0n,
  zeroForOne: true
});

assert.equal(zero.actualLoss, 0n);
assert.equal(zero.actualFee, 0n);
assert.equal(zero.maxLoss, 0n);
assert.equal(zero.maxFee, 0n);
assert.equal(zero.riskLevel, "LOW");

console.log("RiskEngine tests passed.");
