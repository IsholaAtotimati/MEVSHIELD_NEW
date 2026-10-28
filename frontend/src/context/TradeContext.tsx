import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED, SEPOLIA_DEMO_MODE } from "../config/env";
import {
  SWAP_POOL_ID,
  SWAP_POOL_KEY,
  SWAP_TOKENS,
  type TokenSymbol,
} from "../config/swapPool";
import { useBackendHealth } from "../hooks/useBackendHealth";
import { useExecution } from "../hooks/useExecution";
import { usePolicy } from "../hooks/usePolicy";
import { useProtectedQuote } from "../hooks/useProtectedQuote";
import { useProtocol } from "../hooks/useProtocol";
import { useTokenBalance } from "../hooks/useTokenBalance";
import { useWallet } from "../hooks/useWallet";
import {
  calculateDemoOutput,
  calculateSwapReadiness,
  getZeroForOne,
  isFreshDemoPoolReadiness,
  parseTokenAmount,
} from "../lib/protectedQuote";
import type { PolicyResponse } from "../lib/types";

type TradeContextValue = ReturnType<typeof useTradeState>;

const TradeContext = createContext<TradeContextValue | null>(null);

function hasValidPolicyBounds(policy: PolicyResponse | null): boolean {
  return Boolean(
    policy?.registered &&
      /^\d+$/.test(policy.policy.maxLoss) &&
      /^\d+$/.test(policy.policy.maxFee) &&
      /^[1-9]\d*$/.test(policy.policy.minAmountOut),
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

  const inputTokenBalance = useTokenBalance(
    wallet.account,
    SWAP_TOKENS[inputToken].address,
  );

  const inputAmountBaseUnits = parseTokenAmount(
    inputAmount,
    SWAP_TOKENS[inputToken].decimals,
  );
  const zeroForOne = getZeroForOne(
    SWAP_TOKENS[inputToken].address,
    SWAP_TOKENS[outputToken].address,
    SWAP_POOL_KEY,
  );
  const quoteIsFresh = quoteHook.isQuoteFresh(inputAmountBaseUnits);
  const demoEstimateBaseUnits =
    SEPOLIA_DEMO_MODE && inputAmountBaseUnits !== null && zeroForOne !== null
      ? calculateDemoOutput(inputAmountBaseUnits, zeroForOne)
      : null;
  const demoEstimateReady =
    demoEstimateBaseUnits !== null &&
    isFreshDemoPoolReadiness(quoteHook.protectedQuote, quoteHook.quoteClockMs);

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
    quoteIsFresh,
    demoEstimateReady,
    quoteClockMs: quoteHook.quoteClockMs,
    backendPoolKeyVerified: quoteHook.backendPoolKeyVerified,
    protocolAddressesVerified: protocol.protocolAddressesVerified,
    authorizationVerified: protocol.hasAuthorization,
    deployment: protocol.deployment,
    onPolicyCleared: () => setClearExecutionTick((value) => value + 1),
  });

  const policyBoundsVerified = hasValidPolicyBounds(policyHook.policy);

  const swapReadiness = calculateSwapReadiness({
    amountInBaseUnits: inputAmountBaseUnits,
    quote: quoteHook.protectedQuote,
    nowMs: quoteHook.quoteClockMs,
    poolId: SWAP_POOL_ID,
    poolKeyMatches: zeroForOne !== null,
    backendPoolKeyVerified: quoteHook.backendPoolKeyVerified,
    protocolAddressesVerified: protocol.protocolAddressesVerified,
    minimumOutputProtocolVerified: MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
    authorizationVerified: protocol.hasAuthorization,
    policyBoundsVerified,
    demoMode: SEPOLIA_DEMO_MODE,
    demoEstimateAvailable: demoEstimateReady,
  });

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
