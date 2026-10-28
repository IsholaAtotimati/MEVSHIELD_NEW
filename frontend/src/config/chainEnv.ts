/**
 * Pure resolution rules for the build-time chain configuration.
 *
 * Kept separate from `chain.ts` so they can be unit tested without a bundler:
 * `chain.ts` reads `import.meta.env`, which only exists inside a Vite build.
 *
 * These functions decide *where the client reads from*. They never decide
 * whether an action is permitted.
 */

export const SEPOLIA_CHAIN_ID = 11155111;
export const LOCAL_CHAIN_ID = 31337;

export const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";

/** Local anvil as reached from the browser (host port published by compose). */
export const LOCAL_RPC_URL = "http://localhost:8545";

export const SEPOLIA_EXPLORER_URL = "https://sepolia.etherscan.io";

/** Trimmed value, or undefined when absent or blank. */
export function readEnvValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Parses a chain id.
 *
 * Accepts decimal digits only. A hex string, a negative number, a float or
 * junk all return null rather than a plausible-looking chain, because guessing
 * would silently point the build at the wrong network.
 */
export function parseChainId(value: string | undefined): number | null {
  const configured = readEnvValue(value);
  if (!configured) return null;
  if (!/^\d+$/.test(configured)) return null;
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * Resolves the chain id, falling back to Sepolia.
 *
 * An unset or unparseable `VITE_CHAIN_ID` therefore keeps the build on Sepolia
 * rather than dropping it onto a local chain.
 */
export function resolveChainId(value: string | undefined): number {
  return parseChainId(value) ?? SEPOLIA_CHAIN_ID;
}

/**
 * Resolves the read RPC endpoint.
 *
 * A local chain with no explicit RPC defaults to the local anvil endpoint so a
 * `VITE_CHAIN_ID=31337` build works without further wiring.
 */
export function resolveRpcUrl(
  value: string | undefined,
  chainId: number,
): string {
  const configured = readEnvValue(value);
  if (configured) return configured;
  return chainId === LOCAL_CHAIN_ID ? LOCAL_RPC_URL : SEPOLIA_RPC_URL;
}

/**
 * Resolves the block explorer base URL. A local chain has none unless one is
 * configured, which is what makes explorer links disappear locally instead of
 * pointing at Sepolia for a local transaction.
 */
export function resolveExplorerUrl(
  value: string | undefined,
  chainId: number,
): string | null {
  const configured = readEnvValue(value);
  if (configured) return configured;
  return chainId === LOCAL_CHAIN_ID ? null : SEPOLIA_EXPLORER_URL;
}

/** Human label for the active chain. */
export function resolveChainLabel(chainId: number): string {
  return chainId === LOCAL_CHAIN_ID
    ? `Anvil Local · ${chainId}`
    : `Sepolia · ${chainId}`;
}

/** Chain name used in sentences and error text. */
export function resolveChainName(chainId: number): string {
  return chainId === LOCAL_CHAIN_ID ? "Anvil Local" : "Sepolia";
}
