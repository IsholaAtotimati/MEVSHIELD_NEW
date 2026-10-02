import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from "viem";

import { SEPOLIA_CHAIN } from "./contracts";

export const publicClient = createPublicClient({
  chain: SEPOLIA_CHAIN,
  transport: http(
    "https://ethereum-sepolia-rpc.publicnode.com",
  ),
});

export function getWalletClient() {
  if (!window.ethereum) {
    throw new Error(
      "MetaMask or another injected wallet is required.",
    );
  }

  return createWalletClient({
    chain: SEPOLIA_CHAIN,
    transport: custom(window.ethereum),
  });
}
