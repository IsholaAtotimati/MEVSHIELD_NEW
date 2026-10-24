import assert from "node:assert/strict";
import test from "node:test";
import {
  assessProtectedPool,
  calculateDemoOutput,
  calculateMinimumOutput,
  calculatePoolId,
  calculateSwapReadiness,
  getZeroForOne,
  isFreshDemoPoolReadiness,
  isFreshQuote,
  loadProtectedPoolQuote,
  matchesBackendProtectedPoolConfig,
  parseTokenAmount,
  sortCurrencies,
} from "./protectedQuote.ts";

const WETH = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
const USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
const HOOK = "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080";
const AUTHORIZATION = "0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5";
const OTHER = "0x0000000000000000000000000000000000000001";
const now = 100_000;

test("calculates positive minimum output in exact base units with bounded slippage", () => {
  assert.equal(calculateMinimumOutput(1_000_000n, 50), 995_000n);
  assert.equal(calculateMinimumOutput(1n, 0), 1n);
  assert.equal(calculateMinimumOutput(0n, 50), null);
  assert.equal(calculateMinimumOutput(1_000_000n, 10_000), null);
  assert.equal(calculateMinimumOutput(1_000_000n, -1), null);
  assert.equal(calculateMinimumOutput(1_000_000n, 1.5), null);
  assert.equal(calculateMinimumOutput(1n << 256n, 0), null);
});

test("calculates the fixed demo estimate in exact token base units", () => {
  assert.equal(calculateDemoOutput(10n ** 18n, false), 2_000_000_000n);
  assert.equal(calculateDemoOutput(2_000_000_000n, true), 10n ** 18n);
  assert.equal(calculateDemoOutput(1n, true), 500_000_000n);
  assert.equal(calculateDemoOutput(0n, false), null);
});

const currencies = sortCurrencies(WETH, USDC);
const poolKey = {
  ...currencies,
  fee: 3000,
  tickSpacing: 60,
  hooks: HOOK,
};
const poolId = calculatePoolId(poolKey);

const expected = {
  chainId: 11155111,
  poolManager: MANAGER,
  hook: HOOK,
  hookAuthorization: AUTHORIZATION,
  poolKey,
  poolId,
};

function snapshot(changes = {}) {
  return {
    chainId: expected.chainId,
    poolManager: MANAGER,
    hook: HOOK,
    hookPoolManager: MANAGER,
    hookAuthorization: AUTHORIZATION,
    poolManagerHasCode: true,
    hookHasCode: true,
    poolId,
    sqrtPriceX96: 1n,
    activeLiquidity: 1n,
    observedAtMs: now,
    ...changes,
  };
}

test("sorts WETH/USDC and derives each direction from currency0/currency1", () => {
  assert.equal(currencies.currency0.toLowerCase(), USDC.toLowerCase());
  assert.equal(currencies.currency1.toLowerCase(), WETH.toLowerCase());
  assert.equal(getZeroForOne(USDC, WETH, currencies), true);
  assert.equal(getZeroForOne(WETH, USDC, currencies), false);
  assert.equal(getZeroForOne(WETH, OTHER, currencies), null);
});

test("parses human amounts into exact base units using token decimals", () => {
  assert.equal(parseTokenAmount("1.000000000000000001", 18), 1_000_000_000_000_000_001n);
  assert.equal(parseTokenAmount("12.345678", 6), 12_345_678n);
  assert.equal(parseTokenAmount("1.0000001", 6), null);
  assert.equal(parseTokenAmount("0.1e2", 18), null);
});

test("rejects an unsupported or mismatched pool ID", () => {
  assert.equal(
    assessProtectedPool(snapshot({ poolId: OTHER }), expected, now).reason,
    "unsupported-pool-key",
  );
  assert.equal(
    assessProtectedPool(
      snapshot(),
      { ...expected, poolId: `0x${"11".repeat(32)}` },
      now,
    ).reason,
    "pool-id-mismatch",
  );
});

