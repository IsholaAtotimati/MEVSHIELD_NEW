/**
 * Price-impact estimate from the current pool's active liquidity.
 *
 * This is a deterministic quote for one trade size against the liquidity that
 * is active at the current price. It estimates price impact from the current
 * pool state for this trade size. It does not read the mempool, compare
 * transactions, or detect a sandwich.
 *
 * The curve is the Uniswap v4 within-tick constant-product identity, using
 * active liquidity L as a depth proxy (virtual reserves x = L / sqrt(P),
 * y = L * sqrt(P)). The estimate does not walk neighboring ticks, so a trade
 * that would leave the current range can be worse on chain than this number.
 *
 *   Q96 = 2^96
 *   fee = amount * feePips / 1_000_000          // pool swap fee, not impact
 *   amountIn = amount - fee
 *
 *   zeroForOne (token0 in, price down):
 *     nextSqrt = ceil(L * Q96 * sqrtP / (L * Q96 + amountIn * sqrtP))
 *     amountOut = L * (sqrtP - nextSqrt) / Q96
 *     outputValueInInput = amountOut * Q96 / sqrtP * Q96 / sqrtP
 *   oneForZero (token1 in, price up):
 *     nextSqrt = sqrtP + amountIn * Q96 / L
 *     amountOut = L * Q96 * (nextSqrt - sqrtP) / (nextSqrt * sqrtP)
 *     outputValueInInput = amountOut * sqrtP / Q96 * sqrtP / Q96
 *
 *   estimatedFee = fee
 *   estimatedLoss = amountIn - outputValueInInput
 *     (shortfall versus selling amountIn at the spot price with no curvature;
 *      integer division rounds the output value down, so the shortfall is not
 *      understated by those divisions)
 *   lossBps = estimatedLoss * 10_000 / amount
 *
 *   LOW    when lossBps <= 10
 *   MEDIUM when lossBps <= 50
 *   HIGH   when lossBps > 50
 *
 * If active liquidity cannot support the trade (no liquidity, input at least
 * the virtual reserve, next price outside TickMath bounds, or the quote rounds
 * to zero output), estimatedLoss is the full input amount and the level is HIGH.
 * There is no silent fallback to amount/1000.
 *
 * `zeroForOne` is the token orientation. Raw amounts already share the input
 * token's units, so basis points do not need a separate decimals argument.
 * `maxLoss` and `maxFee` stay twice the estimates so a caller that echoes
 * those estimates in hookData still satisfies the hook's comparison. The hook
 * does not measure this loss.
 */

export const LOW_MAX_LOSS_BPS = 10n;
export const MEDIUM_MAX_LOSS_BPS = 50n;

/** TickMath.MIN_SQRT_PRICE. A pool price below this is not a valid v4 price. */
const MIN_SQRT_PRICE_X96 = 4295128739n;
/** TickMath.MAX_SQRT_PRICE. A pool price at or above this is not a valid v4 price. */
const MAX_SQRT_PRICE_X96 =
  1461446703485210103287273052203988822378723970342n;
const Q96 = 1n << 96n;
const FEE_DENOMINATOR = 1_000_000n;
const BPS_DENOMINATOR = 10_000n;

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface SwapRiskInput {
  amountSpecified: bigint;
  zeroForOne: boolean;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  /** Uniswap fee in hundredths of a bip. 3000 is 0.30%. */
  feePips: bigint;
}

export interface RiskResult {
  estimatedLoss: bigint;
  estimatedFee: bigint;
  maxLoss: bigint;
  maxFee: bigint;
  riskLevel: RiskLevel;
}

