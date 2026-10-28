import { Link } from "react-router-dom";
import { useState } from "react";

import Button from "../components/Button";
import Card from "../components/Card";
import DataTable, { type DataTableColumn } from "../components/DataTable";
import Kicker from "../components/Kicker";
import Spinner from "../components/Spinner";
import StatCard, { StatRow } from "../components/StatCard";
import StatLine from "../components/StatLine";
import ToggleRow from "../components/ToggleRow";
import {
  MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
  SEPOLIA_DEMO_MODE,
} from "../config/env";
import { useTrade } from "../context/TradeContext";
import { useActivityFeed } from "../hooks/useActivityFeed";
import { etherscanTxUrl, shortAddress } from "../lib/format";
import { activityStatusTone } from "../lib/statusTone";
import type { ActivityRow } from "../lib/types";

const STATUS_FILTERS = [
  { value: "all", label: "All" },
  { value: "registered", label: "Registered" },
  { value: "executed", label: "Executed" },
  { value: "enforced", label: "Enforced" },
  { value: "failed", label: "Failed" },
  { value: "reverted", label: "Reverted" },
];

function formatTime(time: number): string {
  return new Date(time).toLocaleString();
}

function isFailure(row: ActivityRow): boolean {
  return activityStatusTone(row.status) === "no";
}

/**
 * One row per proof event, following history.html: summary cards on top, then
 * a dense table whose status column is the only coloured text, then a read
 * only list of gate states. Selecting a row highlights it and pins its detail
 * beneath the table so no field is hidden behind a tooltip.
 */
export default function ActivityPage() {
  const { wallet, protocol, backend, quote } = useTrade();
  const feed = useActivityFeed(wallet.account);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = feed.rows.find((row) => row.id === selectedId) ?? null;

  const columns: DataTableColumn<ActivityRow>[] = [
    {
      key: "time",
      header: "Time",
      render: (row) => formatTime(row.time),
    },
    {
      key: "pair",
      header: "Pair",
      render: (row) => row.pair,
    },
    {
      key: "minOut",
      header: "Min out",
      mono: true,
      render: (row) => row.minAmountOut,
    },
    {
      key: "status",
      header: "Status",
      status: (row) => activityStatusTone(row.status),
      render: (row) => row.status,
    },
    {
      key: "policy",
      header: "Policy",
      mono: true,
      render: (row) => (row.policyId ? shortAddress(row.policyId) : "not set"),
    },
    {
      key: "tx",
      header: "Transaction",
      render: (row) =>
        row.txHash ? (
          <a
            className="link"
            href={etherscanTxUrl(row.txHash)}
            target="_blank"
            rel="noreferrer"
          >
            Etherscan
          </a>
        ) : (
          "not broadcast"
        ),
    },
  ];

  const failureCount = feed.rows.filter(isFailure).length;
  const protectedCount = feed.rows.length - failureCount;

  return (
    <div className="page-stack">
      <header className="page-head">
        <Kicker>History</Kicker>
        <h1 className="page-title">Activity</h1>
        <p className="addr">
          Protected swaps from your wallet, PolicyRegistered events, and hook
          enforcement logs.
        </p>
      </header>

      {!wallet.account && (
        <Card>
          <div className="empty-state">
            <p>Connect a wallet to see your protected swap history.</p>
            <Button onClick={() => void wallet.connectWallet()}>
              Connect wallet
            </Button>
            <p className="note">
              Or run a dummy trade on the{" "}
              <Link className="link" to="/">
                Trade
              </Link>{" "}
              page after connecting.
            </p>
          </div>
        </Card>
      )}

      {wallet.account && (
        <>
          <StatRow>
            <StatCard label="Records" value={feed.rows.length} />
            <StatCard label="Protected" value={protectedCount} tone="gain" />
            <StatCard label="Reverts" value={failureCount} />
          </StatRow>

          <div className="toolbar">
            <div className="chip-row">
              {STATUS_FILTERS.map((filter) => (
                <Button
                  key={filter.value}
                  variant="chip"
                  selected={feed.statusFilter === filter.value}
                  onClick={() => feed.setStatusFilter(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div className="chip-row">
              <Button
                variant="ghost"
                disabled={feed.loading}
                onClick={() => void feed.refresh()}
              >
                {feed.loading ? "Loading..." : "Refresh"}
              </Button>
              <Button variant="ghost" onClick={feed.exportCsv}>
                Export CSV
              </Button>
            </div>
          </div>

          {feed.loading && feed.rows.length === 0 ? (
            <Spinner label="Reading your activity" />
          ) : feed.rows.length === 0 ? (
            <Card>
              <div className="empty-state">
                <p>No protected swap activity yet for this wallet.</p>
                <p className="note">
                  Start with a dummy trade on{" "}
                  <Link className="link" to="/">
                    Trade
                  </Link>
                  , then return here for the proof record.
                </p>
              </div>
            </Card>
          ) : (
            <Card>
              <DataTable
                columns={columns}
                rows={feed.rows}
                rowKey={(row) => row.id}
                emptyMessage="No records match this status."
                highlight={(row) => row.id === selectedId}
                onSelectRow={(row) =>
                  setSelectedId((current) =>
                    current === row.id ? null : row.id,
                  )
                }
              />
            </Card>
          )}

          {selected && (
            <Card title="Selected record">
              <StatLine label="Time" mono>
                {formatTime(selected.time)}
              </StatLine>
              <StatLine label="Pair" mono>
                {selected.pair}
              </StatLine>
              <StatLine label="Amount in" mono>
                {selected.amountIn}
              </StatLine>
              <StatLine label="Amount out" mono>
                {selected.amountOut}
              </StatLine>
              <StatLine label="Minimum output" mono>
                {selected.minAmountOut}
              </StatLine>
              <StatLine
                label="Status"
                mono
                tone={isFailure(selected) ? "loss" : "gain"}
              >
                {selected.status}
              </StatLine>
              <StatLine label="Policy ID" mono>
                {selected.policyId ?? "not set"}
              </StatLine>
              <StatLine label="Transaction hash" mono>
                {selected.txHash ?? "not broadcast"}
              </StatLine>
              {selected.txHash && (
                <p className="note">
                  <a
                    className="link"
                    href={etherscanTxUrl(selected.txHash)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open this transaction on Sepolia Etherscan
                  </a>
                </p>
              )}
            </Card>
          )}

          <Card
            title="Protection gates"
            footer="Read only. These are the live checks the Trade page consults before it will let a policy be signed."
          >
            <div className="toggle-list">
              <ToggleRow
                label="Pool authorization matches the registry consumer"
                on={protocol.hasAuthorization}
                disabled
              />
              <ToggleRow
                label="Protocol addresses match the build"
                on={protocol.protocolAddressesVerified}
                disabled
              />
              <ToggleRow
                label="Backend protected pool key verified"
                on={quote.backendPoolKeyVerified}
                disabled
              />
              <ToggleRow
                label="Minimum output deployment verified"
                on={MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED}
                disabled
              />
              <ToggleRow
                label="Backend policy signing"
                on={backend.health?.policySigningEnabled === true}
                disabled
              />
              <ToggleRow label="Demo mode" on={SEPOLIA_DEMO_MODE} disabled />
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
