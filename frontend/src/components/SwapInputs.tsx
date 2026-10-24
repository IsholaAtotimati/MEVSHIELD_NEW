import { formatUnits } from "viem";
import type { ProtectedQuote } from "../lib/protectedQuote";
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
  return (
    <div className="swap-inputs">
      <label>
        You pay · {swapTokens[inputToken].displayName}
        <div className="swap-input-row">
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder={`Amount in ${swapTokens[inputToken].poolSymbol}`}
            value={inputAmount}
            onChange={(event) => onInputAmountChange(event.target.value)}
            aria-label={`Amount to pay in ${swapTokens[inputToken].poolSymbol}`}
          />
          <select
            value={inputToken}
            onChange={(event) => onInputTokenChange(event.target.value as SwapTokenSymbol)}
            aria-label="Token to pay"
          >
            <option value="ETH" disabled={outputToken === "ETH"}>ETH (Sepolia)</option>
            <option value="USDC" disabled={outputToken === "USDC"}>USDC (Sepolia)</option>
          </select>
        </div>
      </label>
      <SwapDirectionButton
        routeDirection={routeDirection}
        onSwitchDirection={onSwitchDirection}
      />
      <label>
        You receive · {swapTokens[outputToken].displayName}
        <div className="swap-input-row">
          <input
            readOnly
            type="text"
            value={
              demoMode && demoEstimateBaseUnits !== null
                ? formatUnits(demoEstimateBaseUnits, swapTokens[outputToken].decimals)
                : quoteIsFresh && protectedQuote.status === "available"
                ? formatUnits(protectedQuote.amountOutBaseUnits, swapTokens[outputToken].decimals)
                : ""
            }
            placeholder={
              demoMode
                ? `Demo estimate unavailable (${swapTokens[outputToken].poolSymbol})`
                : `Quote unavailable (${swapTokens[outputToken].poolSymbol})`
            }
            aria-label={`${demoMode ? "Demo estimated" : "Quoted"} output amount in ${swapTokens[outputToken].poolSymbol}`}
          />
          <select
            value={outputToken}
            onChange={(event) => onOutputTokenChange(event.target.value as SwapTokenSymbol)}
            aria-label="Token to receive"
          >
            <option value="ETH" disabled={inputToken === "ETH"}>ETH (Sepolia)</option>
            <option value="USDC" disabled={inputToken === "USDC"}>USDC (Sepolia)</option>
          </select>
        </div>
      </label>
    </div>
  );
}
