import { z } from "zod";

export const PolicyRequestSchema = z.object({
  poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.string(),
  expiry: z.string(),
  amountSpecified: z.string(),
  zeroForOne: z.boolean(),
  sqrtPriceLimitX96: z.string(),
  minAmountOut: z.string().regex(/^[1-9]\d*$/),
}).strict();
