import type { PolicyResponse } from "./types";

export type ExpectedPolicyFields = {
  poolId: string;
  trader: string;
  nonce: string;
  expiry: string;
  amountSpecified: string;
  zeroForOne: boolean;
  sqrtPriceLimitX96: string;
  minAmountOut: string;
};

export function expectedFieldsFromRequest(input: ExpectedPolicyFields): ExpectedPolicyFields {
  return input;
}

export function policyResponseMatchesExpected(
  result: PolicyResponse,
  expected: ExpectedPolicyFields,
): string | null {
  const p = result.policy;
  if (p.poolId.toLowerCase() !== expected.poolId.toLowerCase()) {
    return "Backend policy pool ID did not match the verified protected pool.";
  }
  if (p.trader.toLowerCase() !== expected.trader.toLowerCase()) {
    return "Backend policy trader did not match the router address.";
  }
  if (p.nonce !== expected.nonce) {
    return "Backend policy nonce did not match the request.";
  }
  if (p.expiry !== expected.expiry) {
    return "Backend policy expiry did not match the request.";
  }
  if (p.amountSpecified !== expected.amountSpecified) {
    return "Backend policy amount did not match the swap input.";
  }
  if (p.zeroForOne !== expected.zeroForOne) {
    return "Backend policy direction did not match the swap.";
  }
  if (p.sqrtPriceLimitX96 !== expected.sqrtPriceLimitX96) {
    return "Backend policy price limit did not match the request.";
  }
  if (p.minAmountOut !== expected.minAmountOut) {
    return "Backend policy minimum output differs from the fresh quote and selected slippage.";
  }
  return null;
}
