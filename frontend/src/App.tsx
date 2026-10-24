import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import {
  encodeAbiParameters,
  formatEther,
  formatUnits,
} from "viem";

import {
  CONTRACTS,
  CHAIN_ID,
} from "./lib/contracts";

import {
  erc20Abi,
  mevShieldRouterAbi,
  mevShieldHookAbi,
  policyAuthorizationAbi,
  policyRegistryAbi,
  policyVerifierAbi,
} from "./lib/abis";

import {
  getWalletClient,
  publicClient,
} from "./lib/viem";
import {
  createRequestId,
  logFrontend,
  safeError,
} from "./lib/observability";
import {
  calculatePoolId,
  calculateDemoOutput,
  calculateMinimumOutput,
  calculateSwapReadiness,
  decodePoolState,
  getZeroForOne,
  isFreshDemoPoolReadiness,
  isFreshQuote,
  loadProtectedPoolQuote,
  matchesBackendProtectedPoolConfig,
  parseTokenAmount,
  poolManagerStateAbi,
  poolStateSlots,
  sortCurrencies,
  DEMO_MIN_AMOUNT_OUT,
  DEMO_USDC_PER_WETH,
  type PoolExpectation,
  type ProtectedPoolSnapshot,
  type ProtectedQuote,
} from "./lib/protectedQuote";

import "./App.css";
import Metric from "./components/Metric";
import AddressRow from "./components/AddressRow";
import SwapInputs from "./components/SwapInputs";

const BACKEND_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

type TokenSymbol = "ETH" | "USDC";

const SWAP_TOKENS: Record<
  TokenSymbol,
  { address: Address; decimals: number; poolSymbol: string; displayName: string }
> = {
  ETH: {
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    decimals: 18,
    poolSymbol: "WETH",
    displayName: "Sepolia test ETH (executes as WETH)",
  },
  USDC: {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    poolSymbol: "USDC",
    displayName: "Sepolia test USDC",
  },
};

const SWAP_POOL_KEY = {
  ...sortCurrencies(SWAP_TOKENS.ETH.address, SWAP_TOKENS.USDC.address),
  fee: 3000,
  tickSpacing: 60,
  hooks: CONTRACTS.mevShieldHook,
};

const SWAP_POOL_ID = calculatePoolId(SWAP_POOL_KEY);
const SWAP_POOL_EXPECTATION: PoolExpectation = {
  chainId: CHAIN_ID,
  poolManager: CONTRACTS.poolManager,
  hook: CONTRACTS.mevShieldHook,
  hookAuthorization: CONTRACTS.poolAuthorization,
  poolKey: SWAP_POOL_KEY,
  poolId: SWAP_POOL_ID,
};

const MIN_SQRT_PRICE_LIMIT_X96 = 4295128740n;
const MAX_SQRT_PRICE_LIMIT_X96 =
  1461446703485210103287273052203988822378723970341n;
const SEPOLIA_DEMO_MODE =
  import.meta.env.DEV && import.meta.env.VITE_SEPOLIA_DEMO_MODE === "true";
const MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED =
  import.meta.env.VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED === "true";

type DeploymentStatus = {
  poolManager: Address | null;
  authorization: Address | null;
  registry: Address | null;
  registryOwner: Address | null;
  authorizedConsumer: Address | null;
  verifier: Address | null;
  authorizedSigner: Address | null;
};

type PolicyResponse = {
  policy: {
    poolId: string;
    trader: string;
    nonce: string;
    expiry: string;
    maxLoss: string;
    maxFee: string;
    zeroForOne: boolean;
    amountSpecified: string;
    sqrtPriceLimitX96: string;
    minAmountOut: string;
  };
  estimatedLoss: string;
  estimatedFee: string;
  riskLevel: string;
  signature: string;
  policyId: string;
  requestId: string;
  demoMode?: boolean;
  txHash?: Hex;
  registered?: boolean;
};

type RiskPreviewResult = {
  estimatedLoss: string;
  estimatedFee: string;
  maxLoss: string;
  maxFee: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  model: string;
  disclaimer: string;
  requestedAmount: string;
  inputToken: TokenSymbol;
  outputToken: TokenSymbol;
  zeroForOne: boolean;
};

type ExecutionResponse = {
  txHash: Hex;
  blockNumber: number;
  policyId: string;
  payer: string;
  router: string;
  recipient: string;
};

