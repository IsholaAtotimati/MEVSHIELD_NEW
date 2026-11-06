import assert from "node:assert/strict";
import test from "node:test";

import {
  getSqrtPriceAtTick,
  sqrtPriceLimitNearTick,
  tickFromSlot0,
} from "./tickPrice.ts";

test("tick 0 is 2^96", () => {
  assert.equal(getSqrtPriceAtTick(0), 1n << 96n);
});

test("a negative tick is below 2^96 and a positive tick is above it", () => {
  const spot = getSqrtPriceAtTick(0);
  assert.ok(getSqrtPriceAtTick(-500) < spot);
  assert.ok(getSqrtPriceAtTick(500) > spot);
});

test("the router limit stays 500 ticks from the current tick", () => {
  assert.equal(sqrtPriceLimitNearTick(0, true), getSqrtPriceAtTick(-500));
  assert.equal(sqrtPriceLimitNearTick(0, false), getSqrtPriceAtTick(500));
});

test("slot0 tick is the signed int24 above the sqrt price", () => {
  const sqrt = 1n << 96n;
  const negative = (0x1000000 - 500) & 0xffffff;
  const word = sqrt | (BigInt(negative) << 160n);
  assert.equal(tickFromSlot0(word), -500);
});
