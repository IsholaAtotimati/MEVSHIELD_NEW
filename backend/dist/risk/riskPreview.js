import { z } from "zod";
import { calculateRisk } from "./riskEngine.js";
export const RiskPreviewRequestSchema = z.object({
    amountSpecified: z.string().regex(/^-?\d{1,78}$/),
    zeroForOne: z.boolean(),
});
export function previewRisk(input) {
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
            disclaimer: "Formula-based estimates only. Not a live market-risk measurement or a prediction of sandwich-attack probability.",
        },
    };
}
