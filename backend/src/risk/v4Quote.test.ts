import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSupportedV4PoolState,
  decodeV4PoolSnapshot,
  isCachedQuoteValidForPolicy,
  isQuoteCacheEntryValid,
  poolStorageSlots,
  simulateV4ExactInput,
  storeProtectedQuote,
  tickBitmapStorageSlot,
  tickInfoStorageSlot,
  validatePriceLimit,
  type V4PoolSnapshot,
} from "./v4Quote.js";
import { sqrtRatioAtTick, tickAtSqrtRatio } from "./tickMath.js";
import { EXPECTED_PROTECTED_POOL } from "../config/runtimeConfig.js";
import { MemoryStateBackend, MemoryStateStore } from "../state/stateStore.js";

const EMPTY_TICKS = {
  async getTick() {
    throw new Error("No initialized ticks are expected within this test range.");
  },
  async nextInitializedTickWithinOneWord(tick, lte, tickSpacing) {
    const compressed = Math.floor(tick / tickSpacing);
    if (lte) {
      return [
        (compressed - (compressed & 0xff)) * tickSpacing,
        false,
      ];
    }
    const nextCompressed = compressed + 1;
    return [
      (nextCompressed + (255 - (nextCompressed & 0xff))) * tickSpacing,
      false,
    ];
  },
};

test("quote cache validity requires both cache TTL and advertised expiry", () => {
  const issuedAtMs = 1_000_000;
  const quote = { expiresAt: new Date(issuedAtMs + 30_000).toISOString() };

  assert.equal(isQuoteCacheEntryValid(quote, issuedAtMs, issuedAtMs + 10_000), true);
  assert.equal(isQuoteCacheEntryValid(quote, issuedAtMs, issuedAtMs + 30_000), false);
  assert.equal(isQuoteCacheEntryValid(
    { expiresAt: new Date(issuedAtMs + 60_000).toISOString() },
    issuedAtMs,
    issuedAtMs + 15_001,
  ), false);
  assert.equal(isQuoteCacheEntryValid(
    quote,
    issuedAtMs,
    issuedAtMs + 60_000,
  ), false);
});

test("protected quote authorization is shared across store instances and checks every policy field", async () => {
  const backend = new MemoryStateBackend();
  const writer = new MemoryStateStore(backend);
  const reader = new MemoryStateStore(backend);
  const quote = {
    chainId: 11155111,
    poolId: EXPECTED_PROTECTED_POOL.poolId,
    zeroForOne: true,
    amountSpecified: "-1000",
    amountOut: "900",
    minAmountOut: "850",
    priceImpactBps: 1,
    sqrtPriceLimitX96: "123",
    feePips: 3000,
    blockNumber: 1,
    blockTimestamp: Math.floor(Date.now() / 1000),
    quotedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10_000).toISOString(),
    quoteId: "0xquote",
    poolState: { sqrtPriceX96: "1", tick: 0, liquidity: "10" },
  };
  await storeProtectedQuote(quote, writer);
  const request = {
    quoteId: quote.quoteId,
    poolId: quote.poolId,
    amountSpecified: quote.amountSpecified,
    zeroForOne: quote.zeroForOne,
    sqrtPriceLimitX96: quote.sqrtPriceLimitX96,
    minAmountOut: quote.minAmountOut,
  };

  assert.equal(await isCachedQuoteValidForPolicy(request, reader), true);
  assert.equal(
    await isCachedQuoteValidForPolicy({ ...request, minAmountOut: "849" }, reader),
    false,
  );
});

function makeSnapshot(
  overrides: Partial<V4PoolSnapshot> = {},
): V4PoolSnapshot {
  return {
    sqrtPriceX96: sqrtRatioAtTick(0),
    tick: 0,
    liquidity: 1_000_000_000_000_000_000n,
    protocolFee: 0n,
    lpFee: 3_000n,
    ...overrides,
  };
}

test("v4 slot decoding preserves tick, fees, and active liquidity", () => {
  const sqrtPriceX96 = sqrtRatioAtTick(199_086);
  const tick = 199_086;
  const lpFee = 3_000n;
  const protocolFee = 0n;
  const slot0Word =
    sqrtPriceX96 |
    (BigInt(tick) << 160n) |
    (protocolFee << 184n) |
    (lpFee << 208n);
  const liquidity = 987_654_321n;

  assert.deepEqual(
    decodeV4PoolSnapshot(slot0Word, liquidity),
    {
      sqrtPriceX96,
      tick,
      liquidity,
      protocolFee,
      lpFee,
    },
  );
});

test("v4 storage slots use the pool and signed mapping keys", () => {
  const slots = poolStorageSlots(EXPECTED_PROTECTED_POOL.poolId);
  assert.equal(slots.liquidity, slots.state + 3n);
  assert.equal(slots.ticks, slots.state + 4n);
  assert.equal(slots.tickBitmap, slots.state + 5n);
  assert.notEqual(
    tickBitmapStorageSlot(slots.tickBitmap, -1),
    tickBitmapStorageSlot(slots.tickBitmap, 1),
  );
  assert.notEqual(
    tickInfoStorageSlot(slots.ticks, -60),
    tickInfoStorageSlot(slots.ticks, 60),
  );
});

