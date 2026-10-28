import { useCallback, useEffect, useState } from "react";

import { BACKEND_URL } from "../config/env";
import { isLocalBackendUrl, SEPOLIA_DEMO_MODE } from "../config/env";
import {
  SWAP_POOL_EXPECTATION,
  SWAP_POOL_ID,
} from "../config/swapPool";
import { CONTRACTS } from "../lib/contracts";
import { mevShieldHookAbi } from "../lib/abis";
import {
  decodePoolState,
  isFreshQuote,
  loadProtectedPoolQuote,
  matchesBackendProtectedPoolConfig,
  poolManagerStateAbi,
  poolStateSlots,
  type ProtectedPoolSnapshot,
  type ProtectedQuote,
} from "../lib/protectedQuote";
import { publicClient } from "../lib/viem";

export function useProtectedQuote() {
  const [protectedQuote, setProtectedQuote] = useState<ProtectedQuote>({
    status: "unavailable",
    reason: "not-checked",
  });
  const [quoteClockMs, setQuoteClockMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [backendPoolKeyVerified, setBackendPoolKeyVerified] = useState(false);

  const demoBackendIsLocal =
    !SEPOLIA_DEMO_MODE || isLocalBackendUrl(BACKEND_URL);

  const inspectProtectedPool = useCallback(async () => {
    const quote = await loadProtectedPoolQuote(async () => {
      const slots = poolStateSlots(SWAP_POOL_ID);
      const blockNumber = await publicClient.getBlockNumber();
      const [
        chainId,
        managerCode,
        hookCode,
        hookPoolManager,
        hookAuthorization,
        slot0,
        liquidity,
      ] = await Promise.all([
        publicClient.getChainId(),
        publicClient.getCode({ address: CONTRACTS.poolManager, blockNumber }),
        publicClient.getCode({ address: CONTRACTS.mevShieldHook, blockNumber }),
        publicClient.readContract({
          address: CONTRACTS.mevShieldHook,
          abi: mevShieldHookAbi,
          functionName: "poolManager",
          blockNumber,
        }),
        publicClient.readContract({
          address: CONTRACTS.mevShieldHook,
          abi: mevShieldHookAbi,
          functionName: "authorization",
          blockNumber,
        }),
        publicClient.readContract({
          address: CONTRACTS.poolManager,
          abi: poolManagerStateAbi,
          functionName: "extsload",
          args: [slots.slot0],
          blockNumber,
        }),
        publicClient.readContract({
          address: CONTRACTS.poolManager,
          abi: poolManagerStateAbi,
          functionName: "extsload",
          args: [slots.liquidity],
          blockNumber,
        }),
      ]);
      const poolState = decodePoolState(slot0, liquidity);
      const snapshot: ProtectedPoolSnapshot = {
        chainId,
        poolManager: hookPoolManager,
        hook: CONTRACTS.mevShieldHook,
        hookPoolManager,
        hookAuthorization,
        poolManagerHasCode: Boolean(managerCode && managerCode !== "0x"),
        hookHasCode: Boolean(hookCode && hookCode !== "0x"),
        poolId: SWAP_POOL_ID,
        ...poolState,
        observedAtMs: Date.now(),
      };
      return snapshot;
    }, SWAP_POOL_EXPECTATION);
    setProtectedQuote(quote);
    setQuoteClockMs(Date.now());
  }, []);

  const verifyBackendPoolConfiguration = useCallback(async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/config/protected-pool`);
      if (!response.ok) {
        setBackendPoolKeyVerified(false);
        return;
      }
      const config: unknown = await response.json();
      setBackendPoolKeyVerified(
        matchesBackendProtectedPoolConfig(config, SWAP_POOL_EXPECTATION),
      );
    } catch {
      setBackendPoolKeyVerified(false);
    }
  }, []);

  useEffect(() => {
    void inspectProtectedPool();
    void verifyBackendPoolConfiguration();
    const poolInterval = window.setInterval(() => {
      void inspectProtectedPool();
      void verifyBackendPoolConfiguration();
    }, 10_000);
    const clockInterval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      window.clearInterval(poolInterval);
      window.clearInterval(clockInterval);
    };
  }, [inspectProtectedPool, verifyBackendPoolConfiguration]);

  const quoteAgeSeconds =
    quoteClockMs > 0 ? Math.max(0, Math.floor((nowMs - quoteClockMs) / 1000)) : null;

  return {
    protectedQuote,
    setProtectedQuote,
    quoteClockMs,
    setQuoteClockMs,
    nowMs,
    quoteAgeSeconds,
    backendPoolKeyVerified:
      backendPoolKeyVerified && demoBackendIsLocal,
    inspectProtectedPool,
    verifyBackendPoolConfiguration,
    isQuoteFresh: (
      amountBaseUnits: bigint | null,
    ) =>
      isFreshQuote(
        protectedQuote,
        quoteClockMs,
        amountBaseUnits,
        SWAP_POOL_ID,
      ),
  };
}
