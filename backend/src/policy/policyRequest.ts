import { z } from "zod";

export const MIN_SQRT_PRICE_LIMIT_X96 = 4295128740n;
export const MAX_SQRT_PRICE_LIMIT_X96 =
  1461446703485210103287273052203988822378723970341n;
export const POLICY_MAX_TTL_SECONDS = 30 * 60;

const decimalIntPattern = /^-?\d{1,78}$/;
const unsignedDecimalPattern = /^\d{1,78}$/;
const nonZeroUintPattern = /^[1-9]\d{0,77}$/;

export const PolicyRequestSchema = z
  .object({
    poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
    trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
    nonce: z.string().regex(nonZeroUintPattern),
    expiry: z.string().regex(unsignedDecimalPattern),
    amountSpecified: z.string().regex(decimalIntPattern),
    zeroForOne: z.boolean(),
    sqrtPriceLimitX96: z.string().regex(unsignedDecimalPattern),
    minAmountOut: z.string().regex(nonZeroUintPattern),
  })
  .strict()
  .superRefine((data, ctx) => {
    let amountSpecified: bigint;
    try {
      amountSpecified = BigInt(data.amountSpecified);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "amountSpecified must be a valid integer string",
        path: ["amountSpecified"],
      });
      return;
    }

    if (amountSpecified === 0n) {
      ctx.addIssue({
        code: "custom",
        message: "amountSpecified must not be zero",
        path: ["amountSpecified"],
      });
    }

    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    let expiry: bigint;
    try {
      expiry = BigInt(data.expiry);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "expiry must be a valid integer string",
        path: ["expiry"],
      });
      return;
    }

    if (expiry <= nowSeconds) {
      ctx.addIssue({
        code: "custom",
        message: "expiry must be in the future",
        path: ["expiry"],
      });
    } else if (expiry > nowSeconds + BigInt(POLICY_MAX_TTL_SECONDS)) {
      ctx.addIssue({
        code: "custom",
        message: "expiry must be within 30 minutes",
        path: ["expiry"],
      });
    }

    let sqrtPriceLimitX96: bigint;
    try {
      sqrtPriceLimitX96 = BigInt(data.sqrtPriceLimitX96);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "sqrtPriceLimitX96 must be a valid integer string",
        path: ["sqrtPriceLimitX96"],
      });
      return;
    }

    if (
      sqrtPriceLimitX96 <= MIN_SQRT_PRICE_LIMIT_X96 ||
      sqrtPriceLimitX96 >= MAX_SQRT_PRICE_LIMIT_X96
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "sqrtPriceLimitX96 must be strictly between Uniswap v4 MIN_SQRT_PRICE and MAX_SQRT_PRICE",
        path: ["sqrtPriceLimitX96"],
      });
    }
  });
