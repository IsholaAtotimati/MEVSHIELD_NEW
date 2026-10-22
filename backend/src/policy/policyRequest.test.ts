import assert from "node:assert/strict";
import test from "node:test";
import {
  EXPECTED_PROTECTED_POOL,
  assertConfiguredPoolId,
} from "../config/runtimeConfig.js";
import { PolicyRequestSchema } from "./policyRequest.js";

const validRequest = {
  poolId: EXPECTED_PROTECTED_POOL.poolId,
  trader: "0xE57525678cbf6417F685727b77551316a3De3bba",
  nonce: "1",
  expiry: "2",
  amountSpecified: "-1000000",
  zeroForOne: true,
  sqrtPriceLimitX96: "4295128740",
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

  test("rejects missing, zero, or malformed minimum output", () => {
    for (const minAmountOut of [undefined, "0", "-1", "1.5", "not-a-number"]) {
      const request = { ...validRequest, minAmountOut };
      assert.equal(PolicyRequestSchema.safeParse(request).success, false);
    }
  });
  assert.throws(
    () => assertConfiguredPoolId(parsed.poolId, EXPECTED_PROTECTED_POOL),
    /does not match the configured protected pool/,
  );
});
