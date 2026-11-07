import type { Address } from "viem";

import type { PolicyResponse } from "./types";
import type { ProtectedQuote } from "./protectedQuote";
import { hasSufficientAllowance } from "./allowance.ts";

type PolicyExecutionReadinessInput = {
  policy: PolicyResponse | null;
  nowMs: number;
  poolId: string | null;
  account: Address | null;
  amountInBaseUnits: bigint | null;
  zeroForOne: boolean | null;
  quote: ProtectedQuote;
  quoteIsFresh: boolean;
  allowance: bigint | null;
  allowanceIsChecking: boolean;
  allowanceError: string | null;
};

export function getPolicyExecutionIssues(
  input: PolicyExecutionReadinessInput,
): string[] {
  const policy = input.policy;
  if (!policy?.registered) return ["Policy registration is not confirmed on-chain."];

  const issues: string[] = [];
  const expiryIsValid = /^\d+$/.test(policy.policy.expiry);
  if (
    !expiryIsValid ||
    BigInt(policy.policy.expiry) <= BigInt(Math.floor(input.nowMs / 1000))
  ) {
    issues.push("Policy expired. Create and register a new policy.");
  }
  if (
    input.poolId === null ||
    policy.policy.poolId.toLowerCase() !== input.poolId.toLowerCase()
  ) {
    issues.push("Registered policy does not match the Deployment B pool.");
  }
  if (
    input.amountInBaseUnits === null ||
    policy.policy.amountSpecified !== (-input.amountInBaseUnits).toString()
  ) {
    issues.push("Registered policy does not match the input amount.");
  }
  if (policy.policy.zeroForOne !== input.zeroForOne) {
    issues.push("Registered policy does not match the swap direction.");
  }
  if (
    input.account &&
    policy.policy.trader.toLowerCase() !== input.account.toLowerCase()
  ) {
    issues.push("Connect the wallet that registered this policy.");
  }
  if (!input.quoteIsFresh || input.quote.status !== "available") {
    issues.push("A fresh protected-pool quote is required before execution.");
  } else {
    if (
      input.quote.poolId.toLowerCase() !== policy.policy.poolId.toLowerCase() ||
      input.quote.amountInBaseUnits !== input.amountInBaseUnits ||
      input.quote.zeroForOne !== input.zeroForOne
    ) {
      issues.push("Registered policy does not match the fresh quote parameters.");
    }
    if (
      policy.policy.minAmountOut !==
      input.quote.minAmountOutBaseUnits.toString()
    ) {
      issues.push("Registered policy minimum output does not match the fresh quote.");
    }
    if (
      policy.policy.sqrtPriceLimitX96 !== input.quote.sqrtPriceLimitX96
    ) {
      issues.push("Registered policy price limit does not match the fresh quote.");
    }
  }
  if (!input.account) {
    return issues;
  }
  if (input.allowanceIsChecking) {
    issues.push("Checking the input-token allowance on Sepolia.");
  } else if (input.allowanceError) {
    issues.push(input.allowanceError);
  } else if (input.allowance === null) {
    issues.push("Could not verify the input-token allowance on Sepolia.");
  } else if (
    !hasSufficientAllowance(input.allowance, input.amountInBaseUnits)
  ) {
    issues.push(
      "Input-token allowance is below the exact swap amount. Approve the token and create a fresh policy.",
    );
  }
  return issues;
}
