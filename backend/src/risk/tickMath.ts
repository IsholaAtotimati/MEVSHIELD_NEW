const MIN_TICK = -887272;
const MAX_TICK = 887272;
const MIN_SQRT_RATIO = 4295128739n;
const MAX_SQRT_RATIO = 1461446703485210103287273052203988822378723970342n;
const Q32 = 1n << 32n;
const Q128 = 1n << 128n;
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO = 0n;
const ONE = 1n;

const TICK_MULTIPLIERS = [
  "0xfff97272373d413259a46990580e213a",
  "0xfff2e50f5f656932ef12357cf3c7fdcc",
  "0xffe5caca7e10e4e61c3624eaa0941cd0",
  "0xffcb9843d60f6159c9db58835c926644",
  "0xff973b41fa98c081472e6896dfb254c0",
  "0xff2ea16466c96a3843ec78b326b52861",
  "0xfe5dee046a99a2a811c461f1969c3053",
  "0xfcbe86c7900a88aedcffc83b479aa3a4",
  "0xf987a7253ac413176f2b074cf7815e54",
  "0xf3392b0822b70005940c7a398e4b70f3",
  "0xe7159475a2c29b7443b29c7fa6e889d9",
  "0xd097f3bdfd2022b8845ad8f792aa5825",
  "0xa9f746462d870fdf8a65dc1f90e061e5",
  "0x70d869a156d2a1b890bb3df62baf32f7",
  "0x31be135f97d08fd981231505542fcfa6",
  "0x9aa508b5b7a84e1c677de54f3e99bc9",
  "0x5d6af8dedb81196699c329225ee604",
  "0x2216e584f5fa1ea926041bedfe98",
  "0x48a170391f7dc42444e8fa2",
] as const;

export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error("Tick is outside the Uniswap v4 range.");
  }

  const absTick = Math.abs(tick);

  let ratio: bigint =
    (absTick & 0x1) !== 0 ? BigInt("0xfffcb933bd6fad37aa2d162d1a594001") : Q128;

  for (let bit = 1; bit < 20; bit += 1) {
    if ((absTick & (1 << bit)) !== 0) {
      const mulBy = BigInt(TICK_MULTIPLIERS[bit - 1]);
      ratio = (ratio * mulBy) >> 128n;
    }
  }

  if (tick > 0) ratio = MAX_UINT256 / ratio;

  const quotient = ratio >> 32n;
  return ratio % Q32 === 0n ? quotient : quotient + 1n;
}

export function tickAtSqrtRatio(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < MIN_SQRT_RATIO || sqrtPriceX96 >= MAX_SQRT_RATIO) {
    throw new Error("sqrtPriceX96 is outside the Uniswap v4 range.");
  }

  const sqrtRatioX128 = sqrtPriceX96 << 32n;
  const msb = mostSignificantBit(sqrtRatioX128);

  let r: bigint;
  if (msb >= 128n) {
    r = sqrtRatioX128 >> (msb - 127n);
  } else {
    r = sqrtRatioX128 << (127n - msb);
  }

  let log2 = (msb - 128n) << 64n;
  for (let i = 0; i < 14; i += 1) {
    r = (r * r) >> 127n;
    const f = r >> 128n;
    log2 |= f << BigInt(63 - i);
    r >>= f;
  }

  const logSqrt10001 = log2 * 255738958999603826347141n;
  const tickLow = Number((logSqrt10001 - 3402992956809132418596140100660247210n) >> 128n);
  const tickHigh = Number((logSqrt10001 + 291339464771989622907027621153398088495n) >> 128n);

  if (tickLow === tickHigh) return tickLow;
  return tickHigh <= Number(sqrtPriceX96) ? tickHigh : tickLow;
}

function mostSignificantBit(value: bigint): bigint {
  if (value <= 0n) return 0n;
  let bit = 0n;
  while ((value >> bit) > 1n) bit += 1n;
  return bit;
}

export const TICK_MATH_LIMITS = {
  minTick: MIN_TICK,
  maxTick: MAX_TICK,
  minSqrtRatio: MIN_SQRT_RATIO,
  maxSqrtRatio: MAX_SQRT_RATIO,
} as const;
