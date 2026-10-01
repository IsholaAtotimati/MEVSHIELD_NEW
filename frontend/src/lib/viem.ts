import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from "viem";

import { ANVIL_CHAIN } from "./contracts";

export const publicClient = createPublicClient({
  chain: ANVIL_CHAIN,
  transport: http("http://127.0.0.1:8545"),
});

export function getWalletClient() {
  if (!window.ethereum) {
    throw new Error("MetaMask or another injected wallet is required.");
  }

  return createWalletClient({
    chain: ANVIL_CHAIN,
    transport: custom(window.ethereum),
  });
}