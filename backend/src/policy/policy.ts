export interface Policy {
  poolId: string;
  trader: string;
  nonce: bigint;
  expiry: bigint;
  maxLoss: bigint;
  maxFee: bigint;
  zeroForOne: boolean;
  amountSpecified: bigint;
  sqrtPriceLimitX96: bigint;
}
