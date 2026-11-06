import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  DEMO_ESTIMATE_MODE,
  MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
  READ_ONLY_DEMO_MODE,
  SEPOLIA_DEMO_MODE,
} from "../config/env";
import {
  SWAP_POOL_CONFIGURATION,
  SWAP_POOL_ID,
  SWAP_TOKENS,
  type TokenSymbol,
} from "../config/swapPool";
import { useBackendHealth } from "../hooks/useBackendHealth";
import { useExecution } from "../hooks/useExecution";
import { usePolicy } from "../hooks/usePolicy";
import { useProtectedQuote } from "../hooks/useProtectedQuote";
import { useProtocol } from "../hooks/useProtocol";
import { useTokenBalance } from "../hooks/useTokenBalance";
import { useTokenAllowance } from "../hooks/useTokenAllowance";
import { useWallet } from "../hooks/useWallet";
import {
  calculateDemoOutput,
  calculateSwapReadiness,
  getZeroForOne,
  isFreshDemoPoolReadiness,
  parseTokenAmount,
  type SwapReadiness,
} from "../lib/protectedQuote";
import { isDecimalString, isPositiveDecimalString } from "../lib/apiValidation";
import { CONTRACTS } from "../lib/contracts";
import { getPolicyExecutionIssues } from "../lib/policyExecutionReadiness";
import type { PolicyResponse } from "../lib/types";

type TradeContextValue = ReturnType<typeof useTradeState>;

const TradeContext = createContext<TradeContextValue | null>(null);

function hasValidPolicyBounds(
  policy: PolicyResponse | null,
  nowMs: number,
): boolean {
  return Boolean(
    policy?.registered &&
      isDecimalString(policy.policy.maxLoss) &&
      isDecimalString(policy.policy.maxFee) &&
      isPositiveDecimalString(policy.policy.minAmountOut) &&
      /^\d+$/.test(policy.policy.expiry) &&
      BigInt(policy.policy.expiry) > BigInt(Math.floor(nowMs / 1000)),
  );
}

