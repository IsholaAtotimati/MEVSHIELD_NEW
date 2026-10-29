import { LOCAL_CHAIN_ID } from "../config/chainEnv.ts";

/**
 * Anvil's published account #0. The key ships in every Foundry install and is
 * worth nothing. It is offered only when the bundle was built for chain 31337.
 */
export const ANVIL_ACCOUNT_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;

/** Checksummed address of {@link ANVIL_ACCOUNT_KEY}. */
export const ANVIL_ACCOUNT_ADDRESS =
  "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;

export const WALLET_STATUS = {
  connecting: "Connecting...",
  anvil: "Using the local anvil account",
  connected: "Wallet connected",
  disconnected: "Wallet not connected",
  failed: "Wallet connection failed",
  anvilFailed: "Could not use the anvil account",
} as const;

export const WALLET_ERROR = {
  browserRequired: "Install a browser wallet, then click Connect wallet again.",
  noAccount: "The wallet did not return an account.",
  anvilLocalOnly: "The anvil account is only available on the local chain.",
  injectedMissingLocal:
    "No browser wallet is installed. Use the anvil account on this page.",
  injectedMissingOther: "MetaMask or another injected wallet is required.",
} as const;

export type WalletConnectPlan =
  | { kind: "anvil" }
  | { kind: "injected" }
  | { kind: "refuse"; message: string };

/**
 * What Connect wallet does.
 *
 * No injected provider on chain 31337 uses anvil account #0. The same click
 * on any other chain, including Sepolia (11155111) and mainnet (1), refuses.
 * An injected provider is used as-is on every chain, so a browser wallet is
 * never silently replaced by the anvil key.
 */
export function planConnectWallet(input: {
  chainId: number;
  hasInjectedProvider: boolean;
}): WalletConnectPlan {
  if (!input.hasInjectedProvider) {
    if (input.chainId === LOCAL_CHAIN_ID) return { kind: "anvil" };
    return { kind: "refuse", message: WALLET_ERROR.browserRequired };
  }
  return { kind: "injected" };
}

/** The "Use anvil account" button. Local chain only. */
export function planConnectAnvil(chainId: number): WalletConnectPlan {
  if (chainId !== LOCAL_CHAIN_ID) {
    return { kind: "refuse", message: WALLET_ERROR.anvilLocalOnly };
  }
  return { kind: "anvil" };
}

export function showsAnvilAccountButton(
  chainId: number,
  walletConnected: boolean,
): boolean {
  return chainId === LOCAL_CHAIN_ID && !walletConnected;
}

export function injectedWalletMissingMessage(chainId: number): string {
  return chainId === LOCAL_CHAIN_ID
    ? WALLET_ERROR.injectedMissingLocal
    : WALLET_ERROR.injectedMissingOther;
}
