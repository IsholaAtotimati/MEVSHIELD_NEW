import { getSqrtPriceAtTick } from "./tickMath.js";

/**
 * Within-active-tick output estimate for the protected pool.
 *
 * The pool state read gives the spot price, active liquidity, fee, and tick.
 * A real quote simulates the swap across ticks; this estimate deliberately
 * does not: it prices the swap only while it stays inside the active tick,
 * with the boundary set one tick-spacing step away so an initialized tick at
 * the current price is never assumed. A larger input is refused instead of
 * mispriced, and the response carries a disclaimer the client must show.
 */

const Q96 = 1n << 96n;
export const FEE_DENOMINATOR = 1_000_000n;

export const QUOTE_MODEL = "active-tick-estimate" as const;
export const QUOTE_DISCLAIMER =
  "Estimates the swap output from the current pool state while the trade stays inside the active tick. It refuses a larger trade instead of pricing across unverified ticks, and it is not an execution guarantee.";

export type QuoteWithinActiveTickInput = {
  /** Exact input amount, in the input token's base units, before fee. */
  amountIn: bigint;
  zeroForOne: boolean;
  sqrtPriceX96: bigint;
  liquidity: bigint;
  /** Pool fee in hundredths of a bip (3000 = 0.3%), or the slot0 dynamic fee. */
  feePips: bigint;
  tick: number;
  tickSpacing: number;
};

export type QuoteWithinActiveTickResult =
  | { ok: true; amountOut: bigint; sqrtPriceNew: bigint }
  | { ok: false; error: "no-liquidity" | "exceeds-active-tick" };

/**
 * The nearest initialized-tick boundary one spacing step away from `tick`,
 * on the side the swap moves toward. When `tick` sits exactly on a multiple
 * of the spacing, the boundary is one full step beyond it: the estimate never
 * assumes an initialized tick at the current price is crossable for free.
 */
function boundaryTick(tick: number, spacing: number, zeroForOne: boolean): number {
  const onBoundary = ((tick % spacing) + spacing) % spacing === 0;
  if (zeroForOne) {
    const floorTick = Math.floor(tick / spacing) * spacing;
    return onBoundary ? floorTick - spacing : floorTick;
  }
  const ceilTick = Math.ceil(tick / spacing) * spacing;
  return onBoundary ? ceilTick + spacing : ceilTick;
}

export function quoteWithinActiveTick(
  input: QuoteWithinActiveTickInput,
): QuoteWithinActiveTickResult {
  if (input.liquidity === 0n) {
    return { ok: false, error: "no-liquidity" };
  }
  if (input.amountIn <= 0n) {
    return { ok: false, error: "exceeds-active-tick" };
  }

  const afterFee = (input.amountIn * (FEE_DENOMINATOR - input.feePips)) / FEE_DENOMINATOR;
  if (afterFee === 0n) {
    return { ok: false, error: "exceeds-active-tick" };
  }

  const l = input.liquidity;
  const sqrtP = input.sqrtPriceX96;
  const sqrtPb = getSqrtPriceAtTick(
    boundaryTick(input.tick, input.tickSpacing, input.zeroForOne),
  );

  if (input.zeroForOne) {
    // token0 in: price falls. dxMax = L*Q96*(sqrtP - sqrtPb)/(sqrtP*sqrtPb).
    const dxMax = (l * Q96 * (sqrtP - sqrtPb)) / (sqrtP * sqrtPb);
    if (afterFee > dxMax) {
      return { ok: false, error: "exceeds-active-tick" };
    }
    // sqrtPNew = L*sqrtP*Q96 / (L*Q96 + afterFee*sqrtP)
    const sqrtPNew = (l * sqrtP * Q96) / (l * Q96 + afterFee * sqrtP);
    const amountOut = (l * (sqrtP - sqrtPNew)) / Q96;
    return { ok: true, amountOut, sqrtPriceNew: sqrtPNew };
  }

  // token1 in: price rises. dyMax = L*(sqrtPb - sqrtP)/Q96.
  const dyMax = (l * (sqrtPb - sqrtP)) / Q96;
  if (afterFee > dyMax) {
    return { ok: false, error: "exceeds-active-tick" };
  }
  // sqrtPNew = sqrtP + afterFee*Q96/L
  const sqrtPNew = sqrtP + (afterFee * Q96) / l;
  // out = L*Q96*(sqrtPNew - sqrtP)/(sqrtP*sqrtPNew)
  const amountOut = (l * Q96 * (sqrtPNew - sqrtP)) / (sqrtP * sqrtPNew);
  return { ok: true, amountOut, sqrtPriceNew: sqrtPNew };
}
