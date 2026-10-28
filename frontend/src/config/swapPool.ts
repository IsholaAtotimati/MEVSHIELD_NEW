import type { Address, Hex } from "viem";

import { CHAIN_ID, CONTRACTS } from "../lib/contracts";
import {
  calculatePoolId,
  sortCurrencies,
  type PoolExpectation,
} from "../lib/protectedQuote";

export type TokenSymbol = "ETH" | "USDC";

export const WETH9_ADDRESS =
  "0xfff9976782d46cc05630d1f6ebab18b2324d6b14" as Address;

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
    poolSymbol: "WETH",
    displayName: "Sepolia test ETH (executes as WETH)",
  },
  USDC: {
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6,
    poolSymbol: "USDC",
    displayName: "Sepolia test USDC",
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
