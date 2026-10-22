import {
  encodeAbiParameters,
  encodePacked,
  keccak256,
  parseUnits,
  type Address,
  type Hex,
} from "viem";

export type PoolKey = {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
};

export type ProtectedPoolSnapshot = {
  chainId: number;
  poolManager: Address;
  hook: Address;
  hookPoolManager: Address;
  hookAuthorization: Address;
  poolManagerHasCode: boolean;
  hookHasCode: boolean;
  poolId: Hex;
  sqrtPriceX96: bigint;
  activeLiquidity: bigint;
  observedAtMs: number;
};

export type QuoteUnavailableReason =
  | "not-checked"
  | "rpc-failure"
  | "wrong-chain"
  | "pool-manager-mismatch"
  | "pool-manager-missing"
  | "hook-mismatch"
  | "hook-missing"
  | "unsupported-pool-key"
  | "pool-id-mismatch"
  | "stale-pool-state"
  | "uninitialized-pool"
  | "zero-active-liquidity"
  | "quote-simulation-unavailable";

export type ProtectedQuote =
  | {
      status: "unavailable";
      reason: QuoteUnavailableReason;
      observedAtMs?: number;
    }
  | {
      status: "available";
      poolId: Hex;
      amountInBaseUnits: bigint;
      amountOutBaseUnits: bigint;
      quotedAtMs: number;
    };

export type PoolExpectation = {
  chainId: number;
  poolManager: Address;
  hook: Address;
  hookAuthorization: Address;
  poolKey: PoolKey;
  poolId: Hex;
};

export function matchesBackendProtectedPoolConfig(
  value: unknown,
  expected: PoolExpectation,
): boolean {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (
    result.configurationStatus !== "valid" ||
    result.poolReadiness !== "not-checked" ||
    result.chainId !== expected.chainId ||
    typeof result.poolId !== "string" ||
    result.poolId.toLowerCase() !== expected.poolId.toLowerCase() ||
    typeof result.poolKey !== "object" ||
    result.poolKey === null
  ) {
    return false;
  }

  const poolKey = result.poolKey as Record<string, unknown>;
  return (
    typeof poolKey.currency0 === "string" &&
    poolKey.currency0.toLowerCase() === expected.poolKey.currency0.toLowerCase() &&
    typeof poolKey.currency1 === "string" &&
    poolKey.currency1.toLowerCase() === expected.poolKey.currency1.toLowerCase() &&
    poolKey.fee === expected.poolKey.fee &&
    poolKey.tickSpacing === expected.poolKey.tickSpacing &&
    typeof poolKey.hooks === "string" &&
    poolKey.hooks.toLowerCase() === expected.poolKey.hooks.toLowerCase()
  );
}

export type SwapReadiness = {
  canCheckRisk: boolean;
  canExecute: boolean;
  reasons: string[];
};

export const POOL_STATE_MAX_AGE_MS = 15_000;
export const DEMO_MIN_AMOUNT_OUT = 1n;
export const DEMO_USDC_PER_WETH = 2_000n;

export const poolManagerStateAbi = [
  {
    type: "function",
    name: "extsload",
    stateMutability: "view",
    inputs: [{ name: "slot", type: "bytes32" }],
    outputs: [{ name: "value", type: "bytes32" }],
  },
] as const;

const poolKeyAbi = [
  {
    type: "tuple",
    components: [
      { name: "currency0", type: "address" },
      { name: "currency1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickSpacing", type: "int24" },
      { name: "hooks", type: "address" },
    ],
  },
] as const;

export function parseTokenAmount(value: string, decimals: number): bigint | null {
  if (!/^\d+(?:\.\d*)?$/.test(value)) return null;
  if ((value.split(".")[1] ?? "").length > decimals) return null;

  try {
    return parseUnits(value, decimals);
  } catch {
    return null;
  }
}

export function calculateMinimumOutput(
  amountOutBaseUnits: bigint,
  slippageBps: number,
): bigint | null {
  const uint256Max = (1n << 256n) - 1n;
  if (
    amountOutBaseUnits <= 0n ||
    amountOutBaseUnits > uint256Max ||
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  ) {
    return null;
  }

  const minimum = (amountOutBaseUnits * BigInt(10_000 - slippageBps)) / 10_000n;
  return minimum > 0n ? minimum : null;
}