export function calculateRisk(input: SwapRiskInput): RiskResult {
  const amount =
    input.amountSpecified < 0n
      ? -input.amountSpecified
      : input.amountSpecified;

  if (amount === 0n) {
    return {
      estimatedLoss: 0n,
      estimatedFee: 0n,
      maxLoss: 0n,
      maxFee: 0n,
      riskLevel: "LOW",
    };
  }

  const feeIsUsable =
    input.feePips >= 0n && input.feePips <= FEE_DENOMINATOR;
  const estimatedFee = feeIsUsable
    ? (amount * input.feePips) / FEE_DENOMINATOR
    : 0n;

  if (!feeIsUsable || !poolPriceIsUsable(input.sqrtPriceX96, input.liquidity)) {
    return unsupported(amount, estimatedFee);
  }

  const amountIn = amount - estimatedFee;
  if (amountIn === 0n) {
    return unsupported(amount, estimatedFee);
  }

  const quoted = input.zeroForOne
    ? quoteZeroForOne(amountIn, input.sqrtPriceX96, input.liquidity)
    : quoteOneForZero(amountIn, input.sqrtPriceX96, input.liquidity);

  if (!quoted) {
    return unsupported(amount, estimatedFee);
  }

  const estimatedLoss =
    amountIn > quoted.outputValueInInput
      ? amountIn - quoted.outputValueInInput
      : 0n;
  const lossBps = (estimatedLoss * BPS_DENOMINATOR) / amount;

  return {
    estimatedLoss,
    estimatedFee,
    maxLoss: estimatedLoss * 2n,
    maxFee: estimatedFee * 2n,
    riskLevel: levelForLossBps(lossBps),
  };
}

export function levelForLossBps(lossBps: bigint): RiskLevel {
  if (lossBps <= LOW_MAX_LOSS_BPS) {
    return "LOW";
  }
  if (lossBps <= MEDIUM_MAX_LOSS_BPS) {
    return "MEDIUM";
  }
  return "HIGH";
}

function unsupported(amount: bigint, estimatedFee: bigint): RiskResult {
  return {
    estimatedLoss: amount,
    estimatedFee,
    maxLoss: amount * 2n,
    maxFee: estimatedFee * 2n,
    riskLevel: "HIGH",
  };
}

function poolPriceIsUsable(sqrtPriceX96: bigint, liquidity: bigint): boolean {
  return (
    liquidity > 0n &&
    sqrtPriceX96 >= MIN_SQRT_PRICE_X96 &&
    sqrtPriceX96 < MAX_SQRT_PRICE_X96
  );
}

function quoteZeroForOne(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  liquidity: bigint,
): { outputValueInInput: bigint } | undefined {
  const virtualIn = (liquidity << 96n) / sqrtPriceX96;
  if (virtualIn === 0n || amountIn >= virtualIn) {
    return undefined;
  }

  const numerator = liquidity * Q96 * sqrtPriceX96;
  const denominator = liquidity * Q96 + amountIn * sqrtPriceX96;
  const nextSqrt = ceilDiv(numerator, denominator);
  if (nextSqrt <= MIN_SQRT_PRICE_X96 || nextSqrt >= sqrtPriceX96) {
    return undefined;
  }

  const amountOut = (liquidity * (sqrtPriceX96 - nextSqrt)) / Q96;
  if (amountOut === 0n) {
    return undefined;
  }

  const outputValueInInput =
    ((amountOut * Q96) / sqrtPriceX96 * Q96) / sqrtPriceX96;
  return { outputValueInInput };
}

function quoteOneForZero(
  amountIn: bigint,
  sqrtPriceX96: bigint,
  liquidity: bigint,
): { outputValueInInput: bigint } | undefined {
  const virtualIn = (liquidity * sqrtPriceX96) / Q96;
  if (virtualIn === 0n || amountIn >= virtualIn) {
    return undefined;
  }

  const nextSqrt = sqrtPriceX96 + (amountIn * Q96) / liquidity;
  if (nextSqrt >= MAX_SQRT_PRICE_X96 || nextSqrt <= sqrtPriceX96) {
    return undefined;
  }

  const amountOut =
    (liquidity * Q96 * (nextSqrt - sqrtPriceX96)) /
    (nextSqrt * sqrtPriceX96);
  if (amountOut === 0n) {
    return undefined;
  }

  const outputValueInInput =
    ((amountOut * sqrtPriceX96) / Q96 * sqrtPriceX96) / Q96;
  return { outputValueInInput };
}

function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
