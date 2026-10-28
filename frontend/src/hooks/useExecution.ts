import { useCallback, useState } from "react";
import type { Address, Hex } from "viem";
import { encodeAbiParameters } from "viem";

import { SEPOLIA_DEMO_MODE } from "../config/env";
import {
  MIN_SQRT_PRICE_LIMIT_X96,
  MAX_SQRT_PRICE_LIMIT_X96,
  SWAP_POOL_ID,
  SWAP_POOL_KEY,
  SWAP_TOKENS,
  type TokenSymbol,
} from "../config/swapPool";
import { CONTRACTS } from "../lib/contracts";
import { erc20Abi, mevShieldRouterAbi } from "../lib/abis";
import {
  calculateMinimumOutput,
  DEMO_MIN_AMOUNT_OUT,
  isFreshDemoPoolReadiness,
  type ProtectedQuote,
  type SwapReadiness,
} from "../lib/protectedQuote";
import { logFrontend, safeError } from "../lib/observability";
import { appendActivity } from "../lib/activityStorage";
import { reportTransactionEvent } from "../lib/telemetry";
import type { ExecutionResponse, PolicyResponse } from "../lib/types";
import { getWalletClient, publicClient } from "../lib/viem";

type UseExecutionArgs = {
  account: Address | null;
  setAccount: (address: Address) => void;
  ensureSepolia: () => Promise<void>;
  refreshBalance: (address: Address) => Promise<void>;
  refreshInputBalance: (address?: Address | null) => Promise<void>;
  inputToken: TokenSymbol;
  inputAmountBaseUnits: bigint | null;
  zeroForOne: boolean | null;
  slippageBps: number;
  protectedQuote: ProtectedQuote;
  quoteIsFresh: boolean;
  demoEstimateReady: boolean;
  swapReadiness: SwapReadiness;
  policy: PolicyResponse | null;
  policyRequestId: string;
  loadPolicyById: (id: Hex) => Promise<void>;
  setActionStatus: (message: string) => void;
};