test("tick math round-trips the v4 extrema and price-limit ticks", () => {
  assert.equal(sqrtRatioAtTick(0), 1n << 96n);
  assert.equal(sqrtRatioAtTick(-887_272), 4_295_128_739n);
  assert.equal(
    sqrtRatioAtTick(887_272),
    1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342n,
  );
  for (const tick of [-600, -60, 0, 60, 600, 199_086]) {
    assert.equal(tickAtSqrtRatio(sqrtRatioAtTick(tick)), tick);
  }
});

test("quotes require supported fee state but allow zero starting liquidity", () => {
  assert.equal(
    assertSupportedV4PoolState(EXPECTED_PROTECTED_POOL, makeSnapshot()),
    3_000,
  );
  assert.equal(
    assertSupportedV4PoolState(
      EXPECTED_PROTECTED_POOL,
      makeSnapshot({ liquidity: 0n }),
    ),
    3_000,
  );
  assert.throws(
    () =>
      assertSupportedV4PoolState(
        EXPECTED_PROTECTED_POOL,
        makeSnapshot({ protocolFee: 1n }),
      ),
    /protocol fees are nonzero/,
  );
  assert.throws(
    () =>
      assertSupportedV4PoolState(
        EXPECTED_PROTECTED_POOL,
        makeSnapshot({ lpFee: 500n }),
      ),
    /LP fee does not match/,
  );
});

test("price limits must match swap direction and remain within 600 ticks", () => {
  const snapshot = makeSnapshot();
  assert.equal(
    validatePriceLimit(snapshot, true, sqrtRatioAtTick(-600)),
    -600,
  );
  assert.equal(
    validatePriceLimit(snapshot, false, sqrtRatioAtTick(600)),
    600,
  );
  assert.throws(
    () => validatePriceLimit(snapshot, true, sqrtRatioAtTick(601)),
    /invalid for the requested swap direction/,
  );
  assert.throws(
    () => validatePriceLimit(snapshot, false, sqrtRatioAtTick(601)),
    /within 600 ticks/,
  );
});

test("v4 exact-input simulation produces output in both directions", async () => {
  const snapshot = makeSnapshot();
  const amountIn = 1_000_000_000_000_000n;
  const zeroForOneOut = await simulateV4ExactInput(
    snapshot,
    EXPECTED_PROTECTED_POOL.tickSpacing,
    3_000,
    amountIn,
    true,
    sqrtRatioAtTick(-600),
    EMPTY_TICKS,
  );
  const oneForZeroOut = await simulateV4ExactInput(
    snapshot,
    EXPECTED_PROTECTED_POOL.tickSpacing,
    3_000,
    amountIn,
    false,
    sqrtRatioAtTick(600),
    EMPTY_TICKS,
  );
  assert.ok(zeroForOneOut > 0n);
  assert.ok(oneForZeroOut > 0n);
  assert.ok(zeroForOneOut >= 0n);
});

test("exact-input simulation rejects an unfillable amount at the price limit", async () => {
  const noLiquidity = makeSnapshot({ liquidity: 0n });
  await assert.rejects(
    simulateV4ExactInput(
      noLiquidity,
      EXPECTED_PROTECTED_POOL.tickSpacing,
      3_000,
      1n,
      true,
      sqrtRatioAtTick(-600),
      EMPTY_TICKS,
    ),
    /Insufficient executable liquidity/,
  );

  await assert.rejects(
    simulateV4ExactInput(
      makeSnapshot(),
      EXPECTED_PROTECTED_POOL.tickSpacing,
      3_000,
      1_000_000_000_000_000_000n,
      true,
      sqrtRatioAtTick(0),
      EMPTY_TICKS,
    ),
    /Insufficient executable liquidity|invalid for the requested swap direction/,
  );
});

test("simulation crosses into initialized liquidity from zero active liquidity", async () => {
  const liquidityNet = 1_000_000n;
  const crossingProvider = (zeroForOne: boolean) => {
    let crossed = false;
    return {
      async getTick() {
        crossed = true;
        return { liquidityNet: zeroForOne ? -liquidityNet : liquidityNet };
      },
      async nextInitializedTickWithinOneWord(
        _tick: number,
        lte: boolean,
        _spacing: number,
      ): Promise<[number, boolean]> {
        if (!crossed && zeroForOne && lte) return [0, true];
        if (!crossed && !zeroForOne && !lte) return [0, true];
        return [zeroForOne ? -60 : 60, false];
      },
    };
  };

  const zeroForOneOut = await simulateV4ExactInput(
    makeSnapshot({
      tick: 60,
      sqrtPriceX96: sqrtRatioAtTick(60),
      liquidity: 0n,
    }),
    60,
    3_000,
    1_000n,
    true,
    sqrtRatioAtTick(-60),
    crossingProvider(true),
  );
  const oneForZeroOut = await simulateV4ExactInput(
    makeSnapshot({
      tick: -60,
      sqrtPriceX96: sqrtRatioAtTick(-60),
      liquidity: 0n,
    }),
    60,
    3_000,
    1_000n,
    false,
    sqrtRatioAtTick(60),
    crossingProvider(false),
  );

  assert.ok(zeroForOneOut > 0n);
  assert.ok(oneForZeroOut > 0n);
});
