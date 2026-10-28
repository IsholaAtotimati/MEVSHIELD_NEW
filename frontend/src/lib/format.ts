/**
 * Display formatting for addresses, token amounts, and Sepolia explorer links.
 *
 * Single responsibility: turn on-chain values into the strings the UI renders.
 * Nothing here fetches, validates a backend body, or compares addresses for
 * gating decisions — those live in `apiValidation.ts` and the hooks.
 *
 * Consumers: TradePage, PortfolioPage, PoliciesPage, ActivityPage,
 * NetworkPage, SwapInputs, AllowanceCard, TopBar, usePolicy.
 * Use these instead of calling `viem`'s `formatUnits` directly in JSX.
 */
import { formatUnits } from "viem";

export function shortAddress(address?: string | null): string {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function etherscanTxUrl(txHash: string): string {
  return `https://sepolia.etherscan.io/tx/${txHash}`;
}

export function etherscanAddressUrl(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}

/**
 * Display helper for token base units. Truncates (never rounds) to
 * `maxFractionDigits`, drops trailing zeros, and returns "—" when the amount
 * has not loaded yet.
 */
export function formatTokenAmount(
  baseUnits: bigint | null,
  decimals: number,
  maxFractionDigits = 6,
): string {
  if (baseUnits === null) return "—";

  const formatted = formatUnits(baseUnits, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const visible = fraction.slice(0, maxFractionDigits).replace(/0+$/, "");

  if (visible) return `${whole}.${visible}`;
  if (baseUnits > 0n && whole === "0") {
    return `<${formatUnits(1n, Math.min(maxFractionDigits, decimals))}`;
  }
  return whole;
}

/**
 * Full-precision display for a base-unit value the backend sent as a decimal
 * string, e.g. `policy.maxLoss` or `riskPreview.estimatedLoss`.
 *
 * Backend numeric fields arrive as strings, so this keeps the `BigInt` parse in
 * one place and renders "—" for a malformed value instead of throwing inside
 * render. Unlike `formatTokenAmount` it does not truncate, so bound values the
 * user is meant to verify are shown exactly.
 */
export function formatBaseUnits(
  baseUnits: string | bigint | null | undefined,
  decimals: number,
): string {
  if (baseUnits === null || baseUnits === undefined) return "—";
  try {
    return formatUnits(BigInt(baseUnits), decimals);
  } catch {
    return "—";
  }
}

/** `formatBaseUnits` plus the pool symbol, e.g. "1.5 USDC". */
export function formatBaseUnitsWithSymbol(
  baseUnits: string | bigint | null | undefined,
  decimals: number,
  symbol: string,
): string {
  const amount = formatBaseUnits(baseUnits, decimals);
  return amount === "—" ? amount : `${amount} ${symbol}`;
}
