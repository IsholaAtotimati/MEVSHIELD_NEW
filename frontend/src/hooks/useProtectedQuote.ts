import { useCallback, useEffect, useRef, useState } from "react";

import { BACKEND_URL } from "../config/env";
import { isLocalBackendUrl, SEPOLIA_DEMO_MODE } from "../config/env";
import {
  SWAP_POOL_CONFIGURATION,
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
import {
  apiErrorMessage,
  parseLiveProtectedQuoteBody,
} from "../lib/apiValidation";
import { buildLiveQuoteRequest } from "../lib/quoteRequest";

export function useProtectedQuote() {
  const [protectedQuote, setProtectedQuote] = useState<ProtectedQuote>({
    status: "unavailable",
    reason: "not-checked",
  });
  const [poolSnapshot, setPoolSnapshot] = useState<ProtectedPoolSnapshot | null>(null);
  const [quoteClockMs, setQuoteClockMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [backendPoolKeyVerified, setBackendPoolKeyVerified] = useState(false);
  const [backendConfigError, setBackendConfigError] = useState<string | null>(null);
  const [isRefreshingQuote, setIsRefreshingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const quoteRequestSequence = useRef(0);
  const lastUnavailableQuoteKey = useRef<string | null>(null);

  const demoBackendIsLocal =
    !SEPOLIA_DEMO_MODE || isLocalBackendUrl(BACKEND_URL);

  const inspectProtectedPool = useCallback(async () => {
    // An unconfigured local build has no pool to inspect. Report "not checked"
    // rather than reading from a placeholder address; the readiness gate turns
    // the unconfigured state into an explicit reason.
    if (SWAP_POOL_ID === null || SWAP_POOL_EXPECTATION === null) {
      setProtectedQuote({ status: "unavailable", reason: "not-checked" });
      setPoolSnapshot(null);
      setQuoteClockMs(Date.now());
      return;
    }
    const poolId = SWAP_POOL_ID;

    let observedSnapshot: ProtectedPoolSnapshot | null = null;
    const quote = await loadProtectedPoolQuote(async () => {
      const slots = poolStateSlots(poolId);
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
        poolId,
        ...poolState,
        observedAtMs: Date.now(),
      };
      observedSnapshot = snapshot;
      return snapshot;
    }, SWAP_POOL_EXPECTATION);
    setProtectedQuote((current) => {
      const directionallyQuoteable =
        quote.status === "unavailable" &&
        (quote.reason === "quote-simulation-unavailable" ||
          quote.reason === "zero-active-liquidity");
      return current.status === "available" &&
        directionallyQuoteable &&
        isFreshQuote(current, Date.now(), undefined, poolId)
        ? current
        : quote;
    });
    setPoolSnapshot(observedSnapshot);
    setQuoteClockMs(Date.now());
  }, []);

  const refreshLiveQuote = useCallback(
    async (
      amountInBaseUnits: bigint,
      zeroForOne: boolean,
      slippageBps: number,
      force?: boolean,
    ): Promise<ProtectedQuote | null> => {
      if (SWAP_POOL_ID === null || amountInBaseUnits <= 0n) return null;
      const requestBody = buildLiveQuoteRequest(
        amountInBaseUnits,
        zeroForOne,
        slippageBps,
      );
      const requestKey = JSON.stringify(requestBody);
      if (!BACKEND_URL) {
        setQuoteError(
          "VITE_API_URL is not configured for this production frontend build.",
        );
        setProtectedQuote({
          status: "unavailable",
          reason: "quote-simulation-unavailable",
        });
        return null;
      }
      if (lastUnavailableQuoteKey.current === requestKey && !force) return null;
      if (force) lastUnavailableQuoteKey.current = null;
      const requestSequence = ++quoteRequestSequence.current;
      setIsRefreshingQuote(true);
      setQuoteError(null);
      try {
        const response = await fetch(`${BACKEND_URL}/quote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
        });
        const body: unknown = await response.json();
        if (!response.ok) {
          if (response.status === 422) {
            lastUnavailableQuoteKey.current = requestKey;
          }
          throw new Error(apiErrorMessage(body, "Live quote failed."));
        }
        const result = parseLiveProtectedQuoteBody(body);
        if (!result) {
          throw new Error("Live quote response failed validation.");
        }
        const receivedAtMs = Date.now();
        const expiresAtMs = Date.parse(result.expiresAt);
        if (
          result.poolId.toLowerCase() !== SWAP_POOL_ID.toLowerCase() ||
          result.zeroForOne !== zeroForOne ||
          result.amountSpecified !== (-amountInBaseUnits).toString() ||
          result.minAmountOut === "0" ||
          !Number.isFinite(expiresAtMs) ||
          receivedAtMs > expiresAtMs
        ) {
          throw new Error("Live quote does not match the requested swap or has expired.");
        }
        if (requestSequence !== quoteRequestSequence.current) return null;
        lastUnavailableQuoteKey.current = null;
        const freshQuote: ProtectedQuote = {
          status: "available",
          poolId: SWAP_POOL_ID,
          amountInBaseUnits,
          amountOutBaseUnits: BigInt(result.amountOut),
          minAmountOutBaseUnits: BigInt(result.minAmountOut),
          zeroForOne,
          priceImpactBps: result.priceImpactBps,
          sqrtPriceLimitX96: result.sqrtPriceLimitX96,
          quoteId: result.quoteId as `0x${string}`,
          blockNumber: result.blockNumber,
          blockTimestamp: result.blockTimestamp,
          expiresAtMs,
          quotedAtMs: receivedAtMs,
        };
        setProtectedQuote(freshQuote);
        setNowMs(receivedAtMs);
        setQuoteClockMs(receivedAtMs);
        return freshQuote;
      } catch (error) {
        if (requestSequence !== quoteRequestSequence.current) return null;
        setProtectedQuote({
          status: "unavailable",
          reason: "quote-simulation-unavailable",
        });
        setQuoteError(
          error instanceof Error ? error.message : "Live quote failed.",
        );
        return null;
      } finally {
        if (requestSequence === quoteRequestSequence.current) {
          setIsRefreshingQuote(false);
        }
      }
    },
    [],
  );

  const verifyBackendPoolConfiguration = useCallback(async () => {
    if (SWAP_POOL_EXPECTATION === null) {
      setBackendPoolKeyVerified(false);
      setBackendConfigError("Protected pool configuration is not configured.");
      return;
    }
    if (!BACKEND_URL) {
      setBackendPoolKeyVerified(false);
      setBackendConfigError(
        "VITE_API_URL is not configured for this production frontend build.",
      );
      return;
    }
    try {
      const response = await fetch(`${BACKEND_URL}/config/protected-pool`);
      if (!response.ok) {
        setBackendPoolKeyVerified(false);
        setBackendConfigError(
          `Backend protected-pool configuration returned HTTP ${response.status}.`,
        );
        return;
      }
      const config: unknown = await response.json();
      const verified = matchesBackendProtectedPoolConfig(config, SWAP_POOL_EXPECTATION);
      setBackendPoolKeyVerified(verified);
      setBackendConfigError(
        verified
          ? null
          : "Backend protected-pool configuration does not match the Deployment B pool.",
      );
    } catch {
      setBackendPoolKeyVerified(false);
      setBackendConfigError(
        "Backend unavailable while verifying protected-pool configuration.",
      );
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
    protectedQuote.status === "available"
      ? Math.max(0, Math.floor((nowMs - protectedQuote.quotedAtMs) / 1000))
      : quoteClockMs > 0
        ? Math.max(0, Math.floor((nowMs - quoteClockMs) / 1000))
        : null;

  return {
    protectedQuote,
    poolSnapshot,
    setProtectedQuote,
    refreshLiveQuote,
    quoteError,
    quoteClockMs,
    setQuoteClockMs,
    nowMs,
    quoteAgeSeconds,
    backendPoolKeyVerified:
      backendPoolKeyVerified && demoBackendIsLocal,
    backendConfigError,
    isRefreshingQuote,
    /**
     * False when the local build has no token addresses configured: there is no
     * pool key to compare a backend document against, so configuration cannot
     * be verified.
     */
    poolConfigurationConfigured:
      SWAP_POOL_CONFIGURATION.status === "configured",
    inspectProtectedPool,
    verifyBackendPoolConfiguration,
    isQuoteFresh: (
      amountBaseUnits: bigint | null,
      zeroForOne?: boolean | null,
    ) =>
      SWAP_POOL_ID !== null &&
      isFreshQuote(
        protectedQuote,
        nowMs,
        amountBaseUnits,
        SWAP_POOL_ID,
        zeroForOne,
      ),
  };
}