export function useExecution(args: UseExecutionArgs) {
  const [execution, setExecution] = useState<ExecutionResponse | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const executeProtectedSwap = useCallback(async () => {
    const {
      swapReadiness,
      zeroForOne,
      policy,
      inputAmountBaseUnits,
      inputToken,
      protectedQuote,
      quoteIsFresh,
      demoEstimateReady,
      slippageBps,
      policyRequestId,
      setAccount,
      ensureSepolia,
      refreshBalance,
      refreshInputBalance,
      loadPolicyById,
      setActionStatus,
    } = args;

    if (!swapReadiness.canExecute || zeroForOne === null) {
      setActionStatus(
        "Protected execution is unavailable until the protected quote, policy bounds, backend configuration, and on-chain checks are verified.",
      );
      return;
    }
    if (!policy) {
      setActionStatus("Create a policy before executing the swap.");
      return;
    }

    const requestId = policy.requestId || policyRequestId;
    const amountBaseUnits = inputAmountBaseUnits;
    const amountSpecified =
      amountBaseUnits === null ? null : -amountBaseUnits;
    const sqrtPriceLimitX96 = (
      zeroForOne ? MIN_SQRT_PRICE_LIMIT_X96 : MAX_SQRT_PRICE_LIMIT_X96
    ).toString();

    logFrontend("protected_swap_execution_started", {
      requestId,
      trader: CONTRACTS.mevShieldRouter,
      amount: amountSpecified?.toString(),
      policyHash: policy.policyId,
    });
    setIsExecuting(true);
    setExecution(null);
    setActionStatus("Executing protected swap...");

    try {
      const walletClient = getWalletClient();
      const [payer] = await walletClient.requestAddresses();
      if (!payer) {
        throw new Error("Connect a wallet before executing the swap.");
      }
      await ensureSepolia();
      setAccount(payer);

      if (
        amountBaseUnits === null ||
        amountBaseUnits <= 0n ||
        amountSpecified === null
      ) {
        throw new Error(
          `Enter a valid positive ${SWAP_TOKENS[inputToken].poolSymbol} amount before execution.`,
        );
      }
      const requiredMinimumOutput = SEPOLIA_DEMO_MODE
        ? DEMO_MIN_AMOUNT_OUT
        : protectedQuote.status === "available"
          ? calculateMinimumOutput(
              protectedQuote.amountOutBaseUnits,
              slippageBps,
            )
          : null;
      if (
        policy.policy.poolId !== SWAP_POOL_ID ||
        policy.policy.trader.toLowerCase() !==
          CONTRACTS.mevShieldRouter.toLowerCase() ||
        policy.policy.amountSpecified !== amountSpecified.toString() ||
        policy.policy.zeroForOne !== zeroForOne ||
        requiredMinimumOutput === null ||
        policy.policy.minAmountOut !== requiredMinimumOutput.toString() ||
        (!SEPOLIA_DEMO_MODE &&
          (protectedQuote.status !== "available" || !quoteIsFresh)) ||
        (SEPOLIA_DEMO_MODE &&
          (!demoEstimateReady ||
            !isFreshDemoPoolReadiness(protectedQuote, Date.now())))
      ) {
        throw new Error(
          SEPOLIA_DEMO_MODE
            ? "The registered demo policy does not match the selected pair, direction, amount, or 1-unit minimum. Request a new policy."
            : "The registered policy does not match the selected pair, direction, and amount. Request a new policy.",
        );
      }

      const amountIn = amountBaseUnits;
      const inputTokenAddress = SWAP_TOKENS[inputToken].address;

      const inputBalance = await publicClient.readContract({
        address: inputTokenAddress,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [payer],
      });

      if (inputBalance < amountIn) {
        throw new Error(
          "Insufficient input-token balance. Fund the connected wallet with the selected pool's input token before executing.",
        );
      }

      const allowance = await publicClient.readContract({
        address: inputTokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [payer, CONTRACTS.mevShieldRouter],
      });

      if (allowance < amountIn) {
        setActionStatus(
          "Approve the input token in your wallet; you pay the approval gas.",
        );
        const approvalHash = await walletClient.writeContract({
          address: inputTokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.mevShieldRouter, amountIn],
          account: payer,
        });
        logFrontend("transaction_submitted", {
          requestId,
          txHash: approvalHash,
          transactionType: "token_approval",
        });
        const approvalReceipt = await publicClient.waitForTransactionReceipt({
          hash: approvalHash,
        });
        if (approvalReceipt.status !== "success") {
          throw new Error("Input-token approval transaction failed.");
        }
      }

      const hookData = encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { name: "poolId", type: "bytes32" },
              { name: "trader", type: "address" },
              { name: "nonce", type: "uint256" },
              { name: "expiry", type: "uint256" },
              { name: "maxLoss", type: "uint256" },
              { name: "maxFee", type: "uint256" },
              { name: "zeroForOne", type: "bool" },
              { name: "amountSpecified", type: "int256" },
              { name: "sqrtPriceLimitX96", type: "uint160" },
              { name: "minAmountOut", type: "uint256" },
            ],
          },
          { type: "bytes" },
          { type: "uint256" },
          { type: "uint256" },
        ],
        [
          {
            poolId: policy.policy.poolId as Hex,
            trader: policy.policy.trader as Address,
            nonce: BigInt(policy.policy.nonce),
            expiry: BigInt(policy.policy.expiry),
            maxLoss: BigInt(policy.policy.maxLoss),
            maxFee: BigInt(policy.policy.maxFee),
            zeroForOne: policy.policy.zeroForOne,
            amountSpecified: BigInt(policy.policy.amountSpecified),
            sqrtPriceLimitX96: BigInt(policy.policy.sqrtPriceLimitX96),
            minAmountOut: BigInt(policy.policy.minAmountOut),
          },
          policy.signature as Hex,
          BigInt(policy.estimatedLoss),
          BigInt(policy.estimatedFee),
        ],
      );

      setActionStatus(
        "Estimating the protected swap before requesting wallet confirmation...",
      );
      const swapArgs = [
        SWAP_POOL_KEY,
        {
          zeroForOne,
          amountSpecified,
          sqrtPriceLimitX96: BigInt(sqrtPriceLimitX96),
        },
        hookData,
        payer,
      ] as const;

      const estimatedGas = await publicClient.estimateContractGas({
        address: CONTRACTS.mevShieldRouter,
        abi: mevShieldRouterAbi,
        functionName: "executeSwap",
        args: swapArgs,
        account: payer,
      });
      const gasLimit = estimatedGas + estimatedGas / 5n;
      setActionStatus(
        `Estimated swap gas: ${estimatedGas.toString()}. Confirm in your wallet; your wallet pays gas.`,
      );

      const txHash = await walletClient.writeContract({
        address: CONTRACTS.mevShieldRouter,
        abi: mevShieldRouterAbi,
        functionName: "executeSwap",
        args: swapArgs,
        gas: gasLimit,
        account: payer,
      });

      logFrontend("transaction_submitted", {
        requestId,
        txHash,
        transactionType: "protected_swap",
      });
      await reportTransactionEvent(requestId, "swap_submitted", {
        txHash,
        nonce: policy.policy.nonce,
      });

      setActionStatus("Waiting for swap confirmation...");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash,
      });
      if (receipt.status !== "success") {
        throw new Error("Protected swap transaction failed.");
      }

      const result: ExecutionResponse = {
        txHash,
        blockNumber: Number(receipt.blockNumber),
        policyId: policy.policyId,
        payer,
        router: CONTRACTS.mevShieldRouter,
        recipient: payer,
      };

      setExecution(result);
      appendActivity({
        id: `${txHash}-exec`,
        time: Date.now(),
        pair: `${SWAP_TOKENS[inputToken].poolSymbol} / USDC`,
        amountIn: amountIn.toString(),
        amountOut: "—",
        minAmountOut: policy.policy.minAmountOut,
        status: "executed",
        txHash,
        policyId: policy.policyId as Hex,
      });
      setActionStatus(
        "Protected swap executed successfully; your wallet paid the transaction gas.",
      );

      await loadPolicyById(result.policyId as Hex);
      await refreshBalance(payer);
      await refreshInputBalance(payer);
    } catch (error) {
      console.error(error);
      logFrontend("transaction_failed", {
        requestId,
        ...safeError(error),
        transactionType: "protected_swap",
      });
      await reportTransactionEvent(requestId, "swap_failed", {
        error,
        nonce: policy.policy.nonce,
      });
      setActionStatus(
        error instanceof Error ? error.message : "Protected swap failed.",
      );
    } finally {
      setIsExecuting(false);
    }
  }, [args]);

  return {
    execution,
    setExecution,
    isExecuting,
    executeProtectedSwap,
  };
}
