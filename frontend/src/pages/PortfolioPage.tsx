import { useCallback, useEffect, useState } from "react";
import { formatEther, formatUnits, parseEther, parseUnits } from "viem";

import { SWAP_TOKENS, WETH9_ADDRESS } from "../config/swapPool";
import { useTrade } from "../context/TradeContext";
import { CONTRACTS } from "../lib/contracts";
import { erc20Abi, weth9Abi } from "../lib/abis";
import { getWalletClient, publicClient } from "../lib/viem";

export default function PortfolioPage() {
  const { wallet } = useTrade();
  const [ethBalance, setEthBalance] = useState("—");
  const [wethBalance, setWethBalance] = useState("—");
  const [usdcBalance, setUsdcBalance] = useState("—");
  const [allowance, setAllowance] = useState("—");
  const [wrapAmount, setWrapAmount] = useState("");
  const [status, setStatus] = useState("Connect a wallet to load balances.");

  const refresh = useCallback(async () => {
    if (!wallet.account) return;
    const [eth, weth, usdc, allow] = await Promise.all([
      publicClient.getBalance({ address: wallet.account }),
      publicClient.readContract({
        address: WETH9_ADDRESS,
        abi: weth9Abi,
        functionName: "balanceOf",
        args: [wallet.account],
      }),
      publicClient.readContract({
        address: SWAP_TOKENS.USDC.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet.account],
      }),
      publicClient.readContract({
        address: SWAP_TOKENS.USDC.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet.account, CONTRACTS.mevShieldRouter],
      }),
    ]);
    setEthBalance(formatEther(eth));
    setWethBalance(formatEther(weth));
    setUsdcBalance(formatUnits(usdc, SWAP_TOKENS.USDC.decimals));
    setAllowance(formatUnits(allow, SWAP_TOKENS.USDC.decimals));
    setStatus("Balances updated.");
  }, [wallet.account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function wrapEth() {
    if (!wallet.account) return;
    const value = parseEther(wrapAmount || "0");
    const client = getWalletClient();
    await wallet.ensureSepolia();
    setStatus("Confirm wrap in your wallet...");
    const hash = await client.writeContract({
      address: WETH9_ADDRESS,
      abi: weth9Abi,
      functionName: "deposit",
      value,
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    setStatus("Wrapped ETH to WETH.");
    await refresh();
  }

  async function unwrapWeth() {
    if (!wallet.account) return;
    const amount = parseEther(wrapAmount || "0");
    const client = getWalletClient();
    await wallet.ensureSepolia();
    setStatus("Confirm unwrap in your wallet...");
    const hash = await client.writeContract({
      address: WETH9_ADDRESS,
      abi: weth9Abi,
      functionName: "withdraw",
      args: [amount],
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    setStatus("Unwrapped WETH to ETH.");
    await refresh();
  }

  async function approveExactUsdc() {
    if (!wallet.account) return;
    const client = getWalletClient();
    await wallet.ensureSepolia();
    const approveAmount = parseUnits(
      wrapAmount || "0",
      SWAP_TOKENS.USDC.decimals,
    );
    setStatus("Confirm approval in your wallet...");
    const hash = await client.writeContract({
      address: SWAP_TOKENS.USDC.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.mevShieldRouter, approveAmount],
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    setStatus("Router allowance updated.");
    await refresh();
  }

  async function revokeRouter() {
    if (!wallet.account) return;
    const client = getWalletClient();
    await wallet.ensureSepolia();
    const hash = await client.writeContract({
      address: SWAP_TOKENS.USDC.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [CONTRACTS.mevShieldRouter, 0n],
      account: wallet.account,
    });
    await publicClient.waitForTransactionReceipt({ hash });
    setStatus("Router allowance revoked.");
    await refresh();
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1>Portfolio</h1>
        <p className="muted">Sepolia ETH, WETH, and USDC. No USD values.</p>
      </header>

      {!wallet.account ? (
        <div className="card empty-state">
          <button type="button" onClick={() => void wallet.connectWallet()}>
            Connect wallet
          </button>
        </div>
      ) : (
        <>
          <div className="grid">
            <div className="card">
              <h2>Balances</h2>
              <div className="row">
                <span>ETH</span>
                <strong>{ethBalance}</strong>
              </div>
              <div className="row">
                <span>WETH</span>
                <strong>{wethBalance}</strong>
              </div>
              <div className="row">
                <span>USDC</span>
                <strong>{usdcBalance}</strong>
              </div>
              <button type="button" onClick={() => void refresh()}>
                Refresh
              </button>
            </div>
            <div className="card">
              <h2>Wrap / unwrap</h2>
              <label>
                Amount (ETH or WETH)
                <input
                  value={wrapAmount}
                  onChange={(event) => setWrapAmount(event.target.value)}
                />
              </label>
              <div className="button-row">
                <button type="button" onClick={() => void wrapEth()}>
                  Wrap ETH to WETH
                </button>
                <button type="button" onClick={() => void unwrapWeth()}>
                  Unwrap WETH to ETH
                </button>
              </div>
            </div>
          </div>

          <div className="card">
            <h2>Router allowance (USDC)</h2>
            <p>Current allowance: {allowance} USDC</p>
            <div className="button-row">
              <button type="button" onClick={() => void approveExactUsdc()}>
                Approve exact amount
              </button>
              <button type="button" onClick={() => void revokeRouter()}>
                Revoke (zero)
              </button>
            </div>
          </div>

          <p className="action-status">{status}</p>
        </>
      )}
    </div>
  );
}
