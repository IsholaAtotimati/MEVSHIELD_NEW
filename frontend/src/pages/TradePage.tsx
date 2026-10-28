import { Link } from "react-router-dom";

import { SEPOLIA_DEMO_MODE } from "../config/env";
import { SWAP_POOL_ID, SWAP_TOKENS } from "../config/swapPool";
import { TOKEN_NETWORK_LABEL } from "../config/chain";
import SwapInputs from "../components/SwapInputs";
import { useTrade } from "../context/TradeContext";
import {
  calculateMinimumOutput,
  DEMO_MIN_AMOUNT_OUT,
  DEMO_USDC_PER_WETH,
} from "../lib/protectedQuote";
import ExplorerLink from "../components/ExplorerLink";
import {
  formatBaseUnits,
  formatBaseUnitsWithSymbol,
  shortAddress,
} from "../lib/format";
import Metric from "../components/Metric";

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

  return (
    <div className="trade-layout">
      <section className="card trade-swap-card">
        <h1>Protected swap</h1>
        <p className="muted">
          Route: MEVShield protected pool ({shortAddress(SWAP_POOL_ID)}).{" "}
          {TOKEN_NETWORK_LABEL} test tokens only; no USD values are shown.
        </p>

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

        <div className="slippage-row">
          <span>Slippage</span>
          <div className="slippage-presets">
            {SLIPPAGE_PRESETS.map((preset) => (
              <button
                key={preset.bps}
                type="button"
                className={
                  slippageBps === preset.bps ? "chip active" : "chip"
                }
                onClick={() => {
                  setSlippageBps(preset.bps);
                  trade.resetSwapFlow();
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {!SEPOLIA_DEMO_MODE && (
            <label className="slippage-custom">
              Custom (bps)
              <input
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

        <div className="quote-meta">
          <div>
            Quote age:{" "}
            {quote.quoteAgeSeconds === null
              ? "not loaded"
              : `${quote.quoteAgeSeconds}s`}
          </div>
          <button
            type="button"
            className="chip"
            onClick={() => void quote.inspectProtectedPool()}
          >
            Refresh quote
          </button>
          <div>
            Price impact:{" "}
            {SEPOLIA_DEMO_MODE
              ? "estimate only (demo)"
              : quoteIsFresh && quote.protectedQuote.status === "available"
                ? "from protected pool quote"
                : "unavailable"}
          </div>
          <div>Gas: see top bar (network estimate)</div>
        </div>

        <p className="amount-conversion">
          Minimum output:{" "}
          {SEPOLIA_DEMO_MODE
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
              : "unavailable until a fresh quote exists"}
        </p>

        {inputToken === "ETH" && (
          <p className="muted">
            The balance above is your <strong>WETH</strong> balance, because the
            protected swap spends WETH, not native ETH. Unwrapped ETH is not
            touched — wrap it first on the <Link to="/portfolio">Portfolio</Link>{" "}
            page.
          </p>
        )}

        <button
          type="button"
          className="primary primary-flow"
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
        </button>

        {checklist.length > 0 && (
          <ul className="readiness-checklist" aria-live="polite">
            {checklist.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}

        <p className="action-status" role="status" aria-live="polite">
          {policy.actionStatus}
        </p>

        {policy.policy?.registered && (
          <button
            type="button"
            className="primary execute-button"
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
          </button>
        )}

        {execution.execution && policy.policy && (
          <div className="success-panel">
            <h3>Swap receipt</h3>
            <p>
              Received amount: check wallet balance. Signed minimum:{" "}
              {formatBaseUnitsWithSymbol(
                policy.policy.policy.minAmountOut,
                SWAP_TOKENS[outputToken].decimals,
                SWAP_TOKENS[outputToken].poolSymbol,
              )}
            </p>
            <p>Policy status: registered and executed</p>
            <ExplorerLink txHash={execution.execution.txHash}>
              View on explorer
            </ExplorerLink>
          </div>
        )}
      </section>

      <section className="card shield-report">
        <h2>Shield report</h2>

        {SEPOLIA_DEMO_MODE && (
          <p className="warning" role="alert">
            Demo estimate assumes {DEMO_USDC_PER_WETH.toString()} USDC per WETH.
            The signed minimum is 1 base unit only.
          </p>
        )}

        {riskMatchesInputs && policy.riskPreview && (
          <div className="risk-grid">
            <Metric label="Risk level" value={policy.riskPreview.riskLevel} />
            <Metric
              label="Max loss bound"
              value={formatBaseUnits(
                policy.riskPreview.maxLoss,
                SWAP_TOKENS[inputToken].decimals,
              )}
            />
            <Metric
              label="Max fee bound"
              value={formatBaseUnits(
                policy.riskPreview.maxFee,
                SWAP_TOKENS[inputToken].decimals,
              )}
            />
            <Metric
              label="Estimated loss (model)"
              value={formatBaseUnits(
                policy.riskPreview.estimatedLoss,
                SWAP_TOKENS[inputToken].decimals,
              )}
            />
          </div>
        )}

        {policy.policy && (
          <>
            <div className="risk-grid">
              <Metric
                label="Signed minimum output"
                value={formatBaseUnits(
                  policy.policy.policy.minAmountOut,
                  SWAP_TOKENS[outputToken].decimals,
                )}
              />
              <Metric label="Nonce" value={policy.policy.policy.nonce} />
            </div>
            {policy.policy.txHash && (
              <ExplorerLink txHash={policy.policy.txHash}>
                Policy registration on explorer
              </ExplorerLink>
            )}
          </>
        )}

        <ol className="lifecycle-steps">
          <li className={lifecycleQuoted ? "done" : ""}>Quoted</li>
          <li className={lifecycleRegistered ? "done" : ""}>
            Policy registered
          </li>
          <li className={lifecycleExecuted ? "done" : ""}>Executed</li>
          <li className={lifecycleExecuted ? "done" : ""}>Consumed</li>
        </ol>
      </section>
    </div>
  );
}
