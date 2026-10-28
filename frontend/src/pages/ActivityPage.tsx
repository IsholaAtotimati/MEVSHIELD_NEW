import { Link } from "react-router-dom";

import { useTrade } from "../context/TradeContext";
import { useActivityFeed } from "../hooks/useActivityFeed";
import ExplorerLink from "../components/ExplorerLink";

export default function ActivityPage() {
  const { wallet } = useTrade();
  const feed = useActivityFeed(wallet.account);

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1>Activity</h1>
        <p className="muted">
          Protected swaps from your wallet, PolicyRegistered events, and hook
          enforcement logs.
        </p>
      </header>

      {!wallet.account && (
        <div className="card empty-state">
          <p>Connect a wallet to see your protected swap history.</p>
          <button type="button" onClick={() => void wallet.connectWallet()}>
            Connect wallet
          </button>
          <p className="muted">
            Or run a dummy trade on the <Link to="/">Trade</Link> page after
            connecting.
          </p>
        </div>
      )}

      {wallet.account && (
        <>
          <div className="toolbar">
            <label>
              Status
              <select
                value={feed.statusFilter}
                onChange={(event) => feed.setStatusFilter(event.target.value)}
              >
                <option value="all">All</option>
                <option value="registered">Registered</option>
                <option value="executed">Executed</option>
                <option value="enforced">Enforced</option>
                <option value="failed">Failed</option>
                <option value="reverted">Reverted</option>
              </select>
            </label>
            <button type="button" onClick={() => void feed.refresh()}>
              {feed.loading ? "Loading..." : "Refresh"}
            </button>
            <button type="button" onClick={feed.exportCsv}>
              Export CSV
            </button>
          </div>

          {feed.rows.length === 0 ? (
            <div className="card empty-state">
              <p>No protected swap activity yet for this wallet.</p>
              <p className="muted">
                Start with a dummy trade on <Link to="/">Trade</Link>, then
                return here for the proof record.
              </p>
            </div>
          ) : (
            <div className="card activity-table-wrap">
              <table className="activity-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Pair</th>
                    <th>Min out</th>
                    <th>Status</th>
                    <th>Tx</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{new Date(row.time).toLocaleString()}</td>
                      <td>{row.pair}</td>
                      <td>{row.minAmountOut}</td>
                      <td>{row.status}</td>
                      <td>
                        <ExplorerLink txHash={row.txHash} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
