import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";

import {
  BACKEND_URL,
  MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
  SEPOLIA_DEMO_MODE,
} from "../config/env";
import {
  MIN_SQRT_PRICE_LIMIT_X96,
  MAX_SQRT_PRICE_LIMIT_X96,
  SWAP_POOL_ID,
  SWAP_POOL_KEY,
  SWAP_TOKENS,
  type TokenSymbol,
} from "../config/swapPool";
import { parsePolicyResponseBody, parseRiskPreviewBody, apiErrorMessage } from "../lib/apiValidation";
import { CONTRACTS } from "../lib/contracts";
import { policyAuthorizationAbi, policyRegistryAbi } from "../lib/abis";
import { shortAddress } from "../lib/format";
import {
  calculateMinimumOutput,
  calculatePoolId,
  calculateSwapReadiness,
  DEMO_MIN_AMOUNT_OUT,
  isFreshDemoPoolReadiness,
  type ProtectedQuote,
} from "../lib/protectedQuote";
import { createRequestId, logFrontend, safeError } from "../lib/observability";
import { readRegisteredPolicy } from "../lib/policyReads";
import { policyResponseMatchesExpected } from "../lib/policyMatch";
import { appendActivity } from "../lib/activityStorage";
import { reportTransactionEvent } from "../lib/telemetry";
import type { PolicyResponse, RiskPreviewResult } from "../lib/types";
import { getWalletClient, publicClient } from "../lib/viem";

type UsePolicyArgs = {
  account: Address | null;
  setAccount: (address: Address) => void;
  ensureSepolia: () => Promise<void>;
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  inputAmountBaseUnits: bigint | null;
  zeroForOne: boolean | null;
  slippageBps: number;
  protectedQuote: ProtectedQuote;
  quoteIsFresh: boolean;
  demoEstimateReady: boolean;
  quoteClockMs: number;
  backendPoolKeyVerified: boolean;
  protocolAddressesVerified: boolean;
  authorizationVerified: boolean;
  deployment: {
    authorizedConsumer: Address | null;
    authorization: Address | null;
  };
  onPolicyCleared?: () => void;
};

