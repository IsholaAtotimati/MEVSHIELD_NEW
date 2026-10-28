import { useEffect, useState } from "react";
import { formatGwei } from "viem";

import { CHAIN_ID } from "../lib/contracts";
import { shortAddress } from "../lib/format";
import { publicClient } from "../lib/viem";
import { useTrade } from "../context/TradeContext";

export default function TopBar() {
  const { wallet, backend } = useTrade();
  const [gasPrice, setGasPrice] = useState<string>("—");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const price = await publicClient.getGasPrice();
        if (!cancelled) setGasPrice(formatGwei(price));
      } catch {
        if (!cancelled) setGasPrice("unavailable");
      }
    };
    void load();
    const interval = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const backendLabel =
    backend.healthState === "checking"
      ? "Backend checking"
      : backend.healthState === "ok"
        ? "Backend online"
        : "Backend offline";

  return (
    <header className="top-bar">
      <div className="top-bar-group">
        <button type="button" className="top-bar-wallet" onClick={() => void wallet.connectWallet()}>
          {wallet.account
            ? shortAddress(wallet.account)
            : "Connect wallet"}
        </button>
        {wallet.wrongNetwork && (
          <span className="top-bar-warning">
            Wrong network. Switch to Sepolia.
          </span>
        )}
      </div>
      <div className="top-bar-group top-bar-meta">
        <span className="network-tag">Sepolia · {CHAIN_ID}</span>
        <span>Gas estimate: {gasPrice} gwei</span>
        <span
          className={`backend-status backend-status--${backend.healthState}`}
        >
          <span className="status-dot" aria-hidden />
          {backendLabel}
        </span>
      </div>
    </header>
  );
}
