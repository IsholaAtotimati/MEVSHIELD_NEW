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

/**
 * Sepolia pool tokens: WETH9 and test USDC.
 *
 * These are the published deployment and stay hard-coded so a Sepolia build
 * works with no environment at all. They are the only pool token addresses in
 * the codebase with a built-in default; the local chain has none.
 */
export const SEPOLIA_TOKEN0_ADDRESS = "0xfff9976782d46cc05630d1f6ebab18b2324d6b14";
export const SEPOLIA_TOKEN1_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";

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

/**
 * Environment variables that carry the two pool token addresses.
 *
 * Order matches `token0` / `token1`, and is used in error text.
 */
export const LOCAL_POOL_TOKEN_ADDRESS_VARIABLES = [
  "VITE_TOKEN0_ADDRESS",
  "VITE_TOKEN1_ADDRESS",
] as const;

export type PoolTokenAddresses = { token0: string; token1: string };

/**
 * Result of resolving the pool token addresses.
 *
 * `unconfigured` carries no address at all. That is deliberate: there is no
 * placeholder to fall back to, so a caller cannot accidentally treat a missing
 * local deployment as a real one. It must either fail or report not-ready.
 */
export type PoolTokenAddressResolution =
  | { status: "configured"; addresses: PoolTokenAddresses }
  | { status: "unconfigured"; missingVariables: readonly string[] };

/**
 * Resolves the two pool token addresses for a chain id.
 *
 * Sepolia keeps the published values as its defaults, so a Sepolia build works
 * with no env at all. The local chain has none: `script/SetupBackendSwap.s.sol`
 * deploys a fresh mock pair to anvil on every deploy, so any built-in default
 * would be a guess about a chain the build has not seen. A missing local
 * variable is therefore reported as unconfigured rather than defaulted.
 *
 * The Sepolia pair can be passed in so the caller owns no second copy of it;
 * omitting them uses the module constants.
 */
export function resolvePoolTokenAddresses(input: {
  chainId: number;
  token0: string | undefined;
  token1: string | undefined;
  sepoliaToken0?: string;
  sepoliaToken1?: string;
}): PoolTokenAddressResolution {
  const token0 = readEnvValue(input.token0);
  const token1 = readEnvValue(input.token1);

  if (input.chainId !== LOCAL_CHAIN_ID) {
    return {
      status: "configured",
      addresses: {
        token0: token0 ?? input.sepoliaToken0 ?? SEPOLIA_TOKEN0_ADDRESS,
        token1: token1 ?? input.sepoliaToken1 ?? SEPOLIA_TOKEN1_ADDRESS,
      },
    };
  }

  if (!token0 || !token1) {
    const missingVariables: string[] = [];
    if (!token0) missingVariables.push(LOCAL_POOL_TOKEN_ADDRESS_VARIABLES[0]);
    if (!token1) missingVariables.push(LOCAL_POOL_TOKEN_ADDRESS_VARIABLES[1]);
    return { status: "unconfigured", missingVariables };
  }

  return { status: "configured", addresses: { token0, token1 } };
}

/**
 * Readable failure for a local build with no pool token addresses.
 *
 * Names every missing variable and the one place that is expected to supply
 * them, so the operator does not have to guess or go looking for a default that
 * does not exist.
 */
export function localPoolTokenAddressErrorMessage(
  missingVariables: readonly string[],
): string {
  return (
    `Local chain ${LOCAL_CHAIN_ID} has no default pool token addresses: ` +
    `${missingVariables.join(", ")} ${missingVariables.length === 1 ? "is" : "are"} required. ` +
    `docker-compose supplies these from the deploy output. Set ` +
    `${missingVariables.join(" and ")}, or unset VITE_CHAIN_ID to build against Sepolia.`
  );
}
