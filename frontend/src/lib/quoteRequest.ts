export type LiveQuoteRequest = {
  amountIn: string;
  zeroForOne: boolean;
  slippageBps: number;
};

export function buildLiveQuoteRequest(
  amountInBaseUnits: bigint,
  zeroForOne: boolean,
  slippageBps: number,
): LiveQuoteRequest {
  return {
    amountIn: amountInBaseUnits.toString(),
    zeroForOne,
    slippageBps,
  };
}
