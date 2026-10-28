import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from "viem";

import { CHAIN, RPC_URL } from "../config/chain";

/**
 * Read client. The chain and transport come from `config/chain.ts`, which
 * defaults to Sepolia and only changes when a `VITE_CHAIN_ID` / `VITE_RPC_URL`
 * is supplied at build time.
 */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

export function getWalletClient() {
  if (!window.ethereum) {
    throw new Error(
      "MetaMask or another injected wallet is required.",
    );
  }

  return createWalletClient({
    chain: CHAIN,
    transport: custom(window.ethereum),
  });
}