function useTradeState() {
  const wallet = useWallet();
  const protocol = useProtocol();
  const quoteHook = useProtectedQuote();
  const backend = useBackendHealth();

  const [inputToken, setInputToken] = useState<TokenSymbol>("ETH");
  const [outputToken, setOutputToken] = useState<TokenSymbol>("USDC");
  const [inputAmount, setInputAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [clearExecutionTick, setClearExecutionTick] = useState(0);

  /**
   * Pool identity, narrowed once here. When the local build has no token
   * addresses, `SWAP_TOKENS[*].address` is `null`, the direction cannot be
   * resolved, and the readiness gate reports the configuration error.
   */
  const inputTokenAddress = SWAP_TOKENS[inputToken].address;
  const outputTokenAddress = SWAP_TOKENS[outputToken].address;

  const inputTokenBalance = useTokenBalance(wallet.account, inputTokenAddress);

  const inputAmountBaseUnits = parseTokenAmount(
    inputAmount,
    SWAP_TOKENS[inputToken].decimals,
  );
  const zeroForOne =
    SWAP_POOL_CONFIGURATION.status === "configured" &&
    inputTokenAddress !== null &&
    outputTokenAddress !== null
      ? getZeroForOne(
          inputTokenAddress,
          outputTokenAddress,
          SWAP_POOL_CONFIGURATION.poolKey,
        )
      : null;
  const quoteIsFresh = quoteHook.isQuoteFresh(
    inputAmountBaseUnits,
    zeroForOne,
  );
  const demoEstimateBaseUnits =
    DEMO_ESTIMATE_MODE && inputAmountBaseUnits !== null && zeroForOne !== null
      ? calculateDemoOutput(inputAmountBaseUnits, zeroForOne)
      : null;
  const demoEstimateReady =
    demoEstimateBaseUnits !== null &&
    isFreshDemoPoolReadiness(quoteHook.protectedQuote, quoteHook.quoteClockMs);

  useEffect(() => {
    if (
      DEMO_ESTIMATE_MODE ||
      inputAmountBaseUnits === null ||
      inputAmountBaseUnits <= 0n ||
      zeroForOne === null
    ) {
      return;
    }
    const request = () =>
      void quoteHook.refreshLiveQuote(
        inputAmountBaseUnits,
        zeroForOne,
        slippageBps,
      );
    const debounce = window.setTimeout(request, 250);
    const refresh = window.setInterval(request, 8_000);
    return () => {
      window.clearTimeout(debounce);
      window.clearInterval(refresh);
    };
  }, [
    inputAmountBaseUnits,
    quoteHook.refreshLiveQuote,
    slippageBps,
    zeroForOne,
  ]);

  const policyHook = usePolicy({
    account: wallet.account,
    setAccount: wallet.setAccount,
    ensureSepolia: wallet.ensureSepolia,
    inputToken,
    outputToken,
    inputAmountBaseUnits,
    zeroForOne,
    slippageBps,
    protectedQuote: quoteHook.protectedQuote,
    poolSnapshot: quoteHook.poolSnapshot,
    quoteIsFresh,
    demoEstimateReady,
    quoteClockMs: quoteHook.quoteClockMs,
    refreshLiveQuote: quoteHook.refreshLiveQuote,
    backendPoolKeyVerified: quoteHook.backendPoolKeyVerified,
    protocolAddressesVerified: protocol.protocolAddressesVerified,
    authorizationVerified: protocol.hasAuthorization,
    deployment: protocol.deployment,
    onPolicyCleared: () => setClearExecutionTick((value) => value + 1),
  });

  const tokenAllowance = useTokenAllowance(
    wallet.account,
    inputTokenAddress,
    CONTRACTS.mevShieldRouter,
    policyHook.policy?.registered === true,
  );
  const policyExecutionReasons = getPolicyExecutionIssues({
    policy: policyHook.policy,
    nowMs: quoteHook.nowMs,
    poolId: SWAP_POOL_ID,
    account: wallet.account,
    amountInBaseUnits: inputAmountBaseUnits,
    zeroForOne,
    quote: quoteHook.protectedQuote,
    quoteIsFresh,
    allowance: tokenAllowance.allowance,
    allowanceIsChecking: tokenAllowance.isChecking,
    allowanceError: tokenAllowance.error,
  });
  const policyBoundsVerified =
    hasValidPolicyBounds(policyHook.policy, quoteHook.nowMs) &&
    policyExecutionReasons.length === 0;

  /**
   * Readiness for a configured pool. `null` when the local build has no token
   * addresses; that case takes the unconfigured branch below instead.
   */
  const baseSwapReadiness =
    SWAP_POOL_CONFIGURATION.status !== "configured"
      ? null
      : calculateSwapReadiness({
          amountInBaseUnits: inputAmountBaseUnits,
          quote: quoteHook.protectedQuote,
          nowMs: quoteHook.nowMs,
          zeroForOne,
          poolId: SWAP_POOL_CONFIGURATION.poolId,
          poolKeyMatches: zeroForOne !== null,
          backendPoolKeyVerified: quoteHook.backendPoolKeyVerified,
          protocolAddressesVerified: protocol.protocolAddressesVerified,
          minimumOutputProtocolVerified: MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
          authorizationVerified: protocol.hasAuthorization,
          policyBoundsVerified,
          demoMode: DEMO_ESTIMATE_MODE,
          demoEstimateAvailable: demoEstimateReady,
          readOnlyDemo: READ_ONLY_DEMO_MODE,
        });

  /**
   * An unconfigured pool is a configuration error, not a market condition, so it
   * is reported first and blocks both risk checking and execution.
   *
   * Composed here rather than inside `calculateSwapReadiness` so the readiness
   * rules in `lib/protectedQuote.ts` keep taking only already-resolved values,
   * which is what their tests assert.
   */
  const swapReadiness: SwapReadiness =
    SWAP_POOL_CONFIGURATION.status === "configured" &&
    baseSwapReadiness !== null
      ? baseSwapReadiness
      : {
          canCheckRisk: false,
          canExecute: false,
          executionReasons: baseSwapReadiness?.executionReasons ?? [],
          reasons: [
            ...(SWAP_POOL_CONFIGURATION.status === "unconfigured"
              ? [SWAP_POOL_CONFIGURATION.message]
              : []),
            ...(baseSwapReadiness?.reasons ?? []),
          ],
        };
  if (policyHook.policy?.registered) {
    swapReadiness.executionReasons = [
      ...swapReadiness.reasons,
      ...policyExecutionReasons,
    ];
  }
  if (quoteHook.backendConfigError) {
    swapReadiness.reasons.push(quoteHook.backendConfigError);
    if (policyHook.policy?.registered) {
      swapReadiness.executionReasons.push(quoteHook.backendConfigError);
    }
  }
  if (backend.healthState === "failed" && backend.healthError) {
    swapReadiness.reasons.push(backend.healthError);
    if (policyHook.policy?.registered) {
      swapReadiness.executionReasons.push(backend.healthError);
    }
  } else if (backend.healthState === "checking") {
    swapReadiness.reasons.push("Checking backend availability.");
  }
  if (
    backend.healthState === "ok" &&
    backend.health?.policySigningEnabled !== true
  ) {
    swapReadiness.reasons.push("Backend policy signing is disabled.");
  }
  if (!protocol.protocolAddressesVerified) {
    swapReadiness.reasons.push(
      protocol.protocolStatus === "Checking protocol..."
        ? "Checking Deployment B contract wiring on Sepolia."
        : protocol.protocolStatus === "Protocol connected"
          ? "Deployment B contract wiring does not match the configured addresses."
          : protocol.protocolStatus,
    );
  }
  if (quoteHook.quoteError && !quoteIsFresh) {
    const reason = `Live quote unavailable: ${quoteHook.quoteError}`;
    swapReadiness.reasons.push(reason);
    if (policyHook.policy?.registered) {
      swapReadiness.executionReasons.push(reason);
    }
  }

  const executionHook = useExecution({
    account: wallet.account,
    setAccount: wallet.setAccount,
    ensureSepolia: wallet.ensureSepolia,
    refreshBalance: wallet.refreshBalance,
    refreshInputBalance: inputTokenBalance.refresh,
    inputToken,
    inputAmountBaseUnits,
    zeroForOne,
    slippageBps,
    protectedQuote: quoteHook.protectedQuote,
    quoteIsFresh,
    demoEstimateReady,
    swapReadiness,
    policy: policyHook.policy,
    policyRequestId: policyHook.policyRequestId,
    loadPolicyById: policyHook.loadPolicyById,
    setActionStatus: policyHook.setActionStatus,
  });

  useEffect(() => {
    if (clearExecutionTick > 0) {
      executionHook.setExecution(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear execution when policy resets
  }, [clearExecutionTick]);

  const resetSwapFlow = useCallback(() => {
    policyHook.clearPolicyState();
    executionHook.setExecution(null);
    policyHook.setRiskPreview(null);
  }, [policyHook, executionHook]);

  const onInputAmountChange = useCallback(
    (value: string) => {
      setInputAmount(value);
      resetSwapFlow();
      policyHook.setActionStatus(
        SEPOLIA_DEMO_MODE
          ? "Input changed. Recheck protection before signing a demo policy."
          : "Input changed. Refresh the quote and check protection again.",
      );
    },
    [policyHook, resetSwapFlow],
  );

  const switchSwapDirection = useCallback(() => {
    setInputToken(outputToken);
    setOutputToken(inputToken);
    setInputAmount("");
    resetSwapFlow();
    policyHook.setActionStatus(
      SEPOLIA_DEMO_MODE
        ? "Direction changed. Recheck protection before signing a demo policy."
        : "Direction changed. Refresh the quote and check protection again.",
    );
  }, [inputToken, outputToken, policyHook, resetSwapFlow]);

  const routeDirection =
    zeroForOne === null
      ? "Unsupported token pair"
      : `${SWAP_TOKENS[inputToken].poolSymbol} → ${SWAP_TOKENS[outputToken].poolSymbol}`;

  return {
    wallet,
    protocol,
    backend,
    quote: quoteHook,
    policy: policyHook,
    execution: executionHook,
    inputToken,
    outputToken,
    setInputToken,
    setOutputToken,
    inputAmount,
    slippageBps,
    setSlippageBps,
    inputAmountBaseUnits,
    inputTokenBalance: inputTokenBalance.balance,
    tokenAllowance,
    refreshInputTokenBalance: inputTokenBalance.refresh,
    zeroForOne,
    quoteIsFresh,
    demoEstimateBaseUnits,
    demoEstimateReady,
    swapReadiness,
    routeDirection,
    onInputAmountChange,
    switchSwapDirection,
    resetSwapFlow,
  };
}

export function TradeProvider({ children }: { children: ReactNode }) {
  const value = useTradeState();
  return (
    <TradeContext.Provider value={value}>{children}</TradeContext.Provider>
  );
}

export function useTrade(): TradeContextValue {
  const ctx = useContext(TradeContext);
  if (!ctx) {
    throw new Error("useTrade must be used within TradeProvider");
  }
  return ctx;
}
