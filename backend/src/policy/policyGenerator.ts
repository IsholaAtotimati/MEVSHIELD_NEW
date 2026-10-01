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
}

export function generatePolicy(request: PolicyRequest): {
  policy: Policy;
  actualLoss: bigint;
  actualFee: bigint;
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
    sqrtPriceLimitX96: request.sqrtPriceLimitX96
  };

  return {
    policy,
    actualLoss: risk.actualLoss,
    actualFee: risk.actualFee,
    riskLevel: risk.riskLevel
  };
}
