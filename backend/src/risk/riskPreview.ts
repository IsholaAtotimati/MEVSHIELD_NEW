import { z } from "zod";
import type { ActivePoolState } from "./poolState.js";
import { calculateRisk, type RiskLevel } from "./riskEngine.js";

export const RISK_MODEL = "active-liquidity-impact" as const;
export const RISK_PREVIEW_DISCLAIMER =
  "Estimates price impact from the current pool state for this trade size. It does not read the mempool or detect sandwich attacks.";

export const RiskPreviewRequestSchema = z.object({
  amountSpecified: z.string().regex(/^-?\d{1,78}$/),
  zeroForOne: z.boolean(),
});

export type RiskPreviewRequest = z.infer<typeof RiskPreviewRequestSchema>;

export type RiskPreviewResponse = {
  estimatedLoss: string;
  estimatedFee: string;
  maxLoss: string;
  maxFee: string;
  riskLevel: RiskLevel;
  model: typeof RISK_MODEL;
  disclaimer: string;
};

export function previewRisk(
  input: RiskPreviewRequest,
  pool: ActivePoolState,
):
  | { ok: true; data: RiskPreviewResponse }
  | { ok: false; error: string } {
  const amountSpecified = BigInt(input.amountSpecified);

  if (amountSpecified === 0n) {
    return { ok: false, error: "amountSpecified must not be zero" };
  }

  const result = calculateRisk({
    amountSpecified,
    zeroForOne: input.zeroForOne,
    sqrtPriceX96: pool.sqrtPriceX96,
    liquidity: pool.liquidity,
    feePips: pool.feePips,
  });

  return {
    ok: true,
    data: {
      estimatedLoss: result.estimatedLoss.toString(),
      estimatedFee: result.estimatedFee.toString(),
      maxLoss: result.maxLoss.toString(),
      maxFee: result.maxFee.toString(),
      riskLevel: result.riskLevel,
      model: RISK_MODEL,
      disclaimer: RISK_PREVIEW_DISCLAIMER,
    },
  };
}
