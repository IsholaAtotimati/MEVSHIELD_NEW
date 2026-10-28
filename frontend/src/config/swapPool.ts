import type { Address, Hex } from "viem";

import { IS_LOCAL_CHAIN } from "../config/chain";
import { CHAIN_ID, CONTRACTS } from "../lib/contracts";
import {
  calculatePoolId,
  sortCurrencies,
  type PoolExpectation,
  type PoolKey,
} from "../lib/protectedQuote";
import {
  localPoolTokenAddressErrorMessage,
  resolvePoolTokenAddresses,
} from "./chainEnv";

export type TokenSymbol = "ETH" | "USDC";

function readLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Pool token addresses for the selected chain, or an explicit statement that
 * the operator has not supplied them.
 *
 * The local chain has no built-in pool token addresses on purpose.
 * `script/SetupBackendSwap.s.sol` deploys a fresh mock pair to anvil, so a
 * compiled-in local default could only ever be a guess about a chain this build
 * has not seen. In a swap app that guess is worse than an absence: a wrong
 * address reads and trades against nothing and fails silently, while a missing
 * one is reported.
 *
 * The failure is not thrown at module scope. Throwing here would crash the app
 * before React renders and leave the operator with a blank page instead of a
 * message. The unconfigured state is carried into the readiness gate, which
 * reports the app as not ready and renders `message`.
 */
export type SwapPoolConfiguration =
  | {
      status: "configured";
      token0: Address;
      token1: Address;
      poolKey: PoolKey;
      poolId: Hex;
      expectation: PoolExpectation;
    }
  | {
      status: "unconfigured";
      missingVariables: readonly string[];
      message: string;
    };

function buildSwapPoolConfiguration(): SwapPoolConfiguration {
  const resolution = resolvePoolTokenAddresses({
    chainId: CHAIN_ID,
    token0: import.meta.env.VITE_TOKEN0_ADDRESS,
    token1: import.meta.env.VITE_TOKEN1_ADDRESS,
  });

  if (resolution.status === "unconfigured") {
    return {
      status: "unconfigured",
      missingVariables: resolution.missingVariables,
      message: localPoolTokenAddressErrorMessage(resolution.missingVariables),
    };
  }

  const token0 = resolution.addresses.token0 as Address;
  const token1 = resolution.addresses.token1 as Address;
  const poolKey: PoolKey = {
    ...sortCurrencies(token0, token1),
    fee: 3000,
    tickSpacing: 60,
    hooks: CONTRACTS.mevShieldHook,
  };
  const poolId = calculatePoolId(poolKey);

  return {
    status: "configured",
    token0,
    token1,
    poolKey,
    poolId,
    expectation: {
      chainId: CHAIN_ID,
      poolManager: CONTRACTS.poolManager,
      hook: CONTRACTS.mevShieldHook,
      hookAuthorization: CONTRACTS.poolAuthorization,
      poolKey,
      poolId,
    },
  };
}

export const SWAP_POOL_CONFIGURATION: SwapPoolConfiguration =
  buildSwapPoolConfiguration();

/**
 * First pool token. `null` when the local chain left it unconfigured, so callers
 * must check instead of passing it straight into a read.
 */
export const WETH9_ADDRESS: Address | null =
  SWAP_POOL_CONFIGURATION.status === "configured"
    ? SWAP_POOL_CONFIGURATION.token0
    : null;

/** Second pool token, `null` on the same terms as `WETH9_ADDRESS`. */
export const QUOTE_TOKEN_ADDRESS: Address | null =
  SWAP_POOL_CONFIGURATION.status === "configured"
    ? SWAP_POOL_CONFIGURATION.token1
    : null;

/**
 * Token decimals. Sepolia USDC has 6; both local mock tokens have 18. Getting
 * this wrong would misprice every amount, so it follows the chain rather than
 * being guessed per address.
 */
const QUOTE_TOKEN_DECIMALS = IS_LOCAL_CHAIN ? 18 : 6;

export const SWAP_TOKENS: Record<
  TokenSymbol,
  {
    address: Address | null;
    decimals: number;
    poolSymbol: string;
    displayName: string;
  }
> = {
  ETH: {
    address: WETH9_ADDRESS,
    decimals: 18,
    poolSymbol: readLabel(
      import.meta.env.VITE_TOKEN0_SYMBOL,
      IS_LOCAL_CHAIN ? "MBA" : "WETH",
    ),
    displayName: IS_LOCAL_CHAIN
      ? "Local test token A"
      : "Sepolia test ETH (executes as WETH)",
  },
  USDC: {
    address: QUOTE_TOKEN_ADDRESS,
    decimals: QUOTE_TOKEN_DECIMALS,
    poolSymbol: readLabel(
      import.meta.env.VITE_TOKEN1_SYMBOL,
      IS_LOCAL_CHAIN ? "MBB" : "USDC",
    ),
    displayName: IS_LOCAL_CHAIN
      ? "Local test token B"
      : "Sepolia test USDC",
  },
};

/**
 * Pool identity, `null` when the token addresses are unknown. Without both
 * addresses there is no pool key and no pool id, so consumers must treat these
 * as possibly absent rather than assume a pool exists.
 */
export const SWAP_POOL_KEY: PoolKey | null =
  SWAP_POOL_CONFIGURATION.status === "configured"
    ? SWAP_POOL_CONFIGURATION.poolKey
    : null;

export const SWAP_POOL_ID: Hex | null =
  SWAP_POOL_CONFIGURATION.status === "configured"
    ? SWAP_POOL_CONFIGURATION.poolId
    : null;

export const SWAP_POOL_EXPECTATION: PoolExpectation | null =
  SWAP_POOL_CONFIGURATION.status === "configured"
    ? SWAP_POOL_CONFIGURATION.expectation
    : null;

export const MIN_SQRT_PRICE_LIMIT_X96 = 4295128740n;
export const MAX_SQRT_PRICE_LIMIT_X96 =
  1461446703485210103287273052203988822378723970341n;
