export type TradePrimaryStep = "check" | "sign" | "done";

type TradeActionReadinessInput = {
  primaryStep: TradePrimaryStep;
  inputAmountValid: boolean;
  directionValid: boolean;
  isBusy: boolean;
  readOnlyDemo: boolean;
  demoMode: boolean;
  canCheckRisk: boolean;
  readinessReasons: string[];
  backendHealthState: "checking" | "ok" | "failed";
  backendHealthError: string | null;
  backendPolicySigningEnabled: boolean;
  backendChainId: number | null;
  backendDemoMode: boolean;
  walletConnected: boolean;
  walletChainId: number | null;
  requiredChainId: number;
  policyRegistered: boolean;
  canExecute: boolean;
  executionReasons: string[];
};

export function resolveTradeActionReadiness(
  input: TradeActionReadinessInput,
) {
  const primaryReasons: string[] = [];
  if (!input.inputAmountValid) {
    primaryReasons.push("Enter a valid positive input amount.");
  }
  if (!input.directionValid) {
    primaryReasons.push("Select a supported token pair.");
  }
  if (input.isBusy) primaryReasons.push("Wait for the current action to finish.");
  if (input.backendHealthState === "checking") {
    primaryReasons.push("Checking backend availability.");
  } else if (input.backendHealthState === "failed") {
    primaryReasons.push(
      input.backendHealthError ??
        "Backend unavailable. Check VITE_API_URL, Railway health, and backend CORS.",
    );
  }
  if (
    input.backendHealthState === "ok" &&
    input.backendChainId !== input.requiredChainId
  ) {
    primaryReasons.push("Backend is not configured for Sepolia chain 11155111.");
  }
  if (
    input.backendHealthState === "ok" &&
    input.backendDemoMode
  ) {
    primaryReasons.push("Backend demo mode is enabled; use the genuine Deployment B backend.");
  }
  if (input.primaryStep === "sign") {
    if (input.readOnlyDemo) {
      primaryReasons.push("Policy signing is disabled in read-only demo mode.");
    }
    if (input.demoMode) {
      primaryReasons.push("Demo policy signing is disabled for protected tester execution.");
    }
    if (!input.canCheckRisk) primaryReasons.push(...input.readinessReasons);
    if (
      input.backendHealthState === "ok" &&
      !input.backendPolicySigningEnabled
    ) {
      primaryReasons.push("Backend policy signing is disabled.");
    }
    if (!input.walletConnected) {
      primaryReasons.push("Connect your wallet before signing.");
    } else if (input.walletChainId !== input.requiredChainId) {
      primaryReasons.push("Switch your wallet to Sepolia before signing.");
    }
  }
  if (input.primaryStep === "done") {
    primaryReasons.push("Policy already registered. Use Execute protected swap.");
  }

  const executionReasons = [...input.executionReasons];
  if (input.readOnlyDemo) {
    executionReasons.push("Swap execution is disabled in read-only demo mode.");
  }
  if (input.demoMode) {
    executionReasons.push("Demo mode cannot execute protected swaps.");
  }
  if (
    input.backendHealthState === "ok" &&
    input.backendChainId !== input.requiredChainId
  ) {
    executionReasons.push("Backend is not configured for Sepolia chain 11155111.");
  }
  if (input.backendHealthState === "ok" && input.backendDemoMode) {
    executionReasons.push("Backend demo mode is enabled; protected execution is blocked.");
  }
  if (!input.policyRegistered) {
    executionReasons.push("Policy registration is not confirmed on-chain.");
  }
  if (!input.canExecute && executionReasons.length === 0) {
    executionReasons.push("Protected execution checks are not complete.");
  }
  if (!input.walletConnected) {
    executionReasons.push("Connect your wallet before executing.");
  } else if (input.walletChainId !== input.requiredChainId) {
    executionReasons.push("Switch your wallet to Sepolia before executing.");
  }
  if (input.isBusy) {
    executionReasons.push("Wait for the current action to finish.");
  }

  return {
    primaryDisabled: primaryReasons.length > 0,
    primaryReasons: [...new Set(primaryReasons)],
    executionDisabled: executionReasons.length > 0,
    executionReasons: [...new Set(executionReasons)],
  };
}
