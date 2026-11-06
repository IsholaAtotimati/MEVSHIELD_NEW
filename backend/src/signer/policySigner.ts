import { Wallet } from "ethers";

import type { Policy } from "../policy/policy.js";
import {
  POLICY_TYPES,
  policyDomain,
  type PolicyDomainConfig,
} from "../policy/eip712.js";

export type SignerConfig = PolicyDomainConfig;

export async function signPolicy(
  wallet: Wallet,
  policy: Policy,
  config: SignerConfig
): Promise<string> {
  return wallet.signTypedData(policyDomain(config), POLICY_TYPES, {
    poolId: policy.poolId,
    trader: policy.trader,
    nonce: policy.nonce,
    expiry: policy.expiry,
    maxLoss: policy.maxLoss,
    maxFee: policy.maxFee,
    zeroForOne: policy.zeroForOne,
    amountSpecified: policy.amountSpecified,
    sqrtPriceLimitX96: policy.sqrtPriceLimitX96,
    minAmountOut: policy.minAmountOut
  });
}

/**
 * Retained for callers that need the field list to verify a signature.
 * @deprecated Import `POLICY_TYPES` from `../policy/eip712.js` instead.
 */
export function getPolicyTypes() {
  return POLICY_TYPES;
}
