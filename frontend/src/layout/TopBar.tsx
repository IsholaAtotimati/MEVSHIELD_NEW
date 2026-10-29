import { useEffect, useState } from "react";
import { formatGwei } from "viem";

import Button from "../components/Button";
import { BUILT_CHAIN_MARKER, CHAIN_ID, CHAIN_LABEL, CHAIN_NAME } from "../config/chain";
import { shortAddress } from "../lib/format";
import { showsAnvilAccountButton } from "../lib/walletConnect";
import { publicClient } from "../lib/viem";
import { useTrade } from "../context/TradeContext";

/** Wallet, chain, gas and backend health, in one hairline strip. */
export default function TopBar() {
  const { wallet, backend } = useTrade();
  const [gasPrice, setGasPrice] = useState<string>("loading");

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
        <Button
          variant={wallet.account ? "ghost" : "primary"}
          onClick={() => void wallet.connectWallet()}
        >
          {wallet.account ? shortAddress(wallet.account) : "Connect wallet"}
        </Button>
        {showsAnvilAccountButton(CHAIN_ID, wallet.account !== null) && (
          <Button variant="ghost" onClick={() => void wallet.connectAnvil()}>
            Use anvil account
          </Button>
        )}
        {wallet.account && (
          <Button variant="ghost" onClick={wallet.disconnectWallet}>
            Disconnect
          </Button>
        )}
        <span className="top-bar-warning" role="status">
          {wallet.walletStatus}
        </span>
        {wallet.wrongNetwork && (
          <span className="top-bar-warning">
            Wrong network. Switch to {CHAIN_NAME}.
          </span>
        )}
      </div>
      <div className="top-bar-group">
        <span className="network-tag mono" data-built-chain={BUILT_CHAIN_MARKER}>
          {CHAIN_LABEL}
        </span>
        <span className="mono">Gas estimate: {gasPrice} gwei</span>
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
