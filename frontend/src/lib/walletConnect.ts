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

type WalletRequest = (args: {
  method: string;
  params?: unknown[];
}) => Promise<unknown>;

/** Hex chain id MetaMask expects, derived from the numeric id. 31337 is 0x7a69. */
export function hexChainId(chainId: number): string {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("Chain id must be a positive integer.");
  }
  return `0x${chainId.toString(16)}`;
}

/**
 * Parameters for wallet_addEthereumChain. The RPC and chain id come from the
 * bundle's own config. Nothing here is an account or a key.
 */
export function injectedChainParams(input: {
  chainId: number;
  chainName: string;
  rpcUrl: string;
}): {
  chainId: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrls: string[];
} {
  return {
    chainId: hexChainId(input.chainId),
    chainName: input.chainName,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: [input.rpcUrl],
  };
}

/** MetaMask returns 4902 when the chain has not been added yet. */
export function isUnknownChainError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  return (error as { code: unknown }).code === 4902;
}

/**
 * Silent reconnect plan for a page load.
 *
 * `eth_accounts` returns the remembered accounts without a prompt when the
 * user granted access earlier, and an empty array when they did not or the
 * wallet is locked. A provider failure on load is a missing session, not a
 * crash: the Connect button stays the way forward.
 *
 * An explicit in-app disconnect is remembered (`userDisconnected`) and wins
 * over the provider: the provider is not even asked, so a reload after
 * Disconnect stays disconnected instead of silently re-attaching an account
 * the user just removed. The wallet's own Disconnect (account revocation in
 * MetaMask) clears the flag naturally, because `eth_accounts` then returns
 * an empty array.
 */
export type ReconnectPlan =
  | { kind: "restore"; account: string }
  | { kind: "none" };

/** localStorage key remembering an explicit in-app disconnect. */
export const USER_DISCONNECTED_KEY = "mevshield-wallet-user-disconnected";

export async function planReconnect(
  request: WalletRequest,
  options: { userDisconnected?: boolean } = {},
): Promise<ReconnectPlan> {
  if (options.userDisconnected === true) {
    return { kind: "none" };
  }
  let accounts: unknown;
  try {
    accounts = await request({ method: "eth_accounts" });
  } catch {
    return { kind: "none" };
  }
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return { kind: "none" };
  }
  const account = accounts[0];
  if (typeof account !== "string" || account === "") {
    return { kind: "none" };
  }
  return { kind: "restore", account };
}

/**
 * Point an injected wallet at this bundle's chain.
 *
 * Already-correct wallets are left alone. A known chain is switched. An
 * unknown chain is added, which also selects it. A rejected prompt is not
 * turned into the anvil account.
 */
export async function selectInjectedChain(
  request: WalletRequest,
  input: { chainId: number; chainName: string; rpcUrl: string },
): Promise<void> {
  const target = hexChainId(input.chainId);
  const current = await request({ method: "eth_chainId" });
  if (typeof current === "string" && current.toLowerCase() === target) return;

  try {
    await request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: target }],
    });
  } catch (error) {
    if (!isUnknownChainError(error)) throw error;
    await request({
      method: "wallet_addEthereumChain",
      params: [injectedChainParams(input)],
    });
  }
}
