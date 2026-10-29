import type { Hex } from "viem";

import { CONTRACTS } from "./contracts";
import { poolStateSlots } from "./protectedQuote";
import { sqrtPriceLimitNearTick, tickFromSlot0 } from "./tickPrice";
import { publicClient } from "./viem";

/** A limit 500 ticks from the live pool, inside the router's 600-tick cap. */
export async function routerSqrtPriceLimit(
  poolId: Hex,
  zeroForOne: boolean,
): Promise<string> {
  const slots = poolStateSlots(poolId);
  const slot0 = await publicClient.getStorageAt({
    address: CONTRACTS.poolManager,
    slot: slots.slot0,
  });
  const tick = tickFromSlot0(BigInt(slot0 ?? "0x0"));
  return sqrtPriceLimitNearTick(tick, zeroForOne).toString();
}

/** One sentence for the status line. The full viem dump stays in the console. */
export function shortChainError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const text = error.message;
  if (text.includes("PriceLimitTooFar")) {
    return "The price limit is more than 600 ticks from the pool. Sign a new policy, then execute again.";
  }
  if (text.includes("MinimumOutputNotMet")) {
    return "The swap output was below the signed minimum, so the router reverted and no tokens moved.";
  }
  if (text.includes("InvalidPriceLimit")) {
    return "The price limit is on the wrong side of the current pool price. Sign a new policy, then execute again.";
  }
  const first = text.split("\n")[0] ?? fallback;
  return first.length > 220 ? `${first.slice(0, 217)}...` : first;
}
