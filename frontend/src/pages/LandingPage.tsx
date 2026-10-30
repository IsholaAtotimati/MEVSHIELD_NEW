import { Link, useNavigate } from "react-router-dom";

import Button from "../components/Button";
import Kicker from "../components/Kicker";
import { CHAIN_ID, CHAIN_NAME } from "../config/chain";
import { POLICY_TTL_SECONDS } from "../config/policy";
import { SWAP_TOKENS } from "../config/swapPool";
import { useTrade } from "../context/TradeContext";
import { shortAddress } from "../lib/format";
import {
  landingAction,
  landingLimit,
  pathAfterConnect,
  policyLifetimeLabel,
  showsLandingWalletStatus,
} from "../lib/landingAction";
import { showsAnvilAccountButton } from "../lib/walletConnect";

const STEPS = [
  {
    index: "01",
    title: "Assess",
    body: "The backend prices the swap with a deterministic risk check before anything is signed. The current model is a rule, not a prediction of the market.",
  },
  {
    index: "02",
    title: "Authorize",
    body: "You sign an execution policy for this swap: the amount, the direction, the price limit, and the minimum output you will accept.",
  },
  {
    index: "03",
    title: "Enforce",
    body: "The Uniswap v4 hook and the router check that policy on-chain. A swap that breaks it is rejected.",
  },
] as const;

const CHECKS = [
  {
    title: "Minimum output",
    body: "The router compares the swap’s output with the minimum encoded in the policy.",
  },
  {
    title: "Price limit",
    body: "The requested price limit has to sit on the correct side of the pool, inside the router’s tick cap.",
  },
  {
    title: "A signed policy",
    body: "The authorization contract checks the signature and the policy before the swap proceeds.",
  },
  {
    title: "A record afterward",
    body: "Receipts, policy checks, and swap events stay available on the activity page for the connected wallet.",
  },
] as const;

