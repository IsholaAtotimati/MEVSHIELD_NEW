import { formatUnits } from "viem";

import { formatTokenAmount } from "../lib/format";
import type { ProtectedQuote } from "../lib/protectedQuote";
import Button from "./Button";
import SwapDirectionButton from "./SwapDirectionButton";

export type SwapTokenSymbol = "ETH" | "USDC";

export type SwapTokenConfig = {
  address: `0x${string}`;
  decimals: number;
  poolSymbol: string;
  displayName: string;
};

type SwapInputsProps = {
  inputToken: SwapTokenSymbol;
  outputToken: SwapTokenSymbol;
  inputAmount: string;
  /**
   * ERC-20 balance of the selected pay token. For ETH this is the WETH balance,
   * because WETH is what the pool and router actually move.
   */
  inputBalance: bigint | null;
  swapTokens: Record<SwapTokenSymbol, SwapTokenConfig>;
  demoMode: boolean;
  demoEstimateBaseUnits: bigint | null;
  quoteIsFresh: boolean;
  protectedQuote: ProtectedQuote;
  routeDirection: string;
  onInputAmountChange: (value: string) => void;
  onInputTokenChange: (token: SwapTokenSymbol) => void;
  onOutputTokenChange: (token: SwapTokenSymbol) => void;
  onSwitchDirection: () => void;
};

/**
 * The swap ticket from swap.html: one card holding a pay row and a receive
 * row, the direction toggle between them, then the balance line underneath.
 * The receive row takes the mint or bad treatment from the same row styling
 * the mockup uses.
 */
export default function SwapInputs({
  inputToken,
  outputToken,
  inputAmount,
  inputBalance,
  swapTokens,
  demoMode,
  demoEstimateBaseUnits,
  quoteIsFresh,
  protectedQuote,
  routeDirection,
  onInputAmountChange,
  onInputTokenChange,
  onOutputTokenChange,
  onSwitchDirection,
}: SwapInputsProps) {
  const payToken = swapTokens[inputToken];
  const receiveToken = swapTokens[outputToken];
  const canUseMax = inputBalance !== null && inputBalance > 0n;

  const receiveValue =
    demoMode && demoEstimateBaseUnits !== null
      ? formatUnits(demoEstimateBaseUnits, receiveToken.decimals)
      : quoteIsFresh && protectedQuote.status === "available"
        ? formatUnits(protectedQuote.amountOutBaseUnits, receiveToken.decimals)
        : "";

  const receiveTone = receiveValue ? " gain" : "";

  return (
    <div className="ticket">
        <div className="ticket-row">
          <label htmlFor="swap-pay-amount">
            You pay · {payToken.displayName}
          </label>
          <div className="amount">
            <input
              id="swap-pay-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              placeholder={`Amount in ${payToken.poolSymbol}`}
              value={inputAmount}
              onChange={(event) => onInputAmountChange(event.target.value)}
              aria-label={`Amount to pay in ${payToken.poolSymbol}`}
              aria-describedby="swap-pay-balance"
            />
            <select
              className="token-select"
              value={inputToken}
              onChange={(event) =>
                onInputTokenChange(event.target.value as SwapTokenSymbol)
              }
              aria-label="Token to pay"
            >
              <option value="ETH" disabled={outputToken === "ETH"}>
                ETH (Sepolia)
              </option>
              <option value="USDC" disabled={outputToken === "USDC"}>
                USDC (Sepolia)
              </option>
            </select>
          </div>
          <div className="ticket-foot">
            <span id="swap-pay-balance">
              Balance: {formatTokenAmount(inputBalance, payToken.decimals)}{" "}
              {payToken.poolSymbol}
            </span>
            <Button
              variant="chip"
              disabled={!canUseMax}
              aria-label={`Use full ${payToken.poolSymbol} balance`}
              onClick={() =>
                onInputAmountChange(
                  formatUnits(inputBalance ?? 0n, payToken.decimals),
                )
              }
            >
              Max
            </Button>
          </div>
        </div>

        <SwapDirectionButton
          routeDirection={routeDirection}
          onSwitchDirection={onSwitchDirection}
        />

        <div className={`ticket-row ticket-row--raised${receiveTone}`}>
          <label htmlFor="swap-receive-amount">
            You receive · {receiveToken.displayName}
          </label>
          <div className="amount">
            <input
              id="swap-receive-amount"
              readOnly
              type="text"
              value={receiveValue}
              placeholder={
                demoMode
                  ? `Demo estimate unavailable (${receiveToken.poolSymbol})`
                  : `Quote unavailable (${receiveToken.poolSymbol})`
              }
              aria-label={`${demoMode ? "Demo estimated" : "Quoted"} output amount in ${receiveToken.poolSymbol}`}
            />
            <select
              className="token-select"
              value={outputToken}
              onChange={(event) =>
                onOutputTokenChange(event.target.value as SwapTokenSymbol)
              }
              aria-label="Token to receive"
            >
              <option value="ETH" disabled={inputToken === "ETH"}>
                ETH (Sepolia)
              </option>
              <option value="USDC" disabled={inputToken === "USDC"}>
                USDC (Sepolia)
              </option>
            </select>
          </div>
        </div>
      </div>
  );
}
