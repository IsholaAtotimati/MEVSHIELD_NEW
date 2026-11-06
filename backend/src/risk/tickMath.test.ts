import assert from "node:assert/strict";
import test from "node:test";

import { getSqrtPriceAtTick, MAX_TICK } from "./tickMath.js";

test("tick 0 is 2^96", () => {
  assert.equal(getSqrtPriceAtTick(0), 1n << 96n);
});

test("a negative tick is below 2^96 and a positive tick is above it", () => {
  const spot = getSqrtPriceAtTick(0);
  assert.ok(getSqrtPriceAtTick(-500) < spot);
  assert.ok(getSqrtPriceAtTick(500) > spot);
});

test("the pair around a tick is the reciprocal price", () => {
  // getSqrtPriceAtTick(t) * getSqrtPriceAtTick(-t) stays within a rounding
  // step of Q96^2 because the port uses the same TickMath ratio table.
  const pos = getSqrtPriceAtTick(60);
  const neg = getSqrtPriceAtTick(-60);
  const q96 = 1n << 96n;
  const product = pos * neg;
  const slack = q96 * q96 / 10n ** 12n;
  assert.ok(
    product > q96 * q96 - slack && product < q96 * q96 + slack,
    `reciprocal pair drifted: ${product}`,
  );
});

test("the live Sepolia pool tick prices inside the pair band", () => {
  const at199086 = getSqrtPriceAtTick(199_086);
  const at199026 = getSqrtPriceAtTick(199_026);
  const at199146 = getSqrtPriceAtTick(199_146);
  assert.ok(at199026 < at199086 && at199086 < at199146);
});

test("ticks outside the Uniswap range are rejected", () => {
  assert.throws(() => getSqrtPriceAtTick(MAX_TICK + 1));
  assert.throws(() => getSqrtPriceAtTick(-MAX_TICK - 1));
  assert.throws(() => getSqrtPriceAtTick(1.5 as unknown as number));
});
