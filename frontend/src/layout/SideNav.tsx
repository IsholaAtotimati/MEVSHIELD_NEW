import { NavLink } from "react-router-dom";

import { shortAddress } from "../lib/format";
import { useTrade } from "../context/TradeContext";

const links = [
  { to: "/", label: "Trade", end: true },
  { to: "/activity", label: "Activity" },
  { to: "/portfolio", label: "Portfolio" },
  { to: "/policies", label: "Policies" },
  { to: "/network", label: "Network" },
];

/**
 * Left column from history.html: brand, then uppercase group labels, then the
 * connected wallet in the same active row treatment the mockup uses for a
 * profile. The app has one connected wallet, so this is not a switcher and is
 * rendered as static text rather than a list of accounts.
 */
export default function SideNav() {
  const { wallet } = useTrade();

  return (
    <nav className="side-nav" aria-label="Main">
      <p className="brand">
        MEV<span>Shield</span>
      </p>

      <p className="nav-label">Navigate</p>
      <ul className="nav-list">
        {links.map((link) => (
          <li key={link.to}>
            <NavLink
              to={link.to}
              end={link.end}
              className={({ isActive }) =>
                isActive ? "nav-link on" : "nav-link"
              }
            >
              {link.label}
            </NavLink>
          </li>
        ))}
      </ul>

      <p className="nav-label">Wallet</p>
      <div className={wallet.account ? "profile on" : "profile"}>
        <b>{wallet.account ? "Connected" : "Not connected"}</b>
        <small className="mono">
          {wallet.account ? shortAddress(wallet.account) : "no account"}
        </small>
      </div>
    </nav>
  );
}
