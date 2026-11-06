import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import { formatEther, getAddress, isAddress } from "viem";

import { CHAIN_ID } from "../lib/contracts";
import { getWalletClient, publicClient } from "../lib/viem";
import { parseWalletChainId } from "../lib/walletChainId";

export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState("—");
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletStatus, setWalletStatus] = useState("Wallet not connected");

  const refreshBalance = useCallback(async (address: Address) => {
    const balanceResult = await publicClient.getBalance({ address });
    setBalance(formatEther(balanceResult));
  }, []);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return;

    const onAccountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      const address =
        Array.isArray(accounts) &&
        typeof accounts[0] === "string" &&
        isAddress(accounts[0])
          ? getAddress(accounts[0])
          : null;
      setAccount(address);
      if (!address) {
        setBalance("—");
        setWalletStatus("Wallet not connected");
        return;
      }
      setWalletStatus("Wallet account changed");
      void refreshBalance(address).catch((error: unknown) => {
        console.error(error);
        setBalance("—");
        setWalletStatus("Could not refresh wallet balance");
      });
    };
    const onChainChanged = (...args: unknown[]) => {
      const nextChainId = parseWalletChainId(args[0]);
      setChainId(nextChainId);
      setWalletStatus(
        nextChainId === CHAIN_ID
          ? "Wallet connected"
          : "Wallet is on the wrong network",
      );
    };

    provider.on("accountsChanged", onAccountsChanged);
    provider.on("chainChanged", onChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", onAccountsChanged);
      provider.removeListener?.("chainChanged", onChainChanged);
    };
  }, [refreshBalance]);

  const connectWallet = useCallback(async () => {
    try {
      const walletClient = getWalletClient();
      const [address] = await walletClient.requestAddresses();
      setAccount(address);
      await refreshBalance(address);
      const id = await walletClient.getChainId();
      setChainId(id);
      setWalletStatus("Wallet connected");
    } catch (error) {
      console.error(error);
      setWalletStatus("Wallet connection failed");
    }
  }, [refreshBalance]);

  const ensureSepolia = useCallback(async () => {
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
    refreshBalance,
    ensureSepolia,
    wrongNetwork: chainId !== null && chainId !== CHAIN_ID,
  };
}
