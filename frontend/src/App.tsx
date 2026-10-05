import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { encodeAbiParameters, formatEther } from "viem";

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

import "./App.css";

const BACKEND_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

const SWAP_CONFIG = {
  poolId:
    "0x75eeb1ab079f55178bbe93102539d5d3cab08ab019b0bb1e05a8d6cc4d5002d8",

  currency0:
    "0x3722a74BD678c358c9cbE47F43400C97C9cDb1D0" as Address,

  currency1:
    "0x83029461d33A575A2AD852BE69a0BB0aDC68988e" as Address,

  fee: 3000,

  tickSpacing: 60,

  hooks:
    CONTRACTS.mevShieldHook,

  zeroForOne: true,

  amountSpecified: "-100000000",

  sqrtPriceLimitX96: "4295128740",

  trader:
    CONTRACTS.mevShieldRouter as Address,
};

type DeploymentStatus = {
  poolManager: Address | null;
  authorization: Address | null;
  registry: Address | null;
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
  };
  actualLoss: string;
  actualFee: string;
  riskLevel: string;
  signature: string;
  policyId: string;
  txHash?: Hex;
  registered?: boolean;
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

function App() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState<string>("—");
  const [status, setStatus] = useState("Checking protocol...");

  const [deployment, setDeployment] = useState<DeploymentStatus>({
    poolManager: null,
    authorization: null,
    registry: null,
    verifier: null,
    authorizedSigner: null,
  });

  const [policyId, setPolicyId] = useState<Hex | "">("");
  const [policyStatus, setPolicyStatus] =
    useState<string>("No policy loaded.");

  const [policy, setPolicy] = useState<PolicyResponse | null>(null);
  const [execution, setExecution] =
    useState<ExecutionResponse | null>(null);

  const [isCreatingPolicy, setIsCreatingPolicy] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);

  const [actionStatus, setActionStatus] =
    useState("Ready to calculate swap risk.");

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

  async function createPolicy() {
    setIsCreatingPolicy(true);
    setExecution(null);
    setPolicy(null);
    setActionStatus("Calculating risk and requesting policy...");

    try {
      const walletClient = getWalletClient();
      const [connectedAccount] = await walletClient.requestAddresses();

      if (!connectedAccount) {
        throw new Error("Connect a wallet to register the policy.");
      }

      setAccount(connectedAccount);

      if (await walletClient.getChainId() !== CHAIN_ID) {
        await walletClient.switchChain({ id: CHAIN_ID });
      }

      const expiry =
        Math.floor(Date.now() / 1000) + 3600;

      const response = await fetch(`${BACKEND_URL}/policy`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          poolId: SWAP_CONFIG.poolId,
          trader: SWAP_CONFIG.trader,
          nonce: Date.now().toString(),
          expiry: expiry.toString(),
          amountSpecified: SWAP_CONFIG.amountSpecified,
          zeroForOne: SWAP_CONFIG.zeroForOne,
          sqrtPriceLimitX96:
            SWAP_CONFIG.sqrtPriceLimitX96,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ?? "Policy request failed",
        );
      }

      const result = data as PolicyResponse;

      setActionStatus("Approve the policy registration in your wallet...");

      const txHash = await walletClient.writeContract({
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
          },
          result.signature as Hex,
        ],
        account: connectedAccount,
      });

      setActionStatus("Waiting for policy registration confirmation...");
      await publicClient.waitForTransactionReceipt({ hash: txHash });

      const registered = await publicClient.readContract({
        address: CONTRACTS.policyRegistry,
        abi: policyRegistryAbi,
        functionName: "isRegistered",
        args: [result.policy.trader as Address, BigInt(result.policy.nonce)],
      });

      if (!registered) {
        throw new Error("Policy registration was not confirmed on-chain.");
      }

      setPolicy({ ...result, txHash, registered });
      setPolicyId(result.policyId as Hex);

      setActionStatus("Policy signed and registered on-chain.");
    } catch (error) {
      console.error(error);

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
    if (!policy) {
      setActionStatus(
        "Create a policy before executing the swap.",
      );
      return;
    }

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

      const amountSpecified = BigInt(SWAP_CONFIG.amountSpecified);
      if (amountSpecified >= 0n) {
        throw new Error(
          "Wallet-paid swaps currently require a negative exact-input amount.",
        );
      }
      const amountIn = -amountSpecified;
      const inputToken = SWAP_CONFIG.zeroForOne
        ? SWAP_CONFIG.currency0
        : SWAP_CONFIG.currency1;

      const allowance = await publicClient.readContract({
        address: inputToken,
        abi: erc20Abi,
        functionName: "allowance",
        args: [payer, CONTRACTS.mevShieldRouter],
      });

      if (allowance < amountIn) {
        setActionStatus(
          "Approve the input token in your wallet; you pay the approval gas.",
        );
        const approvalHash = await walletClient.writeContract({
          address: inputToken,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.mevShieldRouter, amountIn],
          account: payer,
        });
        const approvalReceipt =
          await publicClient.waitForTransactionReceipt({
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
          },
          policy.signature as Hex,
          BigInt(policy.actualLoss),
          BigInt(policy.actualFee),
        ],
      );

      setActionStatus(
        "Confirm the protected swap in your wallet; your wallet pays gas.",
      );
      const txHash = await walletClient.writeContract({
        address: CONTRACTS.mevShieldRouter,
        abi: mevShieldRouterAbi,
        functionName: "executeSwap",
        args: [
          {
            currency0: SWAP_CONFIG.currency0,
            currency1: SWAP_CONFIG.currency1,
            fee: SWAP_CONFIG.fee,
            tickSpacing: SWAP_CONFIG.tickSpacing,
            hooks: SWAP_CONFIG.hooks,
          },
          {
            zeroForOne: SWAP_CONFIG.zeroForOne,
            amountSpecified,
            sqrtPriceLimitX96: BigInt(
              SWAP_CONFIG.sqrtPriceLimitX96,
            ),
          },
          hookData,
          payer,
        ],
        account: payer,
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
  }, []);

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
          Chain {CHAIN_ID}
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
            <strong>{balance} ETH</strong>
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
              The backend calculates risk and signs the
              policy. Your connected wallet registers it,
              approves the input token if needed, and pays
              gas for the protected swap.
            </p>
          </div>

          <span className="live-badge">
            WALLET-PAID EXECUTION
          </span>
        </div>

        <div className="swap-summary">
          <div>
            <span>Pool</span>
            <code>{shortAddress(SWAP_CONFIG.poolId)}</code>
          </div>

          <div>
            <span>Direction</span>
            <strong>Token0 → Token1</strong>
          </div>

          <div>
            <span>Amount</span>
            <strong>
              {SWAP_CONFIG.amountSpecified}
            </strong>
          </div>

          <div>
            <span>Execution</span>
            <strong>MEVShieldRouter</strong>
          </div>
        </div>

        <button
          className="primary"
          onClick={createPolicy}
          disabled={
            isCreatingPolicy ||
            isExecuting
          }
        >
          {isCreatingPolicy
            ? "Calculating Risk..."
            : "Check Swap Risk"}
        </button>

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
                label="Expected Loss"
                value={policy.actualLoss}
              />

              <Metric
                label="Maximum Loss"
                value={policy.policy.maxLoss}
              />

              <Metric
                label="Expected Fee"
                value={policy.actualFee}
              />

              <Metric
                label="Maximum Fee"
                value={policy.policy.maxFee}
              />
            </div>

            <div className="policy-meta">
              <div>
                <span>Policy ID</span>
                <code>{policy.policyId}</code>
              </div>

              <div>
                <span>Registration TX</span>
                <code>{policy.txHash ?? "Not registered"}</code>
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
                !policy.registered ||
                isExecuting
              }
            >
              {isExecuting
                ? "Executing..."
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
              <code>{execution.txHash}</code>
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

function Metric({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function AddressRow({
  name,
  address,
}: {
  name: string;
  address: Address | null;
}) {
  return (
    <div className="address-row">
      <span>{name}</span>

      <code>
        {address ?? "Loading..."}
      </code>
    </div>
  );
}

export default App;