/** Public front door. The console routes stay behind Connect wallet or Enter app. */
export default function LandingPage() {
  const { wallet } = useTrade();
  const navigate = useNavigate();
  const action = landingAction(wallet.account);
  const showStatus = showsLandingWalletStatus(wallet.walletStatus);
  const showAnvil = showsAnvilAccountButton(CHAIN_ID, wallet.account !== null);
  const lifetime = policyLifetimeLabel(POLICY_TTL_SECONDS);
  const pairLabel = `${SWAP_TOKENS.ETH.poolSymbol} → ${SWAP_TOKENS.USDC.poolSymbol}`;

  async function connectAndEnter() {
    const account = await wallet.connectWallet();
    const next = pathAfterConnect(account);
    if (next) navigate(next);
  }

  async function connectAnvilAndEnter() {
    const account = await wallet.connectAnvil();
    const next = pathAfterConnect(account);
    if (next) navigate(next);
  }

  function renderPrimary() {
    if (action.kind === "enter") {
      return (
        <Link className="btn btn--primary" to={action.to}>
          {action.label}
        </Link>
      );
    }
    return (
      <Button onClick={() => void connectAndEnter()}>{action.label}</Button>
    );
  }

  return (
    <div className="landing">
      <header className="landing-bar">
        <a className="brand" href="#top">
          MEV<span>Shield</span>
        </a>
        <nav className="landing-nav" aria-label="On this page">
          <a href="#how">How it works</a>
          <a href="#checks">What it checks</a>
          <Link to="/trade">Console</Link>
        </nav>
        <div className="landing-actions">
          {renderPrimary()}
          {showAnvil && (
            <Button variant="ghost" onClick={() => void connectAnvilAndEnter()}>
              Use anvil account
            </Button>
          )}
          {wallet.account && (
            <span className="mono">{shortAddress(wallet.account)}</span>
          )}
          {showStatus && (
            <span className="landing-status" role="status">
              {wallet.walletStatus}
            </span>
          )}
        </div>
      </header>

      <main id="top">
        <section className="landing-hero">
          <div className="landing-hero-grid">
            <div>
              <Kicker>Programmable execution</Kicker>
              <h1 className="landing-title">
                Assess before execution. Authorize explicitly. Enforce on-chain.
              </h1>
              <p className="landing-lede">
                MEVShield is a policy-controlled swap for USDC on Uniswap v4.
                You set the conditions. A signature binds them to the swap. The
                router checks them when the transaction runs.
              </p>
              <div className="landing-hero-actions">
                {renderPrimary()}
                <a className="btn btn--ghost" href="#how">
                  See how it works
                </a>
              </div>
              <p className="landing-limit">{landingLimit(CHAIN_ID)}</p>
            </div>
            <PolicyPanel
              chainName={CHAIN_NAME}
              pairLabel={pairLabel}
              lifetime={lifetime}
            />
          </div>

          <section className="landing-stats" aria-label="Product facts">
          <div>
            <b>Uniswap v4</b>
            <span>Hook on the protected pool</span>
          </div>
          <div>
            <b>Signed policy</b>
            <span>Bound to this swap</span>
          </div>
          <div>
            <b>{lifetime}</b>
            <span>Policy lifetime</span>
          </div>
          <div>
            <b>{CHAIN_NAME}</b>
            <span>Chain in this build</span>
          </div>
        </section>
        </section>

        <section className="landing-section" id="how">
          <div className="landing-section-head">
            <Kicker>How it works</Kicker>
            <h2>Three steps, then the chain decides.</h2>
            <p>
              A warning in the interface cannot hold a swap to the conditions
              you expected. MEVShield connects the pre-trade check to a policy
              the contract can reject.
            </p>
          </div>
          <div className="landing-steps">
            {STEPS.map((step) => (
              <article className="card" key={step.index}>
                <b className="landing-step-title">
                  <span className="mono">{step.index}</span>
                  {step.title}
                </b>
                <p className="landing-step-body">{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section" id="checks">
          <div className="landing-checks">
            <div>
              <Kicker>What it checks</Kicker>
              <h2>The policy is the constraint. The router is the check.</h2>
              <p className="landing-lede">
                MEVShield does not claim to stop every form of ordering or
                price movement. It enforces the conditions written into the
                policy for this swap.
              </p>
              <div className="landing-check-list">
                {CHECKS.map((item) => (
                  <div key={item.title}>
                    <b>{item.title}</b>
                    <p>{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
            <FlowPanel />
          </div>
        </section>

        <section className="landing-close">
          <Kicker>Open the console</Kicker>
          <h2>Connect a wallet and go to the swap.</h2>
          <p>
            The trade page is the same console: amount, risk check, policy,
            and execution. No separate account is required.
          </p>
          <div className="landing-hero-actions">
            {renderPrimary()}
            {showAnvil && (
              <Button variant="ghost" onClick={() => void connectAnvilAndEnter()}>
                Use anvil account
              </Button>
            )}
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <div>
          <p className="brand">
            MEV<span>Shield</span>
          </p>
          <p>Policy-controlled execution for a USDC swap on Uniswap v4.</p>
        </div>
        <div>
          <p className="nav-label">Console</p>
          <Link to="/trade">Trade</Link>
          <Link to="/activity">Activity</Link>
          <Link to="/portfolio">Portfolio</Link>
          <Link to="/policies">Policies</Link>
          <Link to="/network">Network</Link>
        </div>
        <div>
          <p className="nav-label">On this page</p>
          <a href="#how">How it works</a>
          <a href="#checks">What it checks</a>
        </div>
        <p className="landing-foot-note">{landingLimit(CHAIN_ID)}</p>
      </footer>
    </div>
  );
}

/** Illustrative policy card. It is not a live quote. */
function PolicyPanel({
  chainName,
  pairLabel,
  lifetime,
}: {
  chainName: string;
  pairLabel: string;
  lifetime: string;
}) {
  return (
    <figure className="landing-panel">
      <figcaption className="landing-panel-bar">
        <span className="landing-dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        Illustrative policy
      </figcaption>
      <div className="landing-panel-body">
        <div className="landing-panel-row">
          <span>Pair</span>
          <b>{pairLabel}</b>
        </div>
        <div className="landing-panel-row">
          <span>Chain</span>
          <b>{chainName}</b>
        </div>
        <div className="landing-panel-row">
          <span>Minimum output</span>
          <b className="mono">signed</b>
        </div>
        <div className="landing-panel-row">
          <span>Price limit</span>
          <b className="mono">within cap</b>
        </div>
        <div className="landing-panel-row">
          <span>Lifetime</span>
          <b className="mono">{lifetime}</b>
        </div>
        <p className="landing-panel-note">
          A picture of the policy shape. The console builds the real one from
          the amount you enter.
        </p>
      </div>
    </figure>
  );
}

/** Three-step diagram. Decorative; the headings beside it carry the text. */
function FlowPanel() {
  return (
    <figure className="landing-flow">
      <figcaption className="landing-panel-bar">From wallet to pool</figcaption>
      <svg viewBox="0 0 420 280" role="img" aria-label="Wallet, policy, and pool">
        <rect x="24" y="28" width="150" height="64" rx="14" />
        <text x="99" y="66">
          Wallet
        </text>
        <rect x="246" y="28" width="150" height="64" rx="14" />
        <text x="321" y="66">
          Policy
        </text>
        <rect x="135" y="176" width="150" height="64" rx="14" />
        <text x="210" y="214">
          Pool
        </text>
        <path d="M174 60 H246" />
        <path d="M321 92 V150 H210 V176" />
      </svg>
    </figure>
  );
}