export function calculateDemoOutput(
  amountInBaseUnits: bigint,
  zeroForOne: boolean,
): bigint | null {
  if (amountInBaseUnits <= 0n) return null;

  const usdcScale = 10n ** 6n;
  const wethScale = 10n ** 18n;
  const amountOutBaseUnits = zeroForOne
    ? (amountInBaseUnits * wethScale) / (DEMO_USDC_PER_WETH * usdcScale)
    : (amountInBaseUnits * DEMO_USDC_PER_WETH * usdcScale) / wethScale;

  return amountOutBaseUnits > 0n ? amountOutBaseUnits : null;
}

export function sortCurrencies(
  tokenA: Address,
  tokenB: Address,
): Pick<PoolKey, "currency0" | "currency1"> {
  return BigInt(tokenA) < BigInt(tokenB)
    ? { currency0: tokenA, currency1: tokenB }
    : { currency0: tokenB, currency1: tokenA };
}

export function getZeroForOne(
  input: Address,
  output: Address,
  poolKey: Pick<PoolKey, "currency0" | "currency1">,
): boolean | null {
  if (
    input.toLowerCase() === poolKey.currency0.toLowerCase() &&
    output.toLowerCase() === poolKey.currency1.toLowerCase()
  ) {
    return true;
  }
  if (
    input.toLowerCase() === poolKey.currency1.toLowerCase() &&
    output.toLowerCase() === poolKey.currency0.toLowerCase()
  ) {
    return false;
  }
  return null;
}

export function calculatePoolId(poolKey: PoolKey): Hex {
  return keccak256(encodeAbiParameters(poolKeyAbi, [poolKey]));
}

export function assessProtectedPool(
  snapshot: ProtectedPoolSnapshot,
  expected: PoolExpectation,
  nowMs = Date.now(),
): ProtectedQuote {
  if (snapshot.chainId !== expected.chainId) {
    return { status: "unavailable", reason: "wrong-chain", observedAtMs: snapshot.observedAtMs };
  }
  if (snapshot.poolManager.toLowerCase() !== expected.poolManager.toLowerCase()) {
    return { status: "unavailable", reason: "pool-manager-mismatch", observedAtMs: snapshot.observedAtMs };
  }
  if (!snapshot.poolManagerHasCode) {
    return { status: "unavailable", reason: "pool-manager-missing", observedAtMs: snapshot.observedAtMs };
  }
  if (
    snapshot.hook.toLowerCase() !== expected.hook.toLowerCase() ||
    snapshot.hookPoolManager.toLowerCase() !== expected.poolManager.toLowerCase() ||
    snapshot.hookAuthorization.toLowerCase() !== expected.hookAuthorization.toLowerCase()
  ) {
    return { status: "unavailable", reason: "hook-mismatch", observedAtMs: snapshot.observedAtMs };
  }
  if (!snapshot.hookHasCode) {
    return { status: "unavailable", reason: "hook-missing", observedAtMs: snapshot.observedAtMs };
  }

  const key = snapshot.poolId === calculatePoolId(expected.poolKey);
  const currenciesSorted =
    BigInt(expected.poolKey.currency0) < BigInt(expected.poolKey.currency1);
  if (!key || !currenciesSorted || expected.poolKey.fee !== 3000 || expected.poolKey.tickSpacing !== 60) {
    return { status: "unavailable", reason: "unsupported-pool-key", observedAtMs: snapshot.observedAtMs };
  }
  if (snapshot.poolId.toLowerCase() !== expected.poolId.toLowerCase()) {
    return { status: "unavailable", reason: "pool-id-mismatch", observedAtMs: snapshot.observedAtMs };
  }
  if (
    !Number.isFinite(snapshot.observedAtMs) ||
    nowMs < snapshot.observedAtMs ||
    nowMs - snapshot.observedAtMs > POOL_STATE_MAX_AGE_MS
  ) {
    return { status: "unavailable", reason: "stale-pool-state", observedAtMs: snapshot.observedAtMs };
  }
  if (snapshot.sqrtPriceX96 === 0n) {
    return { status: "unavailable", reason: "uninitialized-pool", observedAtMs: snapshot.observedAtMs };
  }
  if (snapshot.activeLiquidity === 0n) {
    return { status: "unavailable", reason: "zero-active-liquidity", observedAtMs: snapshot.observedAtMs };
  }

  // Pool spot state cannot reproduce tick traversal, fees, and router/hook effects.
  return {
    status: "unavailable",
    reason: "quote-simulation-unavailable",
    observedAtMs: snapshot.observedAtMs,
  };
}

