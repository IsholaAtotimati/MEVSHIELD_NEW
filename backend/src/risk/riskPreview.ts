import { z } from "zod";
import { calculateRisk } from "./riskEngine.js";

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
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  model: "deterministic-mvp";
  disclaimer: string;
};

export function previewRisk(
  input: RiskPreviewRequest,
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
  });

  return {
    ok: true,
    data: {
      estimatedLoss: result.estimatedLoss.toString(),
      estimatedFee: result.estimatedFee.toString(),
      maxLoss: result.maxLoss.toString(),
      maxFee: result.maxFee.toString(),
      riskLevel: result.riskLevel,
      model: "deterministic-mvp",
      disclaimer:
        "Formula-based estimates only. Not a live market-risk measurement or a prediction of sandwich-attack probability.",
    },
  };
}
