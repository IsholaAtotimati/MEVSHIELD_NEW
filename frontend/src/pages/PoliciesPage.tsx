import { useEffect, useState } from "react";
import type { Hex } from "viem";
import { formatUnits } from "viem";

import { SWAP_TOKENS } from "../config/swapPool";
import { useTrade } from "../context/TradeContext";
import { loadPolicyDefaults, savePolicyDefaults } from "../lib/policyDefaults";
import { CONTRACTS } from "../lib/contracts";
import { policyRegistryAbi } from "../lib/abis";
import { publicClient } from "../lib/viem";
import { shortAddress } from "../lib/format";

export default function PoliciesPage() {
  const { policy, wallet, setSlippageBps } = useTrade();
  const [defaults, setDefaults] = useState(loadPolicyDefaults);
  const [inspectId, setInspectId] = useState<Hex | "">("");
  const [inspectText, setInspectText] = useState("Enter a policy ID to inspect.");

  useEffect(() => {
    setSlippageBps(defaults.slippageBps);
  }, [defaults.slippageBps, setSlippageBps]);

  async function inspect() {
    if (!inspectId) {
      setInspectText("Enter a policy ID first.");
      return;
    }
    try {
      const chainPolicy = await publicClient.readContract({
        address: CONTRACTS.policyRegistry,
        abi: policyRegistryAbi,
        functionName: "getPolicy",
        args: [inspectId],
      });
      const consumed = await publicClient.readContract({
        address: CONTRACTS.policyRegistry,
        abi: policyRegistryAbi,
        functionName: "isConsumed",
        args: [chainPolicy.trader, chainPolicy.nonce],
      });
      const expired =
        chainPolicy.expiry < BigInt(Math.floor(Date.now() / 1000));
      const status = consumed
        ? "consumed"
        : expired
          ? "expired"
          : "active";
      setInspectText(
        `Status: ${status}. Trader ${shortAddress(chainPolicy.trader)}. Nonce ${chainPolicy.nonce.toString()}. Minimum output ${formatUnits(chainPolicy.minAmountOut, SWAP_TOKENS.USDC.decimals)} USDC (pool units). Max loss ${chainPolicy.maxLoss.toString()} base units. Max fee ${chainPolicy.maxFee.toString()} base units.`,
      );
    } catch {
      setInspectText("Policy not found or invalid policy ID.");
    }
  }

  const activePolicy = policy.policy;

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1>Policies</h1>
        <p className="muted">Inspect policies and set local defaults for new trades.</p>
      </header>

      <div className="card">
        <h2>Current session policy</h2>
        {!activePolicy ? (
          <p className="muted">No policy loaded from the current Trade session.</p>
        ) : (
          <ul className="policy-list">
            <li>
              ID <code>{activePolicy.policyId}</code> ·{" "}
              {activePolicy.registered ? "registered" : "pending"} · nonce{" "}
              {activePolicy.policy.nonce}
            </li>
          </ul>
        )}
      </div>

      <div className="card">
        <h2>Inspect by policy ID</h2>
        <div className="policy-form">
          <input
            value={inspectId}
            onChange={(event) => setInspectId(event.target.value as Hex)}
            placeholder="0x..."
          />
          <button type="button" onClick={() => void inspect()}>
            Inspect
          </button>
        </div>
        <p>{inspectText}</p>
      </div>

      <div className="card">
        <h2>Defaults for new policies</h2>
        <label>
          Slippage (bps)
          <input
            type="number"
            value={defaults.slippageBps}
            onChange={(event) =>
              setDefaults((prev) => ({
                ...prev,
                slippageBps: Number(event.target.value),
              }))
            }
          />
        </label>
        <label>
          Max loss (base units, stored locally)
          <input
            value={defaults.maxLoss}
            onChange={(event) =>
              setDefaults((prev) => ({ ...prev, maxLoss: event.target.value }))
            }
          />
        </label>
        <label>
          Max fee (base units, stored locally)
          <input
            value={defaults.maxFee}
            onChange={(event) =>
              setDefaults((prev) => ({ ...prev, maxFee: event.target.value }))
            }
          />
        </label>
        <button
          type="button"
          onClick={() => {
            savePolicyDefaults(defaults);
            setSlippageBps(defaults.slippageBps);
          }}
        >
          Save defaults
        </button>
      </div>

      {!wallet.account && (
        <p className="muted">Connect a wallet on Trade to register new policies.</p>
      )}
    </div>
  );
}