export async function loadProtectedPoolQuote(
  fetchSnapshot: () => Promise<ProtectedPoolSnapshot>,
  expected: PoolExpectation,
): Promise<ProtectedQuote> {
  try {
    return assessProtectedPool(await fetchSnapshot(), expected);
  } catch {
    return { status: "unavailable", reason: "rpc-failure" };
  }
}

export function isFreshQuote(
  quote: ProtectedQuote,
  nowMs = Date.now(),
  amountInBaseUnits?: bigint | null,
  poolId?: Hex,
): boolean {
  return (
    quote.status === "available" &&
    Number.isFinite(quote.quotedAtMs) &&
    nowMs >= quote.quotedAtMs &&
    nowMs - quote.quotedAtMs <= POOL_STATE_MAX_AGE_MS &&
    quote.amountInBaseUnits > 0n &&
    quote.amountOutBaseUnits > 0n &&
    /^0x[0-9a-fA-F]{64}$/.test(quote.poolId) &&
    (amountInBaseUnits === undefined || quote.amountInBaseUnits === amountInBaseUnits) &&
    (poolId === undefined || quote.poolId.toLowerCase() === poolId.toLowerCase())
  );
}

export function isFreshDemoPoolReadiness(
  result: ProtectedQuote,
  nowMs = Date.now(),
): boolean {
  return (
    result.status === "unavailable" &&
    result.reason === "quote-simulation-unavailable" &&
    Number.isFinite(result.observedAtMs) &&
    result.observedAtMs !== undefined &&
    nowMs >= result.observedAtMs &&
    nowMs - result.observedAtMs <= POOL_STATE_MAX_AGE_MS
  );
}

export function calculateSwapReadiness(input: {
  amountInBaseUnits: bigint | null;
  quote: ProtectedQuote;
  nowMs?: number;
  demoMode?: boolean;
  demoEstimateAvailable?: boolean;
  poolId: Hex;
  poolKeyMatches: boolean;
  backendPoolKeyVerified: boolean;
  protocolAddressesVerified: boolean;
  minimumOutputProtocolVerified: boolean;
  authorizationVerified: boolean;
  policyBoundsVerified: boolean;
}): SwapReadiness {
  const reasons: string[] = [];
  const quoteFresh = isFreshQuote(
    input.quote,
    input.nowMs,
    input.amountInBaseUnits,
    input.poolId,
  );
  const positiveAmount =
    input.amountInBaseUnits !== null && input.amountInBaseUnits > 0n;
  const outputEstimateReady = input.demoMode
    ? input.demoEstimateAvailable === true
    : quoteFresh;

  if (!positiveAmount) reasons.push("Enter a valid positive input amount.");
  if (!input.poolKeyMatches) reasons.push("The configured protected pool key is invalid.");
  if (!outputEstimateReady) {
    reasons.push(
      input.demoMode
        ? "A valid deterministic demo estimate is unavailable."
        : "A fresh quote for the protected pool is unavailable.",
    );
  }
  if (!input.backendPoolKeyVerified) reasons.push("The backend pool-key configuration is unverified.");
  if (!input.protocolAddressesVerified) reasons.push("The Sepolia verifier or signer configuration is unverified.");
  if (!input.minimumOutputProtocolVerified) reasons.push("The signed-minimum-output v2 contracts are not deployed and verified.");
  if (!input.authorizationVerified) reasons.push("The protected route authorization is unverified.");

  const canCheckRisk =
    positiveAmount &&
    input.poolKeyMatches &&
    outputEstimateReady &&
    input.backendPoolKeyVerified &&
    input.protocolAddressesVerified &&
    input.minimumOutputProtocolVerified &&
    input.authorizationVerified;
  if (!input.policyBoundsVerified) reasons.push("Registered policy bounds are not verified.");

  return {
    canCheckRisk,
    canExecute: canCheckRisk && input.policyBoundsVerified,
    reasons,
  };
}

export function poolStateSlots(poolId: Hex): { slot0: Hex; liquidity: Hex } {
  const slot0 = BigInt(
    keccak256(encodePacked(["bytes32", "uint256"], [poolId, 6n])),
  );
  return {
    slot0: `0x${slot0.toString(16).padStart(64, "0")}`,
    liquidity: `0x${(slot0 + 3n).toString(16).padStart(64, "0")}`,
  };
}

export function decodePoolState(slot0: Hex, liquidity: Hex): {
  sqrtPriceX96: bigint;
  activeLiquidity: bigint;
} {
  return {
    sqrtPriceX96: BigInt(slot0) & ((1n << 160n) - 1n),
    activeLiquidity: BigInt(liquidity) & ((1n << 128n) - 1n),
  };
}
