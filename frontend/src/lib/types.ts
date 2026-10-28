import type { Hex } from "viem";

import type { TokenSymbol } from "../config/swapPool";

export type DeploymentStatus = {
  poolManager: `0x${string}` | null;
  authorization: `0x${string}` | null;
  registry: `0x${string}` | null;
  registryOwner: `0x${string}` | null;
  authorizedConsumer: `0x${string}` | null;
  verifier: `0x${string}` | null;
  authorizedSigner: `0x${string}` | null;
};

export type PolicyResponse = {
  policy: {
    poolId: string;
    trader: string;
    nonce: string;
    expiry: string;
    maxLoss: string;
    maxFee: string;
    zeroForOne: boolean;
    amountSpecified: string;
    sqrtPriceLimitX96: string;
    minAmountOut: string;
  };
  estimatedLoss: string;
  estimatedFee: string;
  riskLevel: string;
  signature: string;
  policyId: string;
  requestId: string;
  demoMode?: boolean;
  txHash?: Hex;
  registered?: boolean;
};

export type RiskPreviewResult = {
  estimatedLoss: string;
  estimatedFee: string;
  maxLoss: string;
  maxFee: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  model: string;
  disclaimer: string;
  requestedAmount: string;
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  zeroForOne: boolean;
};

export type ExecutionResponse = {
  txHash: Hex;
  blockNumber: number;
  policyId: string;
  payer: string;
  router: string;
  recipient: string;
};

export type BackendHealth = {
  status: string;
  service?: string;
  chainId?: number;
  policySigningEnabled?: boolean;
  localDemoMode?: boolean;
  sepoliaMonitor?: string;
};

export type ActivityRow = {
  id: string;
  time: number;
  pair: string;
  amountIn: string;
  amountOut: string;
  minAmountOut: string;
  status: "registered" | "executed" | "reverted" | "failed" | "enforced";
  txHash?: Hex;
  policyId?: Hex;
};
