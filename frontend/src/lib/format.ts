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
