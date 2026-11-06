import assert from "node:assert/strict";
import test from "node:test";

import { getPolicyExecutionIssues } from "./policyExecutionReadiness.ts";

const valid = {
  policy: {
    policy: {
      poolId: `0x${"11".repeat(32)}`,
      trader: "0x0000000000000000000000000000000000000001",
      expiry: "2000",
      amountSpecified: "-100",
      zeroForOne: true,
      minAmountOut: "90",
      sqrtPriceLimitX96: "123",
    },
    registered: true,
  },
  nowMs: 1_000_000,
  poolId: `0x${"11".repeat(32)}`,
  account: "0x0000000000000000000000000000000000000001",
  amountInBaseUnits: 100n,
  zeroForOne: true,
  quote: {
    status: "available",
    poolId: `0x${"11".repeat(32)}`,
    amountInBaseUnits: 100n,
    zeroForOne: true,
    minAmountOutBaseUnits: 90n,
    sqrtPriceLimitX96: "123",
  },
  quoteIsFresh: true,
  allowance: 100n,
  allowanceIsChecking: false,
  allowanceError: null,
};

test("registered policy is executable only when expiry, trader, quote, and allowance match", () => {
  assert.deepEqual(getPolicyExecutionIssues(valid), []);

  const expired = getPolicyExecutionIssues({
    ...valid,
    nowMs: 2_000_000,
  });
  assert.match(expired.join(" "), /Policy expired/);

  const mismatchedQuote = getPolicyExecutionIssues({
    ...valid,
    quote: { ...valid.quote, sqrtPriceLimitX96: "124" },
  });
  assert.match(mismatchedQuote.join(" "), /price limit does not match/);

  const mismatchedWallet = getPolicyExecutionIssues({
    ...valid,
    account: "0x0000000000000000000000000000000000000002",
  });
  assert.match(mismatchedWallet.join(" "), /wallet that registered/);

  const staleQuote = getPolicyExecutionIssues({
    ...valid,
    quoteIsFresh: false,
  });
  assert.match(staleQuote.join(" "), /fresh protected-pool quote is required/);

  const mismatchedPool = getPolicyExecutionIssues({
    ...valid,
    quote: { ...valid.quote, poolId: `0x${"22".repeat(32)}` },
  });
  assert.match(mismatchedPool.join(" "), /fresh quote parameters/);

  const insufficientAllowance = getPolicyExecutionIssues({
    ...valid,
    allowance: 99n,
  });
  assert.match(insufficientAllowance.join(" "), /allowance is below/);

  const unknownAllowance = getPolicyExecutionIssues({
    ...valid,
    allowance: null,
    allowanceIsChecking: true,
  });
  assert.match(unknownAllowance.join(" "), /Checking the input-token allowance/);

  const unverifiedAllowance = getPolicyExecutionIssues({
    ...valid,
    allowance: null,
    allowanceIsChecking: false,
  });
  assert.match(unverifiedAllowance.join(" "), /Could not verify the input-token allowance/);

  const disconnected = getPolicyExecutionIssues({
    ...valid,
    account: null,
    allowance: null,
  });
  assert.deepEqual(disconnected, []);
});
