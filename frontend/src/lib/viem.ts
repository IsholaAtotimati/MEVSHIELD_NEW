import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { CHAIN, RPC_URL } from "../config/chain";
import {
  ANVIL_ACCOUNT_KEY,
  injectedWalletMissingMessage,
  planConnectAnvil,
} from "./walletConnect";

type AppWalletClient = ReturnType<typeof createInjectedWallet>;

let localAnvilClient: AppWalletClient | null = null;

function createInjectedWallet() {
  if (!window.ethereum) {
    throw new Error(injectedWalletMissingMessage(CHAIN.id));
  }
  return createWalletClient({
    chain: CHAIN,
    transport: custom(window.ethereum),
  });
}

/**
 * Read client. The chain and transport come from `config/chain.ts`, which
 * defaults to Sepolia and only changes when a `VITE_CHAIN_ID` / `VITE_RPC_URL`
 * is supplied at build time.
 */
export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

/** Sign with anvil account #0. No browser extension required. Local chain only. */
export function connectLocalAnvilAccount() {
  const plan = planConnectAnvil(CHAIN.id);
  if (plan.kind === "refuse") {
    throw new Error(plan.message);
  }
  const account = privateKeyToAccount(ANVIL_ACCOUNT_KEY);
  localAnvilClient = createWalletClient({
    account,
    chain: CHAIN,
    transport: http(RPC_URL),
  }) as unknown as AppWalletClient;
  return account.address;
}

/** Drop the anvil signer so the next connect can use a browser wallet again. */
export function disconnectLocalAnvilAccount() {
  localAnvilClient = null;
}

export function getWalletClient(): AppWalletClient {
  if (localAnvilClient) return localAnvilClient;
  return createInjectedWallet();
}
