import { Link } from "react-router-dom";

import { SEPOLIA_DEMO_MODE } from "../config/env";
import {
  SWAP_POOL_CONFIGURATION,
  SWAP_POOL_ID,
  SWAP_TOKENS,
} from "../config/swapPool";
import { TOKEN_NETWORK_LABEL } from "../config/chain";
import Button from "../components/Button";
import Delta from "../components/Delta";
import ExplorerLink from "../components/ExplorerLink";
import KeptBox from "../components/KeptBox";
import Kicker from "../components/Kicker";
import MiniPair from "../components/MiniPair";
import PolicyBox from "../components/PolicyBox";
import RiskCallout from "../components/RiskCallout";
import ShieldReport from "../components/ShieldReport";
import StatLine from "../components/StatLine";
import SwapInputs from "../components/SwapInputs";
import ToggleRow from "../components/ToggleRow";
import { useTrade } from "../context/TradeContext";
import {
  calculateMinimumOutput,
  DEMO_MIN_AMOUNT_OUT,
  DEMO_USDC_PER_WETH,
} from "../lib/protectedQuote";
import {
  formatBaseUnits,
  formatBaseUnitsWithSymbol,
  shortAddress,
} from "../lib/format";
import { resolveShieldPhase } from "../lib/shieldReport";
import { EXPLORER_NAME, explorerTxUrl } from "../lib/explorer";

const SLIPPAGE_PRESETS = [
  { label: "0.1%", bps: 10 },
  { label: "0.5%", bps: 50 },
  { label: "1.0%", bps: 100 },
];