function shortAddress(address?: string | null) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function isLocalBackendUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(value).hostname);
  } catch {
    return false;
  }
}

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<string>("—");
  const [status, setStatus] = useState("Checking protocol...");

  const [deployment, setDeployment] = useState<DeploymentStatus>({
    poolManager: null,
    authorization: null,
    registry: null,
    registryOwner: null,
    authorizedConsumer: null,
    verifier: null,
    authorizedSigner: null,
  });

  const [policyId, setPolicyId] = useState<Hex | "">("");
  const [policyStatus, setPolicyStatus] =
    useState<string>("No policy loaded.");

  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [policyRequestId, setPolicyRequestId] = useState("");
  const [execution, setExecution] =
    useState<ExecutionResponse | null>(null);

  const [isCreatingPolicy, setIsCreatingPolicy] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isPreviewingRisk, setIsPreviewingRisk] = useState(false);
  const [riskPreview, setRiskPreview] = useState<RiskPreviewResult | null>(null);

  const [actionStatus, setActionStatus] =
    useState("Ready to calculate swap risk.");

  const [inputToken, setInputToken] = useState<TokenSymbol>("ETH");
  const [outputToken, setOutputToken] = useState<TokenSymbol>("USDC");
  const [inputAmount, setInputAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(50);
  const [protectedQuote, setProtectedQuote] = useState<ProtectedQuote>({
    status: "unavailable",
    reason: "not-checked",
  });
  const [quoteClockMs, setQuoteClockMs] = useState(0);
  const [backendPoolKeyVerified, setBackendPoolKeyVerified] = useState(false);
  const inputAmountBaseUnits = parseTokenAmount(
    inputAmount,
    SWAP_TOKENS[inputToken].decimals,
  );
  const zeroForOne = getZeroForOne(
    SWAP_TOKENS[inputToken].address,
    SWAP_TOKENS[outputToken].address,
    SWAP_POOL_KEY,
  );
  const quoteIsFresh = isFreshQuote(
    protectedQuote,
    quoteClockMs,
    inputAmountBaseUnits,
    SWAP_POOL_ID,
  );
  const demoEstimateBaseUnits =
    SEPOLIA_DEMO_MODE && inputAmountBaseUnits !== null && zeroForOne !== null
      ? calculateDemoOutput(inputAmountBaseUnits, zeroForOne)
      : null;
  const demoEstimateReady =
    demoEstimateBaseUnits !== null &&
    isFreshDemoPoolReadiness(protectedQuote, quoteClockMs);
  const demoBackendIsLocal =
    !SEPOLIA_DEMO_MODE || isLocalBackendUrl(BACKEND_URL);
  const hasAuthorization = Boolean(
    deployment.authorization &&
      deployment.authorizedConsumer?.toLowerCase() ===
        deployment.authorization.toLowerCase(),
  );
  const protocolAddressesVerified = Boolean(
    deployment.poolManager?.toLowerCase() === CONTRACTS.poolManager.toLowerCase() &&
      deployment.authorization?.toLowerCase() === CONTRACTS.poolAuthorization.toLowerCase() &&
      deployment.registry?.toLowerCase() === CONTRACTS.policyRegistry.toLowerCase() &&
      deployment.verifier?.toLowerCase() === CONTRACTS.policyVerifier.toLowerCase() &&
      deployment.authorizedSigner?.toLowerCase() ===
        CONTRACTS.authorizedSigner.toLowerCase(),
  );
  const hasValidPolicyBounds = Boolean(
    policy?.registered &&
      /^\d+$/.test(policy.policy.maxLoss) &&
      /^\d+$/.test(policy.policy.maxFee) &&
      /^[1-9]\d*$/.test(policy.policy.minAmountOut),
  );
  const swapReadiness = calculateSwapReadiness({
    amountInBaseUnits: inputAmountBaseUnits,
    quote: protectedQuote,
    nowMs: quoteClockMs,
    poolId: SWAP_POOL_ID,
    poolKeyMatches: calculatePoolId(SWAP_POOL_KEY) === SWAP_POOL_ID && zeroForOne !== null,
    backendPoolKeyVerified: backendPoolKeyVerified && demoBackendIsLocal,
    protocolAddressesVerified,
    minimumOutputProtocolVerified: MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
    authorizationVerified: hasAuthorization,
    policyBoundsVerified: hasValidPolicyBounds,
    demoMode: SEPOLIA_DEMO_MODE,
    demoEstimateAvailable: demoEstimateReady,
  });
  const routeDirection = zeroForOne === null
    ? "Unsupported token pair"
    : `${SWAP_TOKENS[inputToken].poolSymbol} → ${SWAP_TOKENS[outputToken].poolSymbol} (zeroForOne: ${zeroForOne})`;

  async function connectWallet() {
    try {
      const walletClient = getWalletClient();

      const [address] = await walletClient.requestAddresses();

      setAccount(address);

      const balanceResult = await publicClient.getBalance({
        address,
      });

      setBalance(formatEther(balanceResult));

      setStatus("Wallet connected");
    } catch (error) {
      console.error(error);
      setStatus("Wallet connection failed");
    }
  }

  async function loadProtocol() {
    try {
      const [
        poolManager,
        authorization,
        registry,
        registryOwner,
        authorizedConsumer,
        verifier,
        authorizedSigner,
      ] = await Promise.all([
        publicClient.readContract({
          address: CONTRACTS.mevShieldHook,
          abi: mevShieldHookAbi,
          functionName: "poolManager",
        }),

        publicClient.readContract({
          address: CONTRACTS.mevShieldHook,
          abi: mevShieldHookAbi,
          functionName: "authorization",
        }),

        publicClient.readContract({
          address: CONTRACTS.policyAuthorization,
          abi: policyAuthorizationAbi,
          functionName: "registry",
        }),

        publicClient.readContract({
          address: CONTRACTS.policyRegistry,
          abi: policyRegistryAbi,
          functionName: "owner",
        }),

        publicClient.readContract({
          address: CONTRACTS.policyRegistry,
          abi: policyRegistryAbi,
          functionName: "authorizedConsumer",
        }),

        publicClient.readContract({
          address: CONTRACTS.policyAuthorization,
          abi: policyAuthorizationAbi,
          functionName: "verifier",
        }),

        publicClient.readContract({
          address: CONTRACTS.policyVerifier,
          abi: policyVerifierAbi,
          functionName: "authorizedSigner",
        }),
      ]);

      setDeployment({
        poolManager,
        authorization,
        registry,
        registryOwner,
        authorizedConsumer,
        verifier,
        authorizedSigner,
      });

      setStatus("Protocol connected");
    } catch (error) {
      console.error(error);
      setStatus(
        "Could not connect to Sepolia. Check your RPC connection.",
      );
    }
  }

  async function inspectProtectedPool() {
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
  }

  async function verifyBackendPoolConfiguration() {
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
  }

  async function restoreExistingPoolPath() {
    setActionStatus("Confirm the pool compatibility update in your owner wallet...");

    try {
      const walletClient = getWalletClient();
      const [owner] = await walletClient.requestAddresses();

      if (!owner || owner.toLowerCase() !== deployment.registryOwner?.toLowerCase()) {
        throw new Error("Connect the PolicyRegistry owner wallet to update this setting.");
      }

      if (await walletClient.getChainId() !== CHAIN_ID) {
        await walletClient.switchChain({ id: CHAIN_ID });
      }

      const hash = await walletClient.writeContract({
        address: CONTRACTS.policyRegistry,
        abi: policyRegistryAbi,
        functionName: "setAuthorizedConsumer",
        args: [CONTRACTS.poolAuthorization],
        account: owner,
      });

      setActionStatus("Waiting for pool compatibility update...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("Pool compatibility update failed on-chain.");
      }

      await loadProtocol();
      setActionStatus("Existing liquid pool restored. Wallet-paid swaps are enabled.");
    } catch (error) {
      console.error(error);
      setActionStatus(
        error instanceof Error
          ? error.message
          : "Could not restore the existing pool path.",
      );
    }
  }

  async function reportTransactionEvent(
    requestId: string,
    event:
      | "policy_registration_submitted"
      | "policy_registration_failed"
      | "swap_submitted"
      | "swap_failed",
    details: {
      txHash?: Hex;
      nonce?: string;
      error?: unknown;
    } = {},
  ) {
    const failure = details.error
      ? safeError(details.error)
      : undefined;

    try {
      const response = await fetch(
        `${BACKEND_URL}/observability/transaction`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({
            event,
            txHash: details.txHash,
            chainId: CHAIN_ID,
            contract:
              event.startsWith("policy_registration")
                ? CONTRACTS.policyAuthorization
                : undefined,
            router: event.startsWith("swap_")
              ? CONTRACTS.mevShieldRouter
              : undefined,
            nonce: details.nonce,
            ...failure,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `Backend rejected transaction telemetry (${response.status}).`,
        );
      }
    } catch (error) {
      logFrontend("telemetry_delivery_failed", {
        requestId,
        event,
        ...safeError(error),
      });
    }
  }


  async function previewRisk() {
    if (
      inputAmountBaseUnits === null ||
      inputAmountBaseUnits <= 0n ||
      zeroForOne === null
    ) {
      setRiskPreview(null);
      setActionStatus("Enter a positive amount and select a supported token pair.");
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

      const body = await response.json();

      if (!response.ok) {
        throw new Error(
          typeof body.error === "string" ? body.error : "Risk preview failed",
        );
      }

      setRiskPreview({
        ...body,
        requestedAmount,
        inputToken: requestedInputToken,
        outputToken: requestedOutputToken,
        zeroForOne: requestedDirection,
      });

      setActionStatus(
        "Risk preview complete. This is a deterministic MVP estimate, not live market analysis.",
      );
    } catch (error) {
      setActionStatus(`Risk preview failed: ${safeError(error)}`);
    } finally {
      setIsPreviewingRisk(false);
    }
  }

  async function createPolicy() {
    if (!swapReadiness.canCheckRisk || zeroForOne === null) {
      setActionStatus(
        SEPOLIA_DEMO_MODE
          ? "Demo policy creation requires the local backend and verified Sepolia deployment checks."
          : "Risk checking is unavailable until a fresh quote for the verified protected pool and matching backend configuration exist.",
      );
      return;
    }
    setIsCreatingPolicy(true);
    setExecution(null);
    setPolicy(null);
    const requestId = createRequestId();
    setPolicyRequestId(requestId);
    const amountBaseUnits = inputAmountBaseUnits;
    const amountSpecified =
      amountBaseUnits === null ? null : -amountBaseUnits;
    const sqrtPriceLimitX96 = (
      zeroForOne
        ? MIN_SQRT_PRICE_LIMIT_X96
        : MAX_SQRT_PRICE_LIMIT_X96
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
        throw new Error("A genuine fresh protected-pool quote is required before policy signing.");
      }
      if (
        SEPOLIA_DEMO_MODE &&
        (!demoEstimateReady ||
          !isFreshDemoPoolReadiness(protectedQuote, Date.now()))
      ) {
        throw new Error("A fresh initialized and liquid protected-pool check and a valid demo estimate are required.");
      }
      const minAmountOut = SEPOLIA_DEMO_MODE
        ? DEMO_MIN_AMOUNT_OUT
        : protectedQuote.status === "available"
          ? calculateMinimumOutput(protectedQuote.amountOutBaseUnits, slippageBps)
          : null;
      if (minAmountOut === null) {
        throw new Error("Slippage tolerance or quoted minimum output is invalid.");
      }

      const walletClient = getWalletClient();
      const [connectedAccount] = await walletClient.requestAddresses();

      if (!connectedAccount) {
        throw new Error("Connect a wallet to register the policy.");
      }

      setAccount(connectedAccount);

      const poolIdFromKey = calculatePoolId(SWAP_POOL_KEY);
      if (poolIdFromKey !== SWAP_POOL_ID) {
        throw new Error(
          "Configured pool ID does not match the pool key and hook. Swap stopped to avoid a failing, high-gas transaction.",
        );
      }

      if (
        deployment.authorizedConsumer?.toLowerCase() !==
        deployment.authorization?.toLowerCase()
      ) {
        throw new Error(
          "The existing pool authorization is not enabled. Use Restore Existing Pool Path before checking swap risk.",
        );
      }

      if (await walletClient.getChainId() !== CHAIN_ID) {
        await walletClient.switchChain({ id: CHAIN_ID });
      }

      const expiry =
        Math.floor(Date.now() / 1000) + 3600;

      const response = await fetch(`${BACKEND_URL}/policy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({
          poolId: SWAP_POOL_ID,
          trader: CONTRACTS.mevShieldRouter,
          nonce: Date.now().toString(),
          expiry: expiry.toString(),
          amountSpecified: amountSpecified.toString(),
          zeroForOne,
          sqrtPriceLimitX96,
          minAmountOut: minAmountOut.toString(),
        }),
      });

      const data = await response.json();
      const responseRequestId =
        response.headers.get("x-request-id") ?? requestId;
      const result = data as PolicyResponse;
      logFrontend("policy_response", {
        requestId,
        httpStatus: response.status,
        nonce: result?.policy?.nonce,
        policyHash: result?.policyId,
        riskLevel: result?.riskLevel,
      });

      if (!response.ok) {
        throw new Error(
          data?.error ?? "Policy request failed",
        );
      }
      if (SEPOLIA_DEMO_MODE && result.demoMode !== true) {
        throw new Error(
          "The local backend is not running with Sepolia demo policy signing enabled.",
        );
      }

      if (
        result.policy.poolId.toLowerCase() !==
        SWAP_POOL_ID.toLowerCase()
      ) {
        throw new Error(
          "Backend policy pool ID did not match the verified protected pool.",
        );
      }
      if (result.policy.minAmountOut !== minAmountOut.toString()) {
        throw new Error("Backend policy minimum output differs from the fresh quote and selected slippage.");
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
      const registrationReceipt =
        await publicClient.waitForTransactionReceipt({
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

      setActionStatus("Policy signed and registered on-chain.");
    } catch (error) {
      console.error(error);
      logFrontend("transaction_failed", {
        requestId,
        txHash: registrationTxHash,
        ...safeError(error),
        transactionType: "policy_registration",
      });
      await reportTransactionEvent(
        requestId,
        "policy_registration_failed",
        { txHash: registrationTxHash, error },
      );

      setActionStatus(
        error instanceof Error
          ? error.message
          : "Could not create policy.",
      );
    } finally {
      setIsCreatingPolicy(false);
    }
  }

  async function executeProtectedSwap() {
    if (!swapReadiness.canExecute || zeroForOne === null) {
      setActionStatus(
        "Protected execution is unavailable until the protected quote, policy bounds, backend configuration, and on-chain checks are verified.",
      );
      return;
    }
    if (!policy) {
      setActionStatus(
        "Create a policy before executing the swap.",
      );
      return;
    }

    const requestId = policy.requestId || policyRequestId;
    const amountBaseUnits = inputAmountBaseUnits;
    const amountSpecified =
      amountBaseUnits === null ? null : -amountBaseUnits;
    const sqrtPriceLimitX96 = (
      zeroForOne
        ? MIN_SQRT_PRICE_LIMIT_X96
        : MAX_SQRT_PRICE_LIMIT_X96
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

      if (await walletClient.getChainId() !== CHAIN_ID) {
        await walletClient.switchChain({ id: CHAIN_ID });
      }

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
          ? calculateMinimumOutput(protectedQuote.amountOutBaseUnits, slippageBps)
          : null;
      if (
        policy.policy.poolId !== SWAP_POOL_ID ||
        policy.policy.trader.toLowerCase() !== CONTRACTS.mevShieldRouter.toLowerCase() ||
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
        const approvalReceipt =
          await publicClient.waitForTransactionReceipt({
            hash: approvalHash,
          });
        if (approvalReceipt.status !== "success") {
          throw new Error("Input-token approval transaction failed.");
        }
        logFrontend("transaction_confirmed", {
          requestId,
          txHash: approvalHash,
          blockNumber: approvalReceipt.blockNumber.toString(),
          status: approvalReceipt.status,
          gasUsed: approvalReceipt.gasUsed.toString(),
          transactionType: "token_approval",
        });
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
            sqrtPriceLimitX96: BigInt(
              policy.policy.sqrtPriceLimitX96,
            ),
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
        `Estimated swap gas: ${estimatedGas.toLocaleString()}. Confirm in your wallet; your wallet pays gas.`,
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
      logFrontend("transaction_confirmed", {
        requestId,
        txHash,
        blockNumber: receipt.blockNumber.toString(),
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        transactionType: "protected_swap",
      });

      const result: ExecutionResponse = {
        txHash,
        blockNumber: Number(receipt.blockNumber),
        policyId: policy.policyId,
        payer,
        router: CONTRACTS.mevShieldRouter,
        recipient: payer,
      };

      setExecution(result);

      setActionStatus(
        "Protected swap executed successfully; your wallet paid the transaction gas.",
      );

      await loadPolicyById(
        result.policyId as Hex,
      );
      const balanceResult = await publicClient.getBalance({
        address: payer,
      });
      setBalance(formatEther(balanceResult));
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
        error instanceof Error
          ? error.message
          : "Protected swap failed.",
      );
    } finally {
      setIsExecuting(false);
    }
  }

  async function loadPolicyById(id: Hex) {
    try {
      const chainPolicy =
        await publicClient.readContract({
          address: CONTRACTS.policyRegistry,
          abi: policyRegistryAbi,
          functionName: "getPolicy",
          args: [id],
        });

      const consumed =
        await publicClient.readContract({
          address: CONTRACTS.policyRegistry,
          abi: policyRegistryAbi,
          functionName: "isConsumed",
          args: [
            chainPolicy.trader,
            chainPolicy.nonce,
          ],
        });

      setPolicyStatus(
        `Trader ${shortAddress(chainPolicy.trader)} · Nonce ${
          chainPolicy.nonce
        } · Max Loss ${chainPolicy.maxLoss.toString()} · Max Fee ${
          chainPolicy.maxFee.toString()
        } · Minimum Output ${chainPolicy.minAmountOut.toString()
        } · ${consumed ? "CONSUMED" : "ACTIVE"}`,
      );
    } catch (error) {
      console.error(error);
      setPolicyStatus(
        "Policy not found or invalid policy ID.",
      );
    }
  }

  async function loadPolicy() {
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
  }

  useEffect(() => {
    loadProtocol();
    void inspectProtectedPool();
    void verifyBackendPoolConfiguration();
    const interval = window.setInterval(() => {
      void inspectProtectedPool();
      void verifyBackendPoolConfiguration();
    }, 10_000);
    return () => window.clearInterval(interval);
  }, []);


  function switchSwapDirection() {
    setInputToken(outputToken);
    setOutputToken(inputToken);
    setInputAmount("");
    setPolicy(null);
    setPolicyId("");
    setExecution(null);
    setActionStatus(
      SEPOLIA_DEMO_MODE
        ? "Direction changed. Recheck risk before creating a demo policy."
        : "Direction changed. A fresh quote and risk check are required.",
    );
  }

  return (
    <main className="app">
      <section className="hero">
        <div>
          <div className="eyebrow">
            PROGRAMMABLE EXECUTION INFRASTRUCTURE
          </div>

          <h1>MEVShield</h1>

          <p>
            Policy-controlled execution for protected
            stablecoin swaps.
          </p>
        </div>

        <button onClick={connectWallet}>
          {account
            ? `Connected ${shortAddress(account)}`
            : "Connect Wallet"}
        </button>
      </section>

      <section className="status-card">
        <span className="status-dot" />
        <span>{status}</span>

        <span className="chain">
          Ethereum Sepolia (test network) · Chain {CHAIN_ID}
        </span>
      </section>

      <section className="grid">
        <div className="card">
          <h2>Wallet</h2>

          <div className="row">
            <span>Address</span>
            <strong>
              {account
                ? shortAddress(account)
                : "Not connected"}
            </strong>
          </div>

          <div className="row">
            <span>Balance</span>
            <strong>{balance} Sepolia test ETH</strong>
          </div>
        </div>

        <div className="card">
          <h2>Protection</h2>

          <div className="row">
            <span>Policy model</span>
            <strong>EIP-712</strong>
          </div>

          <div className="row">
            <span>Authorization</span>
            <strong>On-chain</strong>
          </div>

          <div className="row">
            <span>Replay protection</span>
            <strong>Nonce</strong>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Protocol Deployment</h2>

        <div className="address-list">
          <AddressRow
            name="PoolManager"
            address={deployment.poolManager}
          />

          <AddressRow
            name="MEVShieldHook"
            address={CONTRACTS.mevShieldHook}
          />

          <AddressRow
            name="PolicyRegistry"
            address={CONTRACTS.policyRegistry}
          />

          <AddressRow
            name="PolicyVerifier"
            address={CONTRACTS.policyVerifier}
          />

          <AddressRow
            name="PolicyAuthorization"
            address={CONTRACTS.policyAuthorization}
          />

          <AddressRow
            name="Authorized Signer"
            address={deployment.authorizedSigner}
          />
        </div>
      </section>

      <section className="card protected">
        <div className="section-heading">
          <div>
            <h2>Protected Swap</h2>

            <p className="muted">
              {SEPOLIA_DEMO_MODE
                ? "Demo mode uses a fixed illustrative conversion, not a market quote. Transactions still execute against the Sepolia pool."
                : "Enter a Sepolia test-network amount. ETH is represented as WETH for ERC-20 pool execution; test ETH and test USDC have no implied real-world value. A genuine protected-pool quote is required for execution."}
            </p>
          </div>

          <span className="live-badge">
            {SEPOLIA_DEMO_MODE
              ? "LOCAL DEMO · SEPOLIA TESTNET"
              : "SEPOLIA TESTNET · NOT READY"}
          </span>
        </div>

        {SEPOLIA_DEMO_MODE && (
          <p className="warning demo-warning" role="alert">
            DEMO ONLY: display estimate assumes {DEMO_USDC_PER_WETH.toString()} USDC per WETH; it is not a pool quote. The signed minimum is only 1 smallest output-token unit, so it provides no meaningful slippage protection. Use Sepolia test tokens only.
          </p>
        )}

        <SwapInputs
          inputToken={inputToken}
          outputToken={outputToken}
          inputAmount={inputAmount}
          swapTokens={SWAP_TOKENS}
          demoMode={SEPOLIA_DEMO_MODE}
          demoEstimateBaseUnits={demoEstimateBaseUnits}
          quoteIsFresh={quoteIsFresh}
          protectedQuote={protectedQuote}
          routeDirection={routeDirection}
          onInputAmountChange={(value) => {
            setInputAmount(value);
            setPolicy(null);
            setPolicyId("");
            setExecution(null);
            setActionStatus(
              SEPOLIA_DEMO_MODE
                ? "Input changed. Recheck risk before creating a demo policy."
                : "Input changed. A fresh quote and risk check are required.",
            );
          }}
          onInputTokenChange={(nextToken) => {
            if (nextToken === outputToken) return;
            setInputToken(nextToken);
            setInputAmount("");
            setPolicy(null);
            setPolicyId("");
            setExecution(null);
            setActionStatus(
              SEPOLIA_DEMO_MODE
                ? "Token changed. Recheck risk before creating a demo policy."
                : "Token changed. A fresh quote and risk check are required.",
            );
          }}
          onOutputTokenChange={(nextToken) => {
            if (nextToken === inputToken) return;
            setOutputToken(nextToken);
            setPolicy(null);
            setPolicyId("");
            setExecution(null);
            setActionStatus("Token changed. A fresh quote and risk check are required.");
          }}
          onSwitchDirection={switchSwapDirection}
        />
        <div className="swap-inputs">
          {!SEPOLIA_DEMO_MODE && (
            <label>
              Slippage tolerance (basis points)
              <input
                type="number"
                min="0"
                max="9999"
                step="1"
                value={slippageBps}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setSlippageBps(next);
                  setPolicy(null);
                  setPolicyId("");
                  setExecution(null);
                }}
                aria-label="Slippage tolerance in basis points"
              />
            </label>
          )}
          <p className="amount-conversion">
            Minimum output:{" "}
            {SEPOLIA_DEMO_MODE
              ? `${formatUnits(DEMO_MIN_AMOUNT_OUT, SWAP_TOKENS[outputToken].decimals)} ${SWAP_TOKENS[outputToken].poolSymbol} (1 base unit; demo floor)`
              : quoteIsFresh && protectedQuote.status === "available"
              ? (() => {
                  const minimum = calculateMinimumOutput(
                    protectedQuote.amountOutBaseUnits,
                    slippageBps,
                  );
                  return minimum === null
                    ? "invalid slippage or quote"
                    : `${formatUnits(minimum, SWAP_TOKENS[outputToken].decimals)} ${SWAP_TOKENS[outputToken].poolSymbol}`;
                })()
              : "unavailable until a genuine fresh quote exists"}
          </p>
          {inputAmount !== "" &&
            (inputAmountBaseUnits === null || inputAmountBaseUnits === 0n) && (
            <p className="warning" role="alert">
              Enter a positive decimal amount with no more than {SWAP_TOKENS[inputToken].decimals} decimal places.
            </p>
            )}
          {inputAmountBaseUnits !== null && inputAmountBaseUnits > 0n && (
            <p className="amount-conversion">
              {formatUnits(inputAmountBaseUnits, SWAP_TOKENS[inputToken].decimals)}{" "}
              {SWAP_TOKENS[inputToken].poolSymbol} = {inputAmountBaseUnits.toString()} base units
            </p>
          )}
          <p className="warning" role="status">
            {SEPOLIA_DEMO_MODE
              ? `Illustrative estimate only (${DEMO_USDC_PER_WETH.toString()} USDC/WETH fixed rate); the minimum output does not come from this estimate.`
              : quoteIsFresh && protectedQuote.status === "available"
              ? "A fresh quote is available for the exact protected pool; execution still requires all readiness checks."
              : `Protected-pool quote unavailable: ${(protectedQuote.status === "available" ? "stale quote" : protectedQuote.reason.replaceAll("-", " "))}. No output, slippage, or policy bounds are estimated.`}
          </p>
        </div>

        <div className="swap-summary">
          <div>
            <span>
              {SEPOLIA_DEMO_MODE
                ? "Output · demo estimate only (not a quote)"
                : `Protected pool state · ${quoteIsFresh ? "quote available" : protectedQuote.status === "available" ? "stale quote" : protectedQuote.reason.replaceAll("-", " ")}`}
            </span>
            <code>{shortAddress(SWAP_POOL_ID)}</code>
          </div>

          <div>
            <span>Pool tokens</span>
            <strong>USDC / WETH · 6 / 18 decimals</strong>
          </div>

          <div>
            <span>Derived pool direction</span>
            <strong>{routeDirection}</strong>
          </div>

          <div>
            <span>Execution</span>
            <strong>
              {swapReadiness.canExecute
                ? "All readiness checks passed"
                : `Disabled · ${swapReadiness.reasons.join(" ")}`}
            </strong>
          </div>
        </div>

        {deployment.authorization &&
          deployment.authorizedConsumer &&
          deployment.authorization.toLowerCase() !==
            deployment.authorizedConsumer.toLowerCase() && (
            <div className="policy-result">
              The live pool uses its original hook authorization. The registry currently points to a different consumer, so swap estimation would fail.
              {account?.toLowerCase() ===
              deployment.registryOwner?.toLowerCase() ? (
                <button
                  className="primary"
                  onClick={restoreExistingPoolPath}
                  disabled={true}
                >
                  Restore Existing Pool Path (disabled)
                </button>
              ) : (
                <p className="warning">
                  Connect the registry owner wallet ({shortAddress(deployment.registryOwner)}) to restore the existing pool.
                </p>
              )}
            </div>
          )}

        <button
  className="primary"
  onClick={previewRisk}
  disabled={
    inputAmountBaseUnits === null ||
    inputAmountBaseUnits <= 0n ||
    zeroForOne === null ||
    isPreviewingRisk ||
    isCreatingPolicy ||
    isExecuting
  }
>
  {isPreviewingRisk ? "Calculating Risk..." : "Check Swap Risk"}
</button>
<button
  className="primary"
  onClick={createPolicy}
  disabled={!swapReadiness.canCheckRisk || isCreatingPolicy || isExecuting || isPreviewingRisk}
>
  {isCreatingPolicy
    ? "Creating Policy..."
    : SEPOLIA_DEMO_MODE
      ? "Create Demo Policy"
      : "Create Protected Policy"}
</button>
{riskPreview &&
  riskPreview.requestedAmount === (inputAmountBaseUnits?.toString() ?? "") &&
  riskPreview.inputToken === inputToken &&
  riskPreview.outputToken === outputToken &&
  riskPreview.zeroForOne === zeroForOne && (
    <section className="risk-panel">
      <div className="risk-header">
        <h3>Risk Preview (MVP)</h3>
        <strong>{riskPreview.riskLevel}</strong>
      </div>
      <div className="risk-grid">
        <div className="metric">
          <span>Estimated Loss</span>
          <strong>{formatUnits(BigInt(riskPreview.estimatedLoss), SWAP_TOKENS[inputToken].decimals)} {SWAP_TOKENS[inputToken].poolSymbol}</strong>
        </div>
        <div className="metric">
          <span>Maximum Loss Bound</span>
          <strong>{formatUnits(BigInt(riskPreview.maxLoss), SWAP_TOKENS[inputToken].decimals)} {SWAP_TOKENS[inputToken].poolSymbol}</strong>
        </div>
        <div className="metric">
          <span>Estimated Fee</span>
          <strong>{formatUnits(BigInt(riskPreview.estimatedFee), SWAP_TOKENS[inputToken].decimals)} {SWAP_TOKENS[inputToken].poolSymbol}</strong>
        </div>
        <div className="metric">
          <span>Maximum Fee Bound</span>
          <strong>{formatUnits(BigInt(riskPreview.maxFee), SWAP_TOKENS[inputToken].decimals)} {SWAP_TOKENS[inputToken].poolSymbol}</strong>
        </div>
      </div>
      <p>{riskPreview.disclaimer}</p>
    </section>
  )}


        <p className="action-status">
          {actionStatus}
        </p>

        {policy && (
          <div className="risk-panel">
            <div className="risk-header">
              <div>
                <span className="label">
                  Risk Level
                </span>

                <strong className="risk-level">
                  {policy.riskLevel}
                </strong>
              </div>

              <div className="registered">
                {policy.registered
                  ? "✓ REGISTERED"
                  : "NOT REGISTERED"}
              </div>
            </div>

            <div className="risk-grid">
              <Metric
                label="Estimated Loss (model)"
                value={policy.estimatedLoss}
              />

              <Metric
                label="Maximum Loss"
                value={policy.policy.maxLoss}
              />

              <Metric
                label="Estimated Fee (model)"
                value={policy.estimatedFee}
              />

              <Metric
                label="Maximum Fee"
                value={policy.policy.maxFee}
              />
              <Metric
                label={
                  SEPOLIA_DEMO_MODE
                    ? "Signed Minimum Output (demo floor)"
                    : "Signed Minimum Output"
                }
                value={policy.policy.minAmountOut}
              />
            </div>

            <div className="policy-meta">
              <div>
                <span>Policy ID</span>
                <code>{policy.policyId}</code>
              </div>

              <div>
                <span>Registration TX</span>
                {policy.txHash ? (
                  <a
                    href={`https://sepolia.etherscan.io/tx/${policy.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View on Sepolia Etherscan
                  </a>
                ) : (
                  <code>Not registered</code>
                )}
              </div>

              <div>
                <span>Nonce</span>
                <strong>
                  {policy.policy.nonce}
                </strong>
              </div>
            </div>

            <button
              className="primary execute-button"
              onClick={executeProtectedSwap}
              disabled={
                !swapReadiness.canExecute ||
                !policy?.registered ||
                isExecuting ||
                isCreatingPolicy
              }
            >
              {SEPOLIA_DEMO_MODE
                ? "Execute Demo Protected Swap"
                : "Execute Protected Swap"}
            </button>
          </div>
        )}

        {execution && (
          <div className="success-panel">
            <div className="success-title">
              ✓ Protected swap executed
            </div>

            <div className="execution-grid">
              <Metric
                label="Block"
                value={execution.blockNumber.toString()}
              />

              <Metric
                label="Policy"
                value={shortAddress(
                  execution.policyId,
                )}
              />

              <Metric
                label="Router"
                value={shortAddress(
                  execution.router,
                )}
              />

              <Metric
                label="Gas payer"
                value={shortAddress(execution.payer)}
              />

              <Metric
                label="Recipient"
                value={shortAddress(
                  execution.recipient,
                )}
              />
            </div>

            <div className="tx-row">
              <span>Transaction</span>
              <a
                href={`https://sepolia.etherscan.io/tx/${execution.txHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View on Sepolia Etherscan
              </a>
            </div>

            <div className="tx-row">
              <span>Policy lifecycle</span>
              <strong>
                REGISTERED → EXECUTED → CONSUMED
              </strong>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Inspect Policy</h2>

        <p className="muted">
          Inspect any registered policy directly from
          the PolicyRegistry.
        </p>

        <div className="policy-form">
          <input
            value={policyId}
            onChange={(event) =>
              setPolicyId(
                event.target.value as Hex,
              )
            }
            placeholder="0x90284afe..."
          />

          <button
            onClick={loadPolicy}
            disabled={isInspecting}
          >
            {isInspecting
              ? "Inspecting..."
              : "Inspect"}
          </button>
        </div>

        <div className="policy-result">
          {policyStatus}
        </div>
      </section>
    </main>
  );
}



export default App;
