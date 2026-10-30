import { useCallback, useState } from "react";
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