export default function TradePage() {
  const trade = useTrade();
  const {
    policy,
    execution,
    quote,
    swapReadiness,
    inputToken,
    outputToken,
    inputAmount,
    inputTokenBalance,
    slippageBps,
    setSlippageBps,
    demoEstimateBaseUnits,
    quoteIsFresh,
    routeDirection,
    onInputAmountChange,
    switchSwapDirection,
    inputAmountBaseUnits,
    zeroForOne,
  } = trade;

  const riskMatchesInputs =
    policy.riskPreview &&
    policy.riskPreview.requestedAmount ===
      (inputAmountBaseUnits?.toString() ?? "") &&
    policy.riskPreview.inputToken === inputToken &&
    policy.riskPreview.outputToken === outputToken &&
    policy.riskPreview.zeroForOne === zeroForOne;

  const primaryStep: "check" | "sign" | "done" = policy.policy?.registered
    ? "done"
    : riskMatchesInputs
      ? "sign"
      : "check";

  const primaryDisabled =
    inputAmountBaseUnits === null ||
    inputAmountBaseUnits <= 0n ||
    zeroForOne === null ||
    policy.isPreviewingRisk ||
    policy.isCreatingPolicy ||
    execution.isExecuting ||
    (primaryStep === "sign" && !swapReadiness.canCheckRisk) ||
    (primaryStep === "check" && policy.isPreviewingRisk);

  async function onPrimaryClick() {
    if (primaryStep === "check") {
      await policy.previewRisk();
      return;
    }
    if (primaryStep === "sign") {
      await policy.createPolicy();
    }
  }

  const checklist = swapReadiness.reasons;
  const lifecycleQuoted = quoteIsFresh || SEPOLIA_DEMO_MODE;
  const lifecycleRegistered = Boolean(policy.policy?.registered);
  const lifecycleExecuted = Boolean(execution.execution);

  const phase = resolveShieldPhase({
    hasReceipt: Boolean(execution.execution),
    hasPolicy: Boolean(policy.policy),
    riskMatchesInputs: Boolean(riskMatchesInputs),
  });

  const poolLabel =
    SWAP_POOL_ID === null ? "unconfigured" : shortAddress(SWAP_POOL_ID);

  const minimumOutput = SEPOLIA_DEMO_MODE
    ? `${formatBaseUnits(DEMO_MIN_AMOUNT_OUT, SWAP_TOKENS[outputToken].decimals)} ${SWAP_TOKENS[outputToken].poolSymbol} (demo floor)`
    : quoteIsFresh && quote.protectedQuote.status === "available"
      ? (() => {
          const minimum = calculateMinimumOutput(
            quote.protectedQuote.amountOutBaseUnits,
            slippageBps,
          );
          return minimum === null
            ? "invalid"
            : `${formatBaseUnits(minimum, SWAP_TOKENS[outputToken].decimals)} ${SWAP_TOKENS[outputToken].poolSymbol}`;
        })()
      : "unavailable until a fresh quote exists";

  const quoteAge =
    quote.quoteAgeSeconds === null
      ? "not loaded"
      : `${quote.quoteAgeSeconds}s`;

  const priceImpact = SEPOLIA_DEMO_MODE
    ? "estimate only (demo)"
    : quoteIsFresh && quote.protectedQuote.status === "available"
      ? "from protected pool quote"
      : "unavailable";

  return (
    <div className="trade-layout">
      <section>
        <Kicker>Protected swap</Kicker>
        <h1 className="page-title">Swap</h1>
        <p className="sub">
          Route: MEVShield protected pool ({poolLabel}). {TOKEN_NETWORK_LABEL}{" "}
          test tokens only; no USD values are shown.
        </p>

        {SWAP_POOL_CONFIGURATION.status === "unconfigured" && (
          <div className="callout-slot" role="alert">
            <RiskCallout heading="Pool not configured">
              {SWAP_POOL_CONFIGURATION.message}
            </RiskCallout>
          </div>
        )}

        <SwapInputs
          inputToken={inputToken}
          outputToken={outputToken}
          inputAmount={inputAmount}
          inputBalance={inputTokenBalance}
          swapTokens={SWAP_TOKENS}
          demoMode={SEPOLIA_DEMO_MODE}
          demoEstimateBaseUnits={demoEstimateBaseUnits}
          quoteIsFresh={quoteIsFresh}
          protectedQuote={quote.protectedQuote}
          routeDirection={routeDirection}
          onInputAmountChange={onInputAmountChange}
          onInputTokenChange={(next) => {
            if (next === outputToken) return;
            trade.setInputToken(next);
            trade.resetSwapFlow();
          }}
          onOutputTokenChange={(next) => {
            if (next === inputToken) return;
            trade.setOutputToken(next);
            trade.resetSwapFlow();
          }}
          onSwitchDirection={switchSwapDirection}
        />

        <div className="meta">
          <span>Pool · {poolLabel}</span>
          <span className="mono">min {minimumOutput}</span>
        </div>

        <div className="control-row">
          <span className="control-label">Slippage</span>
          <div className="chip-row">
            {SLIPPAGE_PRESETS.map((preset) => (
              <Button
                key={preset.bps}
                variant="chip"
                selected={slippageBps === preset.bps}
                onClick={() => {
                  setSlippageBps(preset.bps);
                  trade.resetSwapFlow();
                }}
              >
                {preset.label}
              </Button>
            ))}
            <Button
              variant="chip"
              onClick={() => void quote.inspectProtectedPool()}
            >
              Refresh quote
            </Button>
          </div>
          {!SEPOLIA_DEMO_MODE && (
            <label className="field control-custom">
              <span>Custom (bps)</span>
              <input
                className="input"
                type="number"
                min={0}
                max={9999}
                value={slippageBps}
                onChange={(event) => {
                  setSlippageBps(Number(event.target.value));
                  trade.resetSwapFlow();
                }}
              />
            </label>
          )}
        </div>

        <StatLine label="Quote age" mono>
          {quoteAge}
        </StatLine>
        <StatLine label="Price impact" mono>
          {priceImpact}
        </StatLine>
        <StatLine label="Gas" mono>
          see top bar (network estimate)
        </StatLine>

        {inputToken === "ETH" && (
          <p className="note">
            The balance above is your <strong>WETH</strong> balance, because the
            protected swap spends WETH, not native ETH. Unwrapped ETH is not
            touched. Wrap it first on the{" "}
            <Link className="link" to="/portfolio">
              Portfolio
            </Link>{" "}
            page.
          </p>
        )}

        <div className="actions">
          <Button
            variant="primary"
            wide
            disabled={primaryDisabled}
            onClick={() => void onPrimaryClick()}
          >
            {primaryStep === "check"
              ? policy.isPreviewingRisk
                ? "Checking protection..."
                : "Check protection"
              : policy.isCreatingPolicy
                ? "Signing policy..."
                : "Sign policy and swap"}
          </Button>
          {policy.policy?.registered && (
            <Button
              variant="primary"
              wide
              disabled={
                !swapReadiness.canExecute ||
                execution.isExecuting ||
                policy.isCreatingPolicy
              }
              onClick={() => void execution.executeProtectedSwap()}
            >
              {execution.isExecuting
                ? "Executing..."
                : SEPOLIA_DEMO_MODE
                  ? "Execute demo swap (gate may block)"
                  : "Execute protected swap"}
            </Button>
          )}
        </div>

        {checklist.length > 0 && (
          <div className="callout-slot" aria-live="polite">
            <RiskCallout heading="Still needed before signing">
              <ul>
                {checklist.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </RiskCallout>
          </div>
        )}

        <p className="note" role="status" aria-live="polite">
          {policy.actionStatus}
        </p>
      </section>

      <ShieldReport
        phase={phase}
        notice={
          SEPOLIA_DEMO_MODE ? (
            <RiskCallout heading="Demo estimate">
              Demo estimate assumes {DEMO_USDC_PER_WETH.toString()} USDC per
              WETH. The signed minimum is 1 base unit only.
            </RiskCallout>
          ) : undefined
        }
        footer={
          <>
            <p className="nav-label">Lifecycle</p>
            <div className="toggle-list">
              <ToggleRow label="Quoted" on={lifecycleQuoted} disabled />
              <ToggleRow
                label="Policy registered"
                on={lifecycleRegistered}
                disabled
              />
              <ToggleRow label="Executed" on={lifecycleExecuted} disabled />
              <ToggleRow label="Consumed" on={lifecycleExecuted} disabled />
            </div>
          </>
        }
      >
        {phase === "idle" && (
          <p className="sub">
            Enter an amount and check protection. The risk estimate and the
            policy this swap would sign appear here.
          </p>
        )}

        {riskMatchesInputs && policy.riskPreview && (
          <>
            <RiskCallout heading="Public route risk">
              On a public route a bot can trade ahead of this fill. The figures
              below are a deterministic MVP estimate for this amount and
              direction, not live market analysis.
            </RiskCallout>
            <StatLine label="Risk level" mono>
              {policy.riskPreview.riskLevel}
            </StatLine>
            <StatLine label="Model" mono>
              {policy.riskPreview.model}
            </StatLine>
            <MiniPair
              left={{
                label: "Max loss bound",
                value: `${formatBaseUnits(
                  policy.riskPreview.maxLoss,
                  SWAP_TOKENS[inputToken].decimals,
                )} ${SWAP_TOKENS[inputToken].poolSymbol}`,
              }}
              right={{
                label: "Max fee bound",
                value: `${formatBaseUnits(
                  policy.riskPreview.maxFee,
                  SWAP_TOKENS[inputToken].decimals,
                )} ${SWAP_TOKENS[inputToken].poolSymbol}`,
              }}
            />
            <Delta
              direction="loss"
              label="Estimated loss (model)"
              value={`${formatBaseUnits(
                policy.riskPreview.estimatedLoss,
                SWAP_TOKENS[inputToken].decimals,
              )} ${SWAP_TOKENS[inputToken].poolSymbol}`}
            />
            <p className="note">{policy.riskPreview.disclaimer}</p>
          </>
        )}

        {(phase === "risk" || policy.policy) && (
          <PolicyBox title="What signing will lock">
            <StatLine label="slippageBps" mono>
              {slippageBps}
            </StatLine>
            <StatLine label="minAmountOut" mono>
              {minimumOutput}
            </StatLine>
            <StatLine label="pool" mono>
              {poolLabel}
            </StatLine>
          </PolicyBox>
        )}

        {policy.policy && (
          <>
            <p className="note">
              The policy is registered on-chain. The swap itself follows.
            </p>
            <PolicyBox title="Registered policy">
              <StatLine label="poolId" mono>
                {shortAddress(policy.policy.policy.poolId)}
              </StatLine>
              <StatLine label="trader" mono>
                {shortAddress(policy.policy.policy.trader)}
              </StatLine>
              <StatLine label="nonce" mono>
                {policy.policy.policy.nonce}
              </StatLine>
              <StatLine label="expiry" mono>
                {policy.policy.policy.expiry}
              </StatLine>
              <StatLine label="maxLoss" mono>
                {formatBaseUnits(
                  policy.policy.policy.maxLoss,
                  SWAP_TOKENS[inputToken].decimals,
                )}{" "}
                {SWAP_TOKENS[inputToken].poolSymbol}
              </StatLine>
              <StatLine label="maxFee" mono>
                {formatBaseUnits(
                  policy.policy.policy.maxFee,
                  SWAP_TOKENS[inputToken].decimals,
                )}{" "}
                {SWAP_TOKENS[inputToken].poolSymbol}
              </StatLine>
              <StatLine label="Signed minimum output" mono tone="gain">
                {formatBaseUnits(
                  policy.policy.policy.minAmountOut,
                  SWAP_TOKENS[outputToken].decimals,
                )}{" "}
                {SWAP_TOKENS[outputToken].poolSymbol}
              </StatLine>
            </PolicyBox>
            {policy.policy.txHash && (
              <p className="note">
                <ExplorerLink txHash={policy.policy.txHash}>
                  Policy registration on the explorer
                </ExplorerLink>
              </p>
            )}
          </>
        )}

        {phase === "receipt" && execution.execution && policy.policy && (
          <>
            <KeptBox
              label="Signed minimum output"
              value={formatBaseUnitsWithSymbol(
                policy.policy.policy.minAmountOut,
                SWAP_TOKENS[outputToken].decimals,
                SWAP_TOKENS[outputToken].poolSymbol,
              )}
              detail={shortAddress(execution.execution.txHash)}
              note="The floor the registered policy guaranteed. Compare it with the balance that actually arrived in the wallet. Sepolia test tokens, so no USD value is shown."
            />
            <StatLine label="Policy status" tone="gain">
              registered and executed
            </StatLine>
            <StatLine label="Policy ID" mono>
              {shortAddress(execution.execution.policyId)}
            </StatLine>
            <StatLine label="Block" mono>
              {execution.execution.blockNumber}
            </StatLine>
            <StatLine label="Payer" mono>
              {shortAddress(execution.execution.payer)}
            </StatLine>
            <StatLine label="Recipient" mono>
              {shortAddress(execution.execution.recipient)}
            </StatLine>
            <div className="actions">
              {explorerTxUrl(execution.execution.txHash) ? (
                <a
                  className="btn btn--primary btn--wide"
                  href={explorerTxUrl(execution.execution.txHash) as string}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on {EXPLORER_NAME}
                </a>
              ) : (
                <p className="note">
                  This chain has no block explorer, so the receipt is the only
                  record of the transaction.
                </p>
              )}
              <Link className="btn btn--text" to="/activity">
                Open activity
              </Link>
            </div>
          </>
        )}
      </ShieldReport>
    </div>
  );
}
