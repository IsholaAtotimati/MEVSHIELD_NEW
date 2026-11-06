import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { formatEther } from "viem";

import { CHAIN_NAME, IS_LOCAL_CHAIN, RPC_URL } from "../config/chain";
import { CHAIN_ID } from "../lib/contracts";
import { fundInjectedLocalAccount } from "../lib/localFaucet";
import {
  WALLET_ERROR,
  WALLET_STATUS,
  planConnectAnvil,
  planConnectWallet,
  planReconnect,
  selectInjectedChain,
} from "../lib/walletConnect";
import {
  connectLocalAnvilAccount,
  disconnectLocalAnvilAccount,
  getWalletClient,
  publicClient,
  usesLocalAnvilSigner,
} from "../lib/viem";

export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState("—");
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletStatus, setWalletStatus] = useState<string>(
    WALLET_STATUS.disconnected,
  );

  const refreshBalance = useCallback(async (address: Address) => {
    const balanceResult = await publicClient.getBalance({ address });
    setBalance(formatEther(balanceResult));
  }, []);

  const connectWallet = useCallback(async (): Promise<Address | null> => {
    setWalletStatus(WALLET_STATUS.connecting);
    try {
      const plan = planConnectWallet({
        chainId: CHAIN_ID,
        hasInjectedProvider: Boolean(window.ethereum),
      });
      if (plan.kind === "refuse") {
        throw new Error(plan.message);
      }
      if (plan.kind === "anvil") {
        const address = connectLocalAnvilAccount();
        setAccount(address);
        await refreshBalance(address);
        setChainId(CHAIN_ID);
        setWalletStatus(WALLET_STATUS.anvil);
        return address;
      }

      disconnectLocalAnvilAccount();
      if (!window.ethereum) {
        throw new Error(WALLET_ERROR.browserRequired);
      }
      const walletClient = getWalletClient();
      const [address] = await walletClient.requestAddresses();
      if (!address) {
        throw new Error(WALLET_ERROR.noAccount);
      }
      await selectInjectedChain(window.ethereum.request.bind(window.ethereum), {
        chainId: CHAIN_ID,
        chainName: CHAIN_NAME,
        rpcUrl: RPC_URL,
      });
      setAccount(address);
      if (IS_LOCAL_CHAIN) {
        setWalletStatus("Approve the test-token mint in MetaMask");
        await fundInjectedLocalAccount(walletClient, address);
      }
      await refreshBalance(address);
      const id = await walletClient.getChainId();
      setChainId(id);
      setWalletStatus(WALLET_STATUS.connected);
      return address;
    } catch (error) {
      console.error(error);
      setWalletStatus(
        error instanceof Error ? error.message : WALLET_STATUS.failed,
      );
      return null;
    }
  }, [refreshBalance]);

  const connectAnvil = useCallback(async (): Promise<Address | null> => {
    try {
      const plan = planConnectAnvil(CHAIN_ID);
      if (plan.kind === "refuse") {
        throw new Error(plan.message);
      }
      const address = connectLocalAnvilAccount();
      setAccount(address);
      await refreshBalance(address);
      setChainId(CHAIN_ID);
      setWalletStatus(WALLET_STATUS.anvil);
      return address;
    } catch (error) {
      console.error(error);
      setWalletStatus(
        error instanceof Error ? error.message : WALLET_STATUS.anvilFailed,
      );
      return null;
    }
  }, [refreshBalance]);

  const disconnectWallet = useCallback(() => {
    disconnectLocalAnvilAccount();
    setAccount(null);
    setBalance("—");
    setChainId(null);
    setWalletStatus(WALLET_STATUS.disconnected);
  }, []);

  /**
   * Silent reconnect on mount. `eth_accounts` returns the wallet's remembered
   * accounts without a prompt, so a refresh restores the session a connected
   * wallet already granted. The anvil signer is deliberately not restored:
   * that key is a click away on the local page, and a browser wallet the user
   * connected must never be replaced by it silently.
   */
  useEffect(() => {
    if (IS_LOCAL_CHAIN || !window.ethereum) {
      return;
    }
    let cancelled = false;
    const ethereum = window.ethereum;
    void (async () => {
      const plan = await planReconnect(ethereum.request.bind(ethereum));
      if (cancelled || plan.kind !== "restore") {
        return;
      }
      const address = plan.account as Address;
      setAccount(address);
      setWalletStatus(WALLET_STATUS.connected);
      const id = await ethereum
        .request({ method: "eth_chainId" })
        .catch(() => null);
      if (cancelled) return;
      setChainId(
        typeof id === "string" ? Number.parseInt(id, 16) : null,
      );
      await refreshBalance(address);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshBalance]);

  /**
   * Follow the wallet after the session exists: account switches and chain
   * switches made inside MetaMask update the page without a reload. Only an
   * injected provider emits these; the anvil signer has none.
   */
  useEffect(() => {
    if (IS_LOCAL_CHAIN || !window.ethereum) {
      return;
    }
    const ethereum = window.ethereum;
    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      if (!Array.isArray(accounts)) return;
      const next = accounts.find(
        (value): value is string => typeof value === "string" && value !== "",
      );
      setAccount((next as Address | undefined) ?? null);
      if (!next) {
        setBalance("—");
        setWalletStatus(WALLET_STATUS.disconnected);
      }
    };
    const onChainChanged = (...args: unknown[]) => {
      const chainIdHex = args[0];
      if (typeof chainIdHex === "string") {
        setChainId(Number.parseInt(chainIdHex, 16));
      }
    };
    ethereum.on?.("accountsChanged", onAccountsChanged);
    ethereum.on?.("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccountsChanged);
      ethereum.removeListener?.("chainChanged", onChainChanged);
    };
  }, []);

  const ensureSepolia = useCallback(async () => {
    if (!usesLocalAnvilSigner() && window.ethereum) {
      await selectInjectedChain(window.ethereum.request.bind(window.ethereum), {
        chainId: CHAIN_ID,
        chainName: CHAIN_NAME,
        rpcUrl: RPC_URL,
      });
    }
    const walletClient = getWalletClient();
    if ((await walletClient.getChainId()) !== CHAIN_ID) {
      await walletClient.switchChain({ id: CHAIN_ID });
    }
    setChainId(CHAIN_ID);
  }, []);

  return {
    account,
    setAccount,
    balance,
    setBalance,
    chainId,
    walletStatus,
    setWalletStatus,
    connectWallet,
    connectAnvil,
    disconnectWallet,
    localChain: IS_LOCAL_CHAIN,
    refreshBalance,
    ensureSepolia,
    wrongNetwork: chainId !== null && chainId !== CHAIN_ID,
  };
}
