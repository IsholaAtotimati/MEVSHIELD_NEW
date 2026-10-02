import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { formatEther } from "viem";

import {
  CONTRACTS,
  CHAIN_ID,
} from "./lib/contracts";

import {
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

  recipient:
    "0x016B78a30CE176EF0B90c122e8677e13aAB2A815" as Address,
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
  txHash: string;
  registered: boolean;
};

type ExecutionResponse = {
  success: boolean;
  txHash: string;
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

      setPolicy(result);
      setPolicyId(result.policyId as Hex);

      setActionStatus(
        result.registered
          ? "Policy signed and registered on-chain."
          : "Policy created but not registered.",
      );
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
      const response = await fetch(
        `${BACKEND_URL}/execute-swap`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            policy: policy.policy,

            signature: policy.signature,

            actualLoss: policy.actualLoss,

            actualFee: policy.actualFee,

            poolKey: {
              currency0: SWAP_CONFIG.currency0,
              currency1: SWAP_CONFIG.currency1,
              fee: SWAP_CONFIG.fee,
              tickSpacing: SWAP_CONFIG.tickSpacing,
              hooks: SWAP_CONFIG.hooks,
            },

            swapParams: {
              zeroForOne:
                SWAP_CONFIG.zeroForOne,

              amountSpecified:
                SWAP_CONFIG.amountSpecified,

              sqrtPriceLimitX96:
                SWAP_CONFIG.sqrtPriceLimitX96,
            },

            recipient:
              SWAP_CONFIG.recipient,
          }),
        },
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(
          data?.error ??
            data?.details ??
            "Protected swap failed",
        );
      }

      const result = data as ExecutionResponse;

      setExecution(result);

      setActionStatus(
        "Protected swap executed successfully.",
      );

      await loadPolicyById(
        result.policyId as Hex,
      );
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
              Calculate the off-chain risk, receive an
              EIP-712 policy, register it on-chain, then
              execute through the MEVShield hook.
            </p>
          </div>

          <span className="live-badge">
            LIVE BACKEND
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
                <code>{policy.txHash}</code>
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
