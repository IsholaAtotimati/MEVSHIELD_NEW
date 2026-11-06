/**
 * On-chain reads for a single registered policy.
 *
 * Single responsibility: fetch a policy from PolicyRegistry together with the
 * consumed flag, which is the pair every caller needs. It does not format the
 * result — callers keep their own status wording and units.
 *
 * Consumers: `hooks/usePolicy.ts` (`loadPolicyById`, refreshed after a swap) and
 * `pages/PoliciesPage.tsx` (the "Inspect by policy ID" form). Both previously
 * issued the same `getPolicy` + `isConsumed` pair inline.
 */
import type { Address, Hex } from "viem";

import { policyRegistryAbi } from "./abis";
import { CONTRACTS } from "./contracts";
import { publicClient } from "./viem";

/**
 * Mirrors the `Policy` tuple returned by `PolicyRegistry.getPolicy`. Note this
 * is the registry's stored subset: it has no `zeroForOne`,
 * `amountSpecified`, or `sqrtPriceLimitX96`, because those are not persisted.
 */
export type RegisteredPolicy = {
  poolId: Hex;
  trader: Address;
  nonce: bigint;
  expiry: bigint;
  maxLoss: bigint;
  maxFee: bigint;
  minAmountOut: bigint;
};

export type RegisteredPolicyState = {
  policy: RegisteredPolicy;
  consumed: boolean;
};

export async function readRegisteredPolicy(
  id: Hex,
): Promise<RegisteredPolicyState> {
  const policy = await publicClient.readContract({
    address: CONTRACTS.policyRegistry,
    abi: policyRegistryAbi,
    functionName: "getPolicy",
    args: [id],
  });

  // `isConsumed` is keyed by trader + nonce, so it must follow the policy read.
  const consumed = await publicClient.readContract({
    address: CONTRACTS.policyRegistry,
    abi: policyRegistryAbi,
    functionName: "isConsumed",
    args: [policy.trader, policy.nonce],
  });

  return { policy, consumed };
}
