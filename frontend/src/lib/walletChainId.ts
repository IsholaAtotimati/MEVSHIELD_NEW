export function parseWalletChainId(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return null;
  const chainId = Number(BigInt(value));
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}