export function usePolicy(args: UsePolicyArgs) {
  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [policyId, setPolicyId] = useState<Hex | "">("");
  const [policyStatus, setPolicyStatus] = useState("No policy loaded.");
  const [policyRequestId, setPolicyRequestId] = useState("");
  const [isCreatingPolicy, setIsCreatingPolicy] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isPreviewingRisk, setIsPreviewingRisk] = useState(false);
  const [riskPreview, setRiskPreview] = useState<RiskPreviewResult | null>(null);
  const [actionStatus, setActionStatus] = useState(
    "Ready to calculate swap risk.",
  );

  const clearPolicyState = useCallback(() => {
    setPolicy(null);
    setPolicyId("");
    args.onPolicyCleared?.();
  }, [args]);

  const previewRisk = useCallback(async () => {
    const {
      inputAmountBaseUnits,
      zeroForOne,
      inputToken,
      outputToken,
    } = args;

    if (
      inputAmountBaseUnits === null ||
      inputAmountBaseUnits <= 0n ||
      zeroForOne === null
    ) {
      setRiskPreview(null);
      setActionStatus(
        "Enter a positive amount and select a supported token pair.",
      );
      return;
    }

    const requestedAmount = inputAmountBaseUnits.toString();
    const requestedInputToken = inputToken;
    const requestedOutputToken = outputToken;
    const requestedDirection = zeroForOne;

    setIsPreviewingRisk(true);
    setRiskPreview(null);
    setActionStatus("Calculating deterministic MVP risk estimate...");

    try {
      const response = await fetch(`${BACKEND_URL}/risk-preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountSpecified: requestedAmount,
          zeroForOne: requestedDirection,
        }),
      });

      const body: unknown = await response.json();

      if (!response.ok) {
        throw new Error(apiErrorMessage(body, "Risk preview failed"));
      }

      const parsed = parseRiskPreviewBody(body);
      if (!parsed) {
        throw new Error("Risk preview response failed validation.");
      }

      setRiskPreview({
        ...parsed,
        requestedAmount,
        inputToken: requestedInputToken,
        outputToken: requestedOutputToken,
        zeroForOne: requestedDirection,
      });

      setActionStatus(
        "Risk preview complete. This is a deterministic MVP estimate, not live market analysis.",
      );
    } catch (error) {
      setActionStatus(`Risk preview failed: ${safeError(error).errorMessage}`);
    } finally {
      setIsPreviewingRisk(false);
    }
  }, [args]);

  const loadPolicyById = useCallback(async (id: Hex) => {
    try {
      const { policy: chainPolicy, consumed } = await readRegisteredPolicy(id);

      setPolicyStatus(
        `Trader ${shortAddress(chainPolicy.trader)} · Nonce ${chainPolicy.nonce} · Max Loss ${chainPolicy.maxLoss.toString()} · Max Fee ${chainPolicy.maxFee.toString()} · Minimum Output ${chainPolicy.minAmountOut.toString()} · ${consumed ? "CONSUMED" : "ACTIVE"}`,
      );
    } catch (error) {
      console.error(error);
      setPolicyStatus("Policy not found or invalid policy ID.");
    }
  }, []);

  const loadPolicy = useCallback(async () => {
    if (!policyId) {
      setPolicyStatus("Enter a policy ID first.");
      return;
    }
    setIsInspecting(true);
    try {
      await loadPolicyById(policyId);
    } finally {
      setIsInspecting(false);
    }
  }, [loadPolicyById, policyId]);

  const createPolicy = useCallback(async () => {
    const {
      zeroForOne,
      inputAmountBaseUnits,
      inputToken,
      outputToken,
      protectedQuote,
      quoteIsFresh,
      demoEstimateReady,
      slippageBps,
      deployment,
      setAccount,
      ensureSepolia,
      quoteClockMs,
      backendPoolKeyVerified,
      protocolAddressesVerified,
      authorizationVerified,
    } = args;

    const swapReadiness = calculateSwapReadiness({
      amountInBaseUnits: inputAmountBaseUnits,
      quote: protectedQuote,
      nowMs: quoteClockMs,
      poolId: SWAP_POOL_ID,
      poolKeyMatches: zeroForOne !== null,
      backendPoolKeyVerified,
      protocolAddressesVerified,
      minimumOutputProtocolVerified: MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
      authorizationVerified,
      policyBoundsVerified: false,
      demoMode: SEPOLIA_DEMO_MODE,
      demoEstimateAvailable: demoEstimateReady,
    });

    if (!swapReadiness.canCheckRisk || zeroForOne === null) {
      setActionStatus(
        SEPOLIA_DEMO_MODE
          ? "Demo policy creation requires the local backend and verified Sepolia deployment checks."
          : "Risk checking is unavailable until a fresh quote for the verified protected pool and matching backend configuration exist.",
      );
      return;
    }

    setIsCreatingPolicy(true);
    clearPolicyState();
    const requestId = createRequestId();
    setPolicyRequestId(requestId);
    const amountBaseUnits = inputAmountBaseUnits;
    const amountSpecified =
      amountBaseUnits === null ? null : -amountBaseUnits;
    const sqrtPriceLimitX96 = (
      zeroForOne ? MIN_SQRT_PRICE_LIMIT_X96 : MAX_SQRT_PRICE_LIMIT_X96
    ).toString();

    logFrontend("swap_started", {
      requestId,
      trader: CONTRACTS.mevShieldRouter,
      amount: amountSpecified?.toString(),
    });
    setActionStatus(
      SEPOLIA_DEMO_MODE
        ? "Creating a demo policy with a 1-base-unit minimum output..."
        : "Calculating risk and requesting policy...",
    );

    let registrationTxHash: Hex | undefined;
    try {
      if (
        amountBaseUnits === null ||
        amountBaseUnits <= 0n ||
        amountSpecified === null
      ) {
        throw new Error(
          `Enter a valid positive ${SWAP_TOKENS[inputToken].poolSymbol} amount with at most ${SWAP_TOKENS[inputToken].decimals} decimal places.`,
        );
      }
      if (
        !SEPOLIA_DEMO_MODE &&
        (protectedQuote.status !== "available" || !quoteIsFresh)
      ) {
        throw new Error(
          "A genuine fresh protected-pool quote is required before policy signing.",
        );
      }
      if (
        SEPOLIA_DEMO_MODE &&
        (!demoEstimateReady ||
          !isFreshDemoPoolReadiness(protectedQuote, Date.now()))
      ) {
        throw new Error(
          "A fresh initialized and liquid protected-pool check and a valid demo estimate are required.",
        );
      }
      const minAmountOut = SEPOLIA_DEMO_MODE
        ? DEMO_MIN_AMOUNT_OUT
        : protectedQuote.status === "available"
          ? calculateMinimumOutput(
              protectedQuote.amountOutBaseUnits,
              slippageBps,
            )
          : null;
      if (minAmountOut === null) {
        throw new Error(
          "Slippage tolerance or quoted minimum output is invalid.",
        );
      }

      const walletClient = getWalletClient();
      const [connectedAccount] = await walletClient.requestAddresses();
      if (!connectedAccount) {
        throw new Error("Connect a wallet to register the policy.");
      }
      setAccount(connectedAccount);

      if (calculatePoolId(SWAP_POOL_KEY) !== SWAP_POOL_ID) {
        throw new Error(
          "Configured pool ID does not match the pool key and hook. Swap stopped to avoid a failing, high-gas transaction.",
        );
      }

      if (
        deployment.authorizedConsumer?.toLowerCase() !==
        deployment.authorization?.toLowerCase()
      ) {
        throw new Error(
          "The existing pool authorization is not enabled for this registry consumer.",
        );
      }

      await ensureSepolia();

      const expiry = Math.floor(Date.now() / 1000) + 3600;
      const nonce = Date.now().toString();

      const response = await fetch(`${BACKEND_URL}/policy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          poolId: SWAP_POOL_ID,
          trader: CONTRACTS.mevShieldRouter,
          nonce,
          expiry: expiry.toString(),
          amountSpecified: amountSpecified.toString(),
          zeroForOne,
          sqrtPriceLimitX96,
          minAmountOut: minAmountOut.toString(),
        }),
      });

      const data: unknown = await response.json();
      const responseRequestId =
        response.headers.get("x-request-id") ?? requestId;
      const result = parsePolicyResponseBody(data);
      logFrontend("policy_response", {
        requestId,
        httpStatus: response.status,
        nonce: result?.policy?.nonce,
        policyHash: result?.policyId,
        riskLevel: result?.riskLevel,
      });

      if (!response.ok) {
        throw new Error(apiErrorMessage(data, "Policy request failed"));
      }
      if (!result) {
        throw new Error("Policy response failed validation.");
      }
      if (SEPOLIA_DEMO_MODE && result.demoMode !== true) {
        throw new Error(
          "The local backend is not running with Sepolia demo policy signing enabled.",
        );
      }

      const expected = {
        poolId: SWAP_POOL_ID,
        trader: CONTRACTS.mevShieldRouter,
        nonce,
        expiry: expiry.toString(),
        amountSpecified: amountSpecified.toString(),
        zeroForOne,
        sqrtPriceLimitX96,
        minAmountOut: minAmountOut.toString(),
      };
      const mismatch = policyResponseMatchesExpected(result, expected);
      if (mismatch) {
        throw new Error(mismatch);
      }

      if (responseRequestId !== requestId) {
        throw new Error("Backend request ID did not match this swap.");
      }
      result.requestId = requestId;

      setActionStatus("Approve the policy registration in your wallet...");

      registrationTxHash = await walletClient.writeContract({
        address: CONTRACTS.policyAuthorization,
        abi: policyAuthorizationAbi,
        functionName: "registerPolicy",
        args: [
          {
            poolId: result.policy.poolId as Hex,
            trader: result.policy.trader as Address,
            nonce: BigInt(result.policy.nonce),
            expiry: BigInt(result.policy.expiry),
            maxLoss: BigInt(result.policy.maxLoss),
            maxFee: BigInt(result.policy.maxFee),
            zeroForOne: result.policy.zeroForOne,
            amountSpecified: BigInt(result.policy.amountSpecified),
            sqrtPriceLimitX96: BigInt(result.policy.sqrtPriceLimitX96),
            minAmountOut: BigInt(result.policy.minAmountOut),
          },
          result.signature as Hex,
        ],
        account: connectedAccount,
      });
      logFrontend("transaction_submitted", {
        requestId,
        txHash: registrationTxHash,
        transactionType: "policy_registration",
      });
      await reportTransactionEvent(requestId, "policy_registration_submitted", {
        txHash: registrationTxHash,
        nonce: result.policy.nonce,
      });

      setActionStatus("Waiting for policy registration confirmation...");
      const registrationReceipt = await publicClient.waitForTransactionReceipt({
        hash: registrationTxHash,
      });
      logFrontend("transaction_confirmed", {
        requestId,
        txHash: registrationTxHash,
        blockNumber: registrationReceipt.blockNumber.toString(),
        status: registrationReceipt.status,
        gasUsed: registrationReceipt.gasUsed.toString(),
        transactionType: "policy_registration",
      });
      if (registrationReceipt.status !== "success") {
        throw new Error("Policy registration transaction failed.");
      }

      const registered = await publicClient.readContract({
        address: CONTRACTS.policyRegistry,
        abi: policyRegistryAbi,
        functionName: "isRegistered",
        args: [result.policy.trader as Address, BigInt(result.policy.nonce)],
      });

      if (!registered) {
        throw new Error("Policy registration was not confirmed on-chain.");
      }

      setPolicy({
        ...result,
        requestId,
        txHash: registrationTxHash,
        registered,
      });
      setPolicyId(result.policyId as Hex);
      appendActivity({
        id: `${registrationTxHash}-reg`,
        time: Date.now(),
        pair: `${SWAP_TOKENS[inputToken].poolSymbol} / ${SWAP_TOKENS[outputToken].poolSymbol}`,
        amountIn: amountBaseUnits.toString(),
        amountOut: "—",
        minAmountOut: result.policy.minAmountOut,
        status: "registered",
        txHash: registrationTxHash,
        policyId: result.policyId as Hex,
      });
      setActionStatus("Policy signed and registered on-chain.");
    } catch (error) {
      console.error(error);
      logFrontend("transaction_failed", {
        requestId,
        txHash: registrationTxHash,
        ...safeError(error),
        transactionType: "policy_registration",
      });
      await reportTransactionEvent(requestId, "policy_registration_failed", {
        txHash: registrationTxHash,
        error,
      });
      setActionStatus(
        error instanceof Error ? error.message : "Could not create policy.",
      );
    } finally {
      setIsCreatingPolicy(false);
    }
  }, [args, clearPolicyState]);

  return {
    policy,
    setPolicy,
    policyId,
    setPolicyId,
    policyStatus,
    policyRequestId,
    isCreatingPolicy,
    isInspecting,
    isPreviewingRisk,
    riskPreview,
    setRiskPreview,
    actionStatus,
    setActionStatus,
    previewRisk,
    createPolicy,
    loadPolicy,
    loadPolicyById,
    clearPolicyState,
  };
}
