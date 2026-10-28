import type { Address, Hex } from "viem";

import { IS_LOCAL_CHAIN } from "../config/chain";
import { CHAIN_ID, CONTRACTS } from "../lib/contracts";
import {
  calculatePoolId,
  sortCurrencies,
  type PoolExpectation,
} from "../lib/protectedQuote";

export type TokenSymbol = "ETH" | "USDC";

function readAddress(value: string | undefined, fallback: string): Address {
  const trimmed = value?.trim();
  return (trimmed ? trimmed : fallback) as Address;
}

function readLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

/**
 * Sepolia WETH9. The pool trades WETH, so the "ETH" entry is really WETH.
 *
 * On the local stack `script/SetupBackendSwap.s.sol` deploys two 18-decimal
 * `MockERC20` tokens instead, so the defaults only apply when the chain is
 * Sepolia. A local build must supply `VITE_TOKEN0_ADDRESS` /
 * `VITE_TOKEN1_ADDRESS` (docker-compose does this from the deploy output).
 */
export const WETH9_ADDRESS = readAddress(
  import.meta.env.VITE_TOKEN0_ADDRESS,
  IS_LOCAL_CHAIN
    ? "0x610178dA211FEF7D417bC0e6FeD39F05609AD788"
    : "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
);

/** Second pool token. USDC on Sepolia; the second mock token locally. */
export const QUOTE_TOKEN_ADDRESS = readAddress(
  import.meta.env.VITE_TOKEN1_ADDRESS,
  IS_LOCAL_CHAIN
    ? "0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e"
    : "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
);

/**
 * Token decimals. Sepolia USDC has 6; both local mock tokens have 18. Getting
 * this wrong would misprice every amount, so it follows the chain rather than
 * being guessed per address.
 */
const QUOTE_TOKEN_DECIMALS = IS_LOCAL_CHAIN ? 18 : 6;

export const SWAP_TOKENS: Record<
  TokenSymbol,
  {
    address: Address;
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

export const SWAP_POOL_KEY = {
  ...sortCurrencies(SWAP_TOKENS.ETH.address, SWAP_TOKENS.USDC.address),
  fee: 3000,
  tickSpacing: 60,
  hooks: CONTRACTS.mevShieldHook,
};

export const SWAP_POOL_ID: Hex = calculatePoolId(SWAP_POOL_KEY);

export const SWAP_POOL_EXPECTATION: PoolExpectation = {
  chainId: CHAIN_ID,
  poolManager: CONTRACTS.poolManager,
  hook: CONTRACTS.mevShieldHook,
  hookAuthorization: CONTRACTS.poolAuthorization,
  poolKey: SWAP_POOL_KEY,
  poolId: SWAP_POOL_ID,
};

export const MIN_SQRT_PRICE_LIMIT_X96 = 4295128740n;
export const MAX_SQRT_PRICE_LIMIT_X96 =
  1461446703485210103287273052203988822378723970341n;