test("rejects a pool key with an incorrect fee or tick spacing", () => {
  const incorrectFee = {
    ...expected,
    poolKey: { ...poolKey, fee: 500 },
  };
  const incorrectTickSpacing = {
    ...expected,
    poolKey: { ...poolKey, tickSpacing: 10 },
  };
  assert.equal(
    assessProtectedPool(snapshot(), incorrectFee, now).reason,
    "unsupported-pool-key",
  );
  assert.equal(
    assessProtectedPool(snapshot(), incorrectTickSpacing, now).reason,
    "unsupported-pool-key",
  );
});

test("rejects a snapshot from a chain other than Sepolia", () => {
  assert.equal(
    assessProtectedPool(snapshot({ chainId: 1 }), expected, now).reason,
    "wrong-chain",
  );
});

test("rejects a wrong hook and a hook without deployed code", () => {
  assert.equal(
    assessProtectedPool(snapshot({ hook: OTHER }), expected, now).reason,
    "hook-mismatch",
  );
  assert.equal(
    assessProtectedPool(snapshot({ hookHasCode: false }), expected, now).reason,
    "hook-missing",
  );
});

test("rejects stale state, an uninitialized pool, and zero active liquidity", () => {
  assert.equal(
    assessProtectedPool(snapshot({ observedAtMs: now - 15_001 }), expected, now).reason,
    "stale-pool-state",
  );
  assert.equal(
    assessProtectedPool(snapshot({ sqrtPriceX96: 0n }), expected, now).reason,
    "uninitialized-pool",
  );
  assert.equal(
    assessProtectedPool(snapshot({ activeLiquidity: 0n }), expected, now).reason,
    "zero-active-liquidity",
  );
});

test("reports unavailable when an initialized pool has liquidity but no exact simulator", () => {
  assert.deepEqual(
    assessProtectedPool(snapshot(), expected, now),
    {
      status: "unavailable",
      reason: "quote-simulation-unavailable",
      observedAtMs: now,
    },
  );
  assert.equal(
    assessProtectedPool(snapshot({ activeLiquidity: 1n }), expected, now).status,
    "unavailable",
  );
});

test("converts a failed RPC snapshot into an explicit unavailable result", async () => {
  const result = await loadProtectedPoolQuote(
    async () => {
      throw new Error("RPC request failed");
    },
    expected,
  );
  assert.equal(result.status, "unavailable");
  assert.equal(result.reason, "rpc-failure");
});

test("a missing quote keeps both risk and execution disabled", () => {
  const quote = {
    status: "unavailable",
    reason: "uninitialized-pool",
    observedAtMs: now,
  };
  const readiness = calculateSwapReadiness({
    amountInBaseUnits: 1n,
    quote,
    nowMs: now,
    poolId,
    poolKeyMatches: true,
    backendPoolKeyVerified: true,
    protocolAddressesVerified: true,
    minimumOutputProtocolVerified: true,
    authorizationVerified: true,
    policyBoundsVerified: true,
  });
  assert.equal(readiness.canCheckRisk, false);
  assert.equal(readiness.canExecute, false);
});

test("rejects stale available quote data", () => {
  const quote = {
    status: "available",
    poolId,
    amountInBaseUnits: 1n,
    amountOutBaseUnits: 1n,
    quotedAtMs: now - 15_001,
  };
  assert.equal(isFreshQuote(quote, now), false);
});

test("demo mode requires a recent initialized and liquid pool inspection", () => {
  const ready = {
    status: "unavailable",
    reason: "quote-simulation-unavailable",
    observedAtMs: now,
  };
  assert.equal(isFreshDemoPoolReadiness(ready, now + 15_000), true);
  assert.equal(isFreshDemoPoolReadiness(ready, now + 15_001), false);
  assert.equal(
    isFreshDemoPoolReadiness(
      { ...ready, reason: "uninitialized-pool" },
      now,
    ),
    false,
  );
  assert.equal(
    isFreshDemoPoolReadiness({ ...ready, observedAtMs: undefined }, now),
    false,
  );
});

