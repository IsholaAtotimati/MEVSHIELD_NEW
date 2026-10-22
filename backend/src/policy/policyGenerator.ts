import { calculateRisk } from "../risk/riskEngine.js";
import type { Policy } from "./policy.js";

export interface PolicyRequest {
  poolId: string;
  trader: string;
  nonce: bigint;
  expiry: bigint;
  amountSpecified: bigint;
  zeroForOne: boolean;
  sqrtPriceLimitX96: bigint;
  minAmountOut: bigint;
}

export function generatePolicy(request: PolicyRequest): {
  policy: Policy;
  estimatedLoss: bigint;
  estimatedFee: bigint;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
} {
  const risk = calculateRisk({
    amountSpecified: request.amountSpecified,
    zeroForOne: request.zeroForOne
  });

  const policy: Policy = {
    poolId: request.poolId,
    trader: request.trader,
    nonce: request.nonce,
    expiry: request.expiry,
    maxLoss: risk.maxLoss,
    maxFee: risk.maxFee,
    zeroForOne: request.zeroForOne,
    amountSpecified: request.amountSpecified,
    sqrtPriceLimitX96: request.sqrtPriceLimitX96,
    minAmountOut: request.minAmountOut
  };

  return {
    policy,
    estimatedLoss: risk.estimatedLoss,
    estimatedFee: risk.estimatedFee,
    riskLevel: risk.riskLevel
  };
}
