import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  EXPECTED_PROTECTED_POOL,
  assertConfiguredPoolId,
} from "../config/runtimeConfig.js";
import {
  MAX_SQRT_PRICE_LIMIT_X96,
  MIN_SQRT_PRICE_LIMIT_X96,
  PolicyRequestSchema,
} from "./policyRequest.js";

function futureExpiry(secondsFromNow = 300): string {
  return String(Math.floor(Date.now() / 1000) + secondsFromNow);
}

const validRequest = {
  poolId: EXPECTED_PROTECTED_POOL.poolId,
  trader: "0xE57525678cbf6417F685727b77551316a3De3bba",
  nonce: "1",
  expiry: futureExpiry(),
  amountSpecified: "-1000000",
  zeroForOne: true,
  sqrtPriceLimitX96: String(MIN_SQRT_PRICE_LIMIT_X96 + 1n),
  minAmountOut: "1",
};

test("accepts a valid request for the configured candidate pool ID", () => {
  const result = PolicyRequestSchema.safeParse(validRequest);
  assert.equal(result.success, true);
  if (result.success) {
    assert.doesNotThrow(() =>
      assertConfiguredPoolId(result.data.poolId, EXPECTED_PROTECTED_POOL),
    );
  }
});

test("rejects a request that attempts to override pool-key or chain configuration", () => {
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      poolKey: { hooks: "0x0000000000000000000000000000000000000001" },
    }).success,
    false,
  );
  assert.equal(
    PolicyRequestSchema.safeParse({ ...validRequest, chainId: 1 }).success,
    false,
  );
});

test("rejects a syntactically valid but unconfigured pool ID before signing", () => {
  const parsed = PolicyRequestSchema.parse({
    ...validRequest,
    poolId: `0x${"11".repeat(32)}`,
  });

  assert.throws(
    () => assertConfiguredPoolId(parsed.poolId, EXPECTED_PROTECTED_POOL),
    /does not match the configured protected pool/,
  );
});

test("rejects missing, zero, or malformed minimum output", () => {
  for (const minAmountOut of [
    undefined,
    "",
    "0",
    "-1",
    "1.5",
    "not-a-number",
    "01",
  ]) {
    const request = { ...validRequest, minAmountOut };
    assert.equal(PolicyRequestSchema.safeParse(request).success, false);
  }
});

test("rejects an overlong minimum output", () => {
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      minAmountOut: "1".repeat(100),
    }).success,
    false,
  );
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      minAmountOut: "1".repeat(79),
    }).success,
    false,
  );
});

test("accepts a 78-digit minimum output", () => {
  const minAmountOut = `1${"0".repeat(77)}`;
  assert.equal(minAmountOut.length, 78);
  assert.equal(
    PolicyRequestSchema.safeParse({ ...validRequest, minAmountOut }).success,
    true,
  );
});

test("rejects zero amountSpecified and malformed numeric strings", () => {
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      amountSpecified: "0",
    }).success,
    false,
  );
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      amountSpecified: "1.5",
    }).success,
    false,
  );
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      nonce: "0",
    }).success,
    false,
  );
});

test("rejects expired or far-future expiry values", () => {
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      expiry: String(Math.floor(Date.now() / 1000) - 1),
    }).success,
    false,
  );
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      expiry: String(Math.floor(Date.now() / 1000) + 31 * 60),
    }).success,
    false,
  );
});

test("rejects sqrt price limits outside Uniswap v4 bounds", () => {
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      sqrtPriceLimitX96: String(MIN_SQRT_PRICE_LIMIT_X96),
    }).success,
    false,
  );
  assert.equal(
    PolicyRequestSchema.safeParse({
      ...validRequest,
      sqrtPriceLimitX96: String(MAX_SQRT_PRICE_LIMIT_X96),
    }).success,
    false,
  );
});

/**
 * The bounds are exclusive, so the closest legal limits are MIN + 1 and MAX - 1.
 * The frontend sends exactly MIN + 1 for a zeroForOne swap and MAX - 1 for the
 * other direction, and the router accepts both. A previous revision of this
 * schema used MIN + 1 and MAX - 1 *as* its bounds, which rejected the very
 * value the UI sends and made every policy request a 400.
 */
test("accepts the closest legal limits the frontend actually sends", () => {
  for (const sqrtPriceLimitX96 of [
    MIN_SQRT_PRICE_LIMIT_X96 + 1n,
    MAX_SQRT_PRICE_LIMIT_X96 - 1n,
  ]) {
    assert.equal(
      PolicyRequestSchema.safeParse({
        ...validRequest,
        sqrtPriceLimitX96: String(sqrtPriceLimitX96),
      }).success,
      true,
      `${sqrtPriceLimitX96} should be accepted`,
    );
  }
});

test("the price-limit bounds match Uniswap v4 TickMath exactly", () => {
  // Pinned to the values in lib/v4-core/src/libraries/TickMath.sol, which
  // MEVShieldRouter compares against. Reading them from the Solidity source
  // keeps this test honest if the vendored v4 revision moves. The submodule is
  // optional in a bare checkout, so a missing file pins the literals instead.
  const tickMathPath = new URL(
    "../../../lib/v4-core/src/libraries/TickMath.sol",
    import.meta.url,
  );
  if (!existsSync(tickMathPath)) {
    assert.equal(MIN_SQRT_PRICE_LIMIT_X96, 4295128739n);
    assert.equal(
      MAX_SQRT_PRICE_LIMIT_X96,
      1461446703485210103287273052203988822378723970342n,
    );
    return;
  }

  const source = readFileSync(tickMathPath, "utf8");
  const declared = (name: string): bigint => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)\\s*;`));
    assert.ok(match, `TickMath.sol should declare ${name}`);
    return BigInt(match[1]);
  };
  assert.equal(MIN_SQRT_PRICE_LIMIT_X96, declared("MIN_SQRT_PRICE"));
  assert.equal(MAX_SQRT_PRICE_LIMIT_X96, declared("MAX_SQRT_PRICE"));
});