test("does not enable risk checking until backend pool key is verified", () => {
  const readiness = calculateSwapReadiness({
    amountInBaseUnits: 1n,
    quote: {
      status: "available",
      poolId,
      amountInBaseUnits: 1n,
      amountOutBaseUnits: 1n,
      quotedAtMs: now,
    },
    nowMs: now,
    poolId,
    poolKeyMatches: true,
    backendPoolKeyVerified: false,
    protocolAddressesVerified: true,
    minimumOutputProtocolVerified: true,
    authorizationVerified: true,
    policyBoundsVerified: false,
  });
  assert.equal(readiness.canCheckRisk, false);
  assert.equal(readiness.canExecute, false);
});

test("keeps risk and execution disabled until v2 minimum-output contracts are verified", () => {
  const readiness = calculateSwapReadiness({
    amountInBaseUnits: 1n,
    quote: {
      status: "available",
      poolId,
      amountInBaseUnits: 1n,
      amountOutBaseUnits: 1n,
      quotedAtMs: now,
    },
    nowMs: now,
    poolId,
    poolKeyMatches: true,
    backendPoolKeyVerified: true,
    protocolAddressesVerified: true,
    minimumOutputProtocolVerified: false,
    authorizationVerified: true,
    policyBoundsVerified: true,
  });
  assert.equal(readiness.canCheckRisk, false);
  assert.equal(readiness.canExecute, false);
  assert.match(readiness.reasons.join(" "), /minimum-output v2 contracts/);
});

test("demo mode can proceed without a market quote only when demo estimate and deployment checks pass", () => {
  const readiness = calculateSwapReadiness({
    amountInBaseUnits: 1n,
    quote: { status: "unavailable", reason: "quote-simulation-unavailable" },
    nowMs: now,
    demoMode: true,
    demoEstimateAvailable: true,
    poolId,
    poolKeyMatches: true,
    backendPoolKeyVerified: true,
    protocolAddressesVerified: true,
    minimumOutputProtocolVerified: true,
    authorizationVerified: true,
    policyBoundsVerified: false,
  });
  assert.equal(readiness.canCheckRisk, true);
  assert.equal(readiness.canExecute, false);

  const missingDemoEstimate = calculateSwapReadiness({
    amountInBaseUnits: 1n,
    quote: { status: "unavailable", reason: "quote-simulation-unavailable" },
    nowMs: now,
    demoMode: true,
    demoEstimateAvailable: false,
    poolId,
    poolKeyMatches: true,
    backendPoolKeyVerified: true,
    protocolAddressesVerified: true,
    minimumOutputProtocolVerified: true,
    authorizationVerified: true,
    policyBoundsVerified: true,
  });
  assert.equal(missingDemoEstimate.canCheckRisk, false);
  assert.equal(missingDemoEstimate.canExecute, false);
});

test("frontend verifies every backend pool-key field, chain, and pool ID", () => {
  const config = {
    configurationStatus: "valid",
    poolReadiness: "not-checked",
    chainId: expected.chainId,
    poolKey,
    poolId,
  };
  assert.equal(matchesBackendProtectedPoolConfig(config, expected), true);
  assert.equal(
    matchesBackendProtectedPoolConfig(
      { ...config, chainId: 1 },
      expected,
    ),
    false,
  );
  assert.equal(
    matchesBackendProtectedPoolConfig(
      { ...config, poolKey: { ...poolKey, hooks: OTHER } },
      expected,
    ),
    false,
  );
  assert.equal(
    matchesBackendProtectedPoolConfig(
      { ...config, poolKey: { ...poolKey, currency0: WETH, currency1: USDC } },
      expected,
    ),
    false,
  );
});
