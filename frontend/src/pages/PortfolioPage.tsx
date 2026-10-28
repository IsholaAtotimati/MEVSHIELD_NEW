import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";

import AllowanceCard from "../components/AllowanceCard";
import ValueRow from "../components/ValueRow";
import { TOKEN_NETWORK_LABEL } from "../config/chain";
import { SWAP_TOKENS, WETH9_ADDRESS } from "../config/swapPool";
import { useTrade } from "../context/TradeContext";
import { erc20Abi, weth9Abi } from "../lib/abis";
import { CONTRACTS } from "../lib/contracts";
import { formatTokenAmount } from "../lib/format";
import { parseTokenAmount } from "../lib/protectedQuote";
import { getWalletClient, publicClient } from "../lib/viem";

type AllowanceToken = "WETH" | "USDC";

type AllowanceBalances = Record<AllowanceToken, bigint | null>;
type AllowanceAmounts = Record<AllowanceToken, string>;

const EMPTY_ALLOWANCES: AllowanceBalances = { WETH: null, USDC: null };

/** The pool trades WETH, so the ETH entry in SWAP_TOKENS is the WETH token. */
const ALLOWANCE_TOKENS: Record<
  AllowanceToken,
  { address: Address; decimals: number }
> = {
  WETH: { address: WETH9_ADDRESS, decimals: SWAP_TOKENS.ETH.decimals },
  USDC: {
    address: SWAP_TOKENS.USDC.address,
    decimals: SWAP_TOKENS.USDC.decimals,
  },
};

export default function PortfolioPage() {
  const { wallet } = useTrade();
  const [ethBalance, setEthBalance] = useState<bigint | null>(null);
  const [wethBalance, setWethBalance] = useState<bigint | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint | null>(null);
  const [allowances, setAllowances] =
    useState<AllowanceBalances>(EMPTY_ALLOWANCES);
  const [wrapAmount, setWrapAmount] = useState("");
  const [approveAmounts, setApproveAmounts] = useState<AllowanceAmounts>({
    WETH: "",
    USDC: "",
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Connect a wallet to load balances.");

  const refresh = useCallback(async () => {
    if (!wallet.account) return;
    const account = wallet.account;
    const [eth, weth, usdc, wethAllowance, usdcAllowance] = await Promise.all([
      publicClient.getBalance({ address: account }),
      publicClient.readContract({
        address: WETH9_ADDRESS,
        abi: weth9Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      publicClient.readContract({
        address: SWAP_TOKENS.USDC.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
      }),
      publicClient.readContract({
        address: WETH9_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, CONTRACTS.mevShieldRouter],
      }),
      publicClient.readContract({
        address: SWAP_TOKENS.USDC.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, CONTRACTS.mevShieldRouter],
      }),
    ]);
    setEthBalance(eth);
    setWethBalance(weth);
    setUsdcBalance(usdc);
    setAllowances({ WETH: wethAllowance, USDC: usdcAllowance });
    setStatus("Balances updated.");
  }, [wallet.account]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function submit(
    action: (account: `0x${string}`) => Promise<`0x${string}`>,
    pendingMessage: string,
    doneMessage: string,
  ) {
    if (!wallet.account || busy) return;
    try {
      setBusy(true);
      await wallet.ensureSepolia();
      setStatus(pendingMessage);
      const hash = await action(wallet.account);
      await publicClient.waitForTransactionReceipt({ hash });
      setStatus(doneMessage);
      await refresh();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Transaction failed.");
    } finally {
      setBusy(false);
    }
  }

  function wrapEth() {
    const value = parseTokenAmount(wrapAmount || "0", 18);
    if (value === null || value <= 0n) {
      setStatus("Enter a positive ETH amount to wrap.");
      return;
    }
    void submit(
      (account) =>
        getWalletClient().writeContract({
          address: WETH9_ADDRESS,
          abi: weth9Abi,
          functionName: "deposit",
          value,
          account,
        }),
      "Confirm wrap in your wallet...",
      "Wrapped ETH to WETH.",
    );
  }

  function unwrapWeth() {
    const amount = parseTokenAmount(wrapAmount || "0", 18);
    if (amount === null || amount <= 0n) {
      setStatus("Enter a positive WETH amount to unwrap.");
      return;
    }
    void submit(
      (account) =>
        getWalletClient().writeContract({
          address: WETH9_ADDRESS,
          abi: weth9Abi,
          functionName: "withdraw",
          args: [amount],
          account,
        }),
      "Confirm unwrap in your wallet...",
      "Unwrapped WETH to ETH.",
    );
  }

  function approveExact(symbol: AllowanceToken) {
    const token = ALLOWANCE_TOKENS[symbol];
    const amount = parseTokenAmount(
      approveAmounts[symbol] || "0",
      token.decimals,
    );
    if (amount === null) {
      setStatus(`Enter a valid ${symbol} amount before approving.`);
      return;
    }
    void submit(
      (account) =>
        getWalletClient().writeContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.mevShieldRouter, amount],
          account,
        }),
      "Confirm approval in your wallet...",
      `Router allowance for ${symbol} updated.`,
    );
  }

  function revoke(symbol: AllowanceToken) {
    const token = ALLOWANCE_TOKENS[symbol];
    void submit(
      (account) =>
        getWalletClient().writeContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [CONTRACTS.mevShieldRouter, 0n],
          account,
        }),
      "Confirm revoke in your wallet...",
      `Router allowance for ${symbol} revoked.`,
    );
  }

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1>Portfolio</h1>
        <p className="muted">{TOKEN_NETWORK_LABEL} ETH, WETH, and USDC. No USD values.</p>
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
              <ValueRow label="ETH (unwrapped)">
                {formatTokenAmount(ethBalance, 18)}
              </ValueRow>
              <ValueRow label="WETH (used by swaps)">
                {formatTokenAmount(wethBalance, 18)}
              </ValueRow>
              <ValueRow label="USDC">
                {formatTokenAmount(usdcBalance, 6)}
              </ValueRow>
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
                <button type="button" disabled={busy} onClick={wrapEth}>
                  Wrap ETH to WETH
                </button>
                <button type="button" disabled={busy} onClick={unwrapWeth}>
                  Unwrap WETH to ETH
                </button>
              </div>
              <p className="muted">
                Trade spends WETH. Wrap before swapping if your balance above is
                too low.
              </p>
            </div>
          </div>

          <div className="grid">
            <AllowanceCard
              symbol="WETH"
              decimals={18}
              allowance={allowances.WETH}
              amount={approveAmounts.WETH}
              busy={busy}
              onAmountChange={(value) =>
                setApproveAmounts((prev) => ({ ...prev, WETH: value }))
              }
              onApprove={() => approveExact("WETH")}
              onRevoke={() => revoke("WETH")}
            />
            <AllowanceCard
              symbol="USDC"
              decimals={6}
              allowance={allowances.USDC}
              amount={approveAmounts.USDC}
              busy={busy}
              onAmountChange={(value) =>
                setApproveAmounts((prev) => ({ ...prev, USDC: value }))
              }
              onApprove={() => approveExact("USDC")}
              onRevoke={() => revoke("USDC")}
            />
          </div>

          <p className="action-status" role="status" aria-live="polite">
            {status}
          </p>
        </>
      )}
    </div>
  );
}
