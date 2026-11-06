import assert from "node:assert/strict";
import test from "node:test";

import { quoteWithinActiveTick } from "./quote.js";

const Q96 = 1n << 96n;
/** Unit price pool: sqrtPriceX96 = 2^96, so raw token0/token1 = 1. */
const UNIT_PRICE = 2n ** 96n;

function base(overrides: Partial<Parameters<typeof quoteWithinActiveTick>[0]> = {}) {
  return {
    amountIn: 1_000_000n,
    zeroForOne: true,
    sqrtPriceX96: UNIT_PRICE,
    liquidity: 10n ** 12n,
    feePips: 3000n,
    tick: 0,
    tickSpacing: 60,
    ...overrides,
  };
}

test("subtracts the pool fee from the input before pricing", () => {
  // L = 10^12, unit price, 30 bps fee. afterFee = 997_000.
  // True output = L*afterFee/(L+afterFee) = 996999.0007 units; the direct
  // price form floors the output, so the estimate is 996999 — one unit below
  // the constant-product rearrangement, which floors an intermediate term.
  const result = quoteWithinActiveTick(base());
  assert.ok(result.ok);
  if (!result.ok) return;
  const l = 10n ** 12n;
  const afterFee = 997_000n;
  const expected = (l * afterFee) / (l + afterFee); // 996999n
  assert.equal(result.amountOut, expected);
});

test("prices the one-for-zero direction with the same fee", () => {
  // oneForZero (token1 in) at unit price: sqrtPNew = sqrtP + afterFee*Q96/L.
  // The price-form output floors the true 999699.0007 to 999699, matching the
  // zeroForOne direction's conservative rounding.
  const result = quoteWithinActiveTick(base({ zeroForOne: false }));
  assert.ok(result.ok);
  if (!result.ok) return;
  const l = 10n ** 12n;
  const afterFee = 997_000n;
  const sqrtPNew = UNIT_PRICE + (afterFee * Q96) / l;
  const expected = (l * Q96 * (sqrtPNew - UNIT_PRICE)) / (UNIT_PRICE * sqrtPNew);
  assert.equal(result.amountOut, expected); // 996999n
});

test("refuses an input larger than the active tick depth", () => {
  // dxMax at unit price over -60 ticks ~ L * (1/sqrtPb - 1) ~ 3e9; ask for more than that.
  const result = quoteWithinActiveTick(base({ amountIn: 10n ** 12n }));
  assert.deepEqual(result, { ok: false, error: "exceeds-active-tick" });
});

test("refuses the one-for-zero direction past the active tick depth", () => {
  // dyMax ~ L*(sqrtPb - sqrtP)/Q96 ~ 10^12 * 0.00299 ~ 3e9 (token1 units); ask for far more.
  const result = quoteWithinActiveTick(
    base({ zeroForOne: false, amountIn: 10n ** 14n }),
  );
  assert.deepEqual(result, { ok: false, error: "exceeds-active-tick" });
});

test("a pool with zero active liquidity is not quotable", () => {
  const result = quoteWithinActiveTick(base({ liquidity: 0n }));
  assert.deepEqual(result, { ok: false, error: "no-liquidity" });
});

test("the output never exceeds the naive fee-less unit-price bound", () => {
  // Price only worsens during the swap, so out <= afterFee * rawPrice.
  const result = quoteWithinActiveTick(base());
  assert.ok(result.ok);
  if (!result.ok) return;
  const afterFee = 999_700n;
  assert.ok(result.amountOut <= afterFee);
});

test("the new price stays inside the boundary tick", () => {
  const result = quoteWithinActiveTick(base());
  assert.ok(result.ok);
  if (!result.ok) return;
  const sqrtPb = getSqrtPriceBoundaryForTest();
  assert.ok(result.sqrtPriceNew > sqrtPb && result.sqrtPriceNew < UNIT_PRICE);
});

// Helper kept local so the test does not depend on tickMath exports.
import { getSqrtPriceAtTick } from "./tickMath.js";
function getSqrtPriceBoundaryForTest(): bigint {
  return getSqrtPriceAtTick(-60);
}
