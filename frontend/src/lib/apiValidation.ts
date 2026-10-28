import type { PolicyResponse, RiskPreviewResult } from "./types";

const DECIMAL_STRING = /^\d+$/;

function isRiskLevel(
  value: unknown,
): value is RiskPreviewResult["riskLevel"] {
  return value === "LOW" || value === "MEDIUM" || value === "HIGH";
}

export function parseRiskPreviewBody(body: unknown): RiskPreviewResult | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (
    typeof record.estimatedLoss !== "string" ||
    !DECIMAL_STRING.test(record.estimatedLoss) ||
    typeof record.estimatedFee !== "string" ||
    !DECIMAL_STRING.test(record.estimatedFee) ||
    typeof record.maxLoss !== "string" ||
    !DECIMAL_STRING.test(record.maxLoss) ||
    typeof record.maxFee !== "string" ||
    !DECIMAL_STRING.test(record.maxFee) ||
    !isRiskLevel(record.riskLevel) ||
    typeof record.model !== "string" ||
    typeof record.disclaimer !== "string"
  ) {
    return null;
  }
  return {
    estimatedLoss: record.estimatedLoss,
    estimatedFee: record.estimatedFee,
    maxLoss: record.maxLoss,
    maxFee: record.maxFee,
    riskLevel: record.riskLevel,
    model: record.model,
    disclaimer: record.disclaimer,
    requestedAmount: "",
    inputToken: "ETH",
    outputToken: "USDC",
    zeroForOne: false,
  };
}

export function parsePolicyResponseBody(body: unknown): PolicyResponse | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const policy = record.policy;
  if (!policy || typeof policy !== "object") return null;
  const p = policy as Record<string, unknown>;
  const stringFields = [
    "poolId",
    "trader",
    "nonce",
    "expiry",
    "maxLoss",
    "maxFee",
    "amountSpecified",
    "sqrtPriceLimitX96",
    "minAmountOut",
  ] as const;
  for (const key of stringFields) {
    if (typeof p[key] !== "string") return null;
  }
  if (typeof p.zeroForOne !== "boolean") return null;
  for (const key of ["estimatedLoss", "estimatedFee", "signature", "policyId"] as const) {
    if (typeof record[key] !== "string") return null;
  }
  if (
    !DECIMAL_STRING.test(p.maxLoss as string) ||
    !DECIMAL_STRING.test(p.maxFee as string) ||
    !DECIMAL_STRING.test(p.minAmountOut as string)
  ) {
    return null;
  }
  return {
    policy: {
      poolId: p.poolId as string,
      trader: p.trader as string,
      nonce: p.nonce as string,
      expiry: p.expiry as string,
      maxLoss: p.maxLoss as string,
      maxFee: p.maxFee as string,
      zeroForOne: p.zeroForOne as boolean,
      amountSpecified: p.amountSpecified as string,
      sqrtPriceLimitX96: p.sqrtPriceLimitX96 as string,
      minAmountOut: p.minAmountOut as string,
    },
    estimatedLoss: record.estimatedLoss as string,
    estimatedFee: record.estimatedFee as string,
    riskLevel:
      typeof record.riskLevel === "string" ? record.riskLevel : "LOW",
    signature: record.signature as string,
    policyId: record.policyId as string,
    requestId:
      typeof record.requestId === "string" ? record.requestId : "",
    demoMode: record.demoMode === true,
  };
}
