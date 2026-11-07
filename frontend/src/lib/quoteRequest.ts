export type LiveQuoteRequest = {
  amountIn: string;
  zeroForOne: boolean;
  slippageBps: number;
};

export const MAX_SMALLER_QUOTE_ATTEMPTS = 12;

export function isInsufficientExecutableLiquidityError(message: string): boolean {
  return message.includes(
    "Insufficient executable liquidity before the configured price limit.",
  );
}

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

export function smallerQuoteCandidates(
  amountInBaseUnits: bigint,
  maxAttempts = MAX_SMALLER_QUOTE_ATTEMPTS,
): bigint[] {
  const candidates: bigint[] = [];
  let candidate = amountInBaseUnits;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    candidate /= 10n;
    if (candidate <= 0n) break;
    candidates.push(candidate);
  }

  return candidates;
}
