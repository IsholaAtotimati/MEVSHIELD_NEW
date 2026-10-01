import { Wallet } from "ethers";
import type { Policy } from "../policy/policy.js";

export interface SignerConfig {
  chainId: number;
  verifyingContract: string;
}

const TYPES = {
  Policy: [
    { name: "poolId", type: "bytes32" },
    { name: "trader", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "maxLoss", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "zeroForOne", type: "bool" },
    { name: "amountSpecified", type: "int256" },
    { name: "sqrtPriceLimitX96", type: "uint160" }
  ]
};

export async function signPolicy(
  wallet: Wallet,
  policy: Policy,
  config: SignerConfig
): Promise<string> {
  const domain = {
    name: "MEVShield",
    version: "1",
    chainId: config.chainId,
    verifyingContract: config.verifyingContract
  };

  return wallet.signTypedData(domain, TYPES, {
    poolId: policy.poolId,
    trader: policy.trader,
    nonce: policy.nonce,
    expiry: policy.expiry,
    maxLoss: policy.maxLoss,
    maxFee: policy.maxFee,
    zeroForOne: policy.zeroForOne,
    amountSpecified: policy.amountSpecified,
    sqrtPriceLimitX96: policy.sqrtPriceLimitX96
  });
}

export function getPolicyTypes() {
  return TYPES;
}
