export function hasSufficientAllowance(
  allowance: bigint | null,
  amountIn: bigint | null,
): boolean {
  return allowance !== null &&
    amountIn !== null &&
    amountIn > 0n &&
    allowance >= amountIn;
}
