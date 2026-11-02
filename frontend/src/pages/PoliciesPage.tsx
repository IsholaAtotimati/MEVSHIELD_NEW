import { useEffect, useState } from "react";
import type { Hex } from "viem";

import Button from "../components/Button";
import Card from "../components/Card";
import Kicker from "../components/Kicker";
import PolicyBox from "../components/PolicyBox";
import RiskCallout from "../components/RiskCallout";
import StatLine from "../components/StatLine";
import { SWAP_TOKENS } from "../config/swapPool";
import { useTrade } from "../context/TradeContext";
import { loadPolicyDefaults, savePolicyDefaults } from "../lib/policyDefaults";
import { readRegisteredPolicy } from "../lib/policyReads";
import { formatBaseUnits, shortAddress } from "../lib/format";

type InspectState =
  | { kind: "idle"; message: string }
  | { kind: "error"; message: string }
  | {
      kind: "found";
      status: "active" | "consumed" | "expired";
      trader: string;
      nonce: string;
      minAmountOut: string;
      maxLoss: string;
      maxFee: string;
    };

export default function PoliciesPage() {
  const { policy, wallet, setSlippageBps } = useTrade();
  const [defaults, setDefaults] = useState(loadPolicyDefaults);
  const [inspectId, setInspectId] = useState<Hex | "">("");
  const [inspect, setInspect] = useState<InspectState>({
    kind: "idle",
    message: "Enter a policy ID to inspect.",
  });

  useEffect(() => {
    setSlippageBps(defaults.slippageBps);
  }, [defaults.slippageBps, setSlippageBps]);

  async function runInspect() {
    if (!inspectId) {
      setInspect({ kind: "error", message: "Enter a policy ID first." });
      return;
    }
    try {
      const { policy: chainPolicy, consumed } = await readRegisteredPolicy(
        inspectId,
      );
      const expired = chainPolicy.expiry < BigInt(Math.floor(Date.now() / 1000));
      setInspect({
        kind: "found",
        status: consumed ? "consumed" : expired ? "expired" : "active",
        trader: chainPolicy.trader,
        nonce: chainPolicy.nonce.toString(),
        minAmountOut: formatBaseUnits(
          chainPolicy.minAmountOut,
          SWAP_TOKENS.USDC.decimals,
        ),
        maxLoss: chainPolicy.maxLoss.toString(),
        maxFee: chainPolicy.maxFee.toString(),
      });
    } catch {
      setInspect({
        kind: "error",
        message: "Policy not found or invalid policy ID.",
      });
    }
  }

  const activePolicy = policy.policy;

  return (
    <div className="page-stack">
      <header className="page-head">
        <Kicker>Policies</Kicker>
        <h1 className="page-title">Policies</h1>
        <p className="addr">
          Inspect policies and set local defaults for new trades.
        </p>
      </header>

      <Card title="Current session policy">
        {!activePolicy ? (
          <p className="note">No policy loaded from the current Trade session.</p>
        ) : (
          <>
            <StatLine label="Policy ID" mono>
              {activePolicy.policyId}
            </StatLine>
            <StatLine
              label="State"
              tone={activePolicy.registered ? "gain" : "neutral"}
            >
              {activePolicy.registered ? "registered" : "pending"}
            </StatLine>
            <StatLine label="Nonce" mono>
              {activePolicy.policy.nonce}
            </StatLine>
            <StatLine label="Risk level" mono>
              {activePolicy.riskLevel}
            </StatLine>
          </>
        )}
      </Card>

      <Card title="Inspect by policy ID">
        <label className="field" htmlFor="policy-inspect-id">
          <span>Policy ID (0x-prefixed 32-byte hash)</span>
        </label>
        <div className="field-row">
          <input
            className="input"
            id="policy-inspect-id"
            value={inspectId}
            onChange={(event) => setInspectId(event.target.value as Hex)}
            placeholder="0x..."
            autoComplete="off"
            spellCheck={false}
          />
          <Button variant="ghost" onClick={() => void runInspect()}>
            Inspect
          </Button>
        </div>

        <div role="status" aria-live="polite" className="inspect-result">
          {inspect.kind === "idle" && <p className="note">{inspect.message}</p>}
          {inspect.kind === "error" && (
            <RiskCallout heading="Not found">{inspect.message}</RiskCallout>
          )}
          {inspect.kind === "found" && (
            <PolicyBox title="On-chain policy">
              <StatLine
                label="Status"
                mono
                tone={inspect.status === "active" ? "gain" : "neutral"}
              >
                {inspect.status}
              </StatLine>
              <StatLine label="Trader" mono>
                {shortAddress(inspect.trader)}
              </StatLine>
              <StatLine label="Nonce" mono>
                {inspect.nonce}
              </StatLine>
              <StatLine label="Minimum output" mono>
                {inspect.minAmountOut} USDC (pool units)
              </StatLine>
              <StatLine label="Max loss" mono>
                {inspect.maxLoss} base units
              </StatLine>
              <StatLine label="Max fee" mono>
                {inspect.maxFee} base units
              </StatLine>
            </PolicyBox>
          )}
        </div>
      </Card>

      <Card
        title="Defaults for new policies"
        footer="Stored locally in this browser. Saving also applies the slippage to the Trade page."
      >
        <label className="field">
          <span>Slippage (bps)</span>
          <input
            className="input"
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
        <label className="field">
          <span>Max loss (base units, stored locally)</span>
          <input
            className="input"
            value={defaults.maxLoss}
            onChange={(event) =>
              setDefaults((prev) => ({ ...prev, maxLoss: event.target.value }))
            }
          />
        </label>
        <label className="field">
          <span>Max fee (base units, stored locally)</span>
          <input
            className="input"
            value={defaults.maxFee}
            onChange={(event) =>
              setDefaults((prev) => ({ ...prev, maxFee: event.target.value }))
            }
          />
        </label>
        <div className="button-row">
          <Button
            variant="primary"
            onClick={() => {
              savePolicyDefaults(defaults);
              setSlippageBps(defaults.slippageBps);
            }}
          >
            Save defaults
          </Button>
        </div>
      </Card>

      {!wallet.account && (
        <p className="note">
          Use <strong>Connect wallet</strong> in the top bar to register new
          policies.
        </p>
      )}
    </div>
  );
}
