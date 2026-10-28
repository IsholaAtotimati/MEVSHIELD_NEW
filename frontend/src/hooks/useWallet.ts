import { useCallback, useState } from "react";
import type { Address } from "viem";
import { formatEther } from "viem";

import { CHAIN_ID } from "../lib/contracts";
import { getWalletClient, publicClient } from "../lib/viem";

export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null);
  const [balance, setBalance] = useState("—");
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletStatus, setWalletStatus] = useState("Wallet not connected");

  const refreshBalance = useCallback(async (address: Address) => {
    const balanceResult = await publicClient.getBalance({ address });
    setBalance(formatEther(balanceResult));
  }, []);

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
