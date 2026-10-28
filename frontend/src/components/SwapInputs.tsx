import { formatUnits } from "viem";

import { TOKEN_NETWORK_LABEL } from "../config/chain";
import { formatTokenAmount } from "../lib/format";
import type { ProtectedQuote } from "../lib/protectedQuote";
import SwapDirectionButton from "./SwapDirectionButton";

export type SwapTokenSymbol = "ETH" | "USDC";

export type SwapTokenConfig = {
  /**
   * `null` on a local build whose token addresses were not supplied. This
   * component only renders labels and decimals, so it never reads the address;
   * the trading paths check for `null` before reading or writing.
   */
  address: `0x${string}` | null;
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

  return (
    <div className="swap-inputs">
      <div className="swap-field">
        <label htmlFor="swap-pay-amount">
          You pay · {payToken.displayName}
        </label>
        <div className="swap-input-row">
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
            value={inputToken}
            onChange={(event) =>
              onInputTokenChange(event.target.value as SwapTokenSymbol)
            }
            aria-label="Token to pay"
          >
            <option value="ETH" disabled={outputToken === "ETH"}>
              ETH ({TOKEN_NETWORK_LABEL})
            </option>
            <option value="USDC" disabled={outputToken === "USDC"}>
              USDC ({TOKEN_NETWORK_LABEL})
            </option>
          </select>
        </div>
        <div className="swap-balance-row">
          <span id="swap-pay-balance">
            Balance: {formatTokenAmount(inputBalance, payToken.decimals)}{" "}
            {payToken.poolSymbol}
          </span>
          <button
            type="button"
            className="chip"
            disabled={!canUseMax}
            aria-label={`Use full ${payToken.poolSymbol} balance`}
            onClick={() =>
              onInputAmountChange(
                formatUnits(inputBalance ?? 0n, payToken.decimals),
              )
            }
          >
            Max
          </button>
        </div>
      </div>
      <SwapDirectionButton
        routeDirection={routeDirection}
        onSwitchDirection={onSwitchDirection}
      />
      <div className="swap-field">
        <label htmlFor="swap-receive-amount">
          You receive · {receiveToken.displayName}
        </label>
        <div className="swap-input-row">
          <input
            id="swap-receive-amount"
            readOnly
            type="text"
            value={
              demoMode && demoEstimateBaseUnits !== null
                ? formatUnits(demoEstimateBaseUnits, receiveToken.decimals)
                : quoteIsFresh && protectedQuote.status === "available"
                  ? formatUnits(
                      protectedQuote.amountOutBaseUnits,
                      receiveToken.decimals,
                    )
                  : ""
            }
            placeholder={
              demoMode
                ? `Demo estimate unavailable (${receiveToken.poolSymbol})`
                : `Quote unavailable (${receiveToken.poolSymbol})`
            }
            aria-label={`${demoMode ? "Demo estimated" : "Quoted"} output amount in ${receiveToken.poolSymbol}`}
          />
          <select
            value={outputToken}
            onChange={(event) =>
              onOutputTokenChange(event.target.value as SwapTokenSymbol)
            }
            aria-label="Token to receive"
          >
            <option value="ETH" disabled={inputToken === "ETH"}>
              ETH ({TOKEN_NETWORK_LABEL})
            </option>
            <option value="USDC" disabled={inputToken === "USDC"}>
              USDC ({TOKEN_NETWORK_LABEL})
            </option>
          </select>
        </div>
      </div>
    </div>
  );
}
