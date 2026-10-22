import assert from "node:assert/strict";
import { calculateRisk } from "./riskEngine.js";
const positive = calculateRisk({
    amountSpecified: 1000000n,
    zeroForOne: true
});
assert.equal(positive.estimatedLoss, 1000n);
assert.equal(positive.estimatedFee, 100n);
assert.equal(positive.maxLoss, 2000n);
assert.equal(positive.maxFee, 200n);
assert.equal(positive.riskLevel, "LOW");
const negative = calculateRisk({
    amountSpecified: -1000000n,
    zeroForOne: false
});
assert.equal(negative.estimatedLoss, 1000n);
assert.equal(negative.estimatedFee, 100n);
assert.equal(negative.maxLoss, 2000n);
assert.equal(negative.maxFee, 200n);
assert.equal(negative.riskLevel, "LOW");
const zero = calculateRisk({
    amountSpecified: 0n,
    zeroForOne: true
});
assert.equal(zero.estimatedLoss, 0n);
assert.equal(zero.estimatedFee, 0n);
assert.equal(zero.maxLoss, 0n);
assert.equal(zero.maxFee, 0n);
assert.equal(zero.riskLevel, "LOW");
console.log("RiskEngine tests passed.");
