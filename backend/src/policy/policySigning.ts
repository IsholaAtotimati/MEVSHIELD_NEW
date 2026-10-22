import type { Wallet } from "ethers";
import {
  assertConfiguredPoolId,
  type ProtectedPoolConfig,
} from "../config/runtimeConfig.js";
import type { Policy } from "./policy.js";
import { signPolicy } from "../signer/policySigner.js";

export type PolicySigner = typeof signPolicy;

export async function signProtectedPolicy(
  wallet: Wallet,
  policy: Policy,
  config: {
    chainId: number;
    verifierAddress: string;
    protectedPool: ProtectedPoolConfig;
  },
  signer: PolicySigner = signPolicy,
): Promise<string> {
  assertConfiguredPoolId(policy.poolId, config.protectedPool);
  return signer(wallet, policy, {
    chainId: config.chainId,
    verifyingContract: config.verifierAddress,
  });
}
