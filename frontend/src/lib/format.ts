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
