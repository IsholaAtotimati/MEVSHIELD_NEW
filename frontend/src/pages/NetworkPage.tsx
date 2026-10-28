import AddressRow from "../components/AddressRow";
import Card from "../components/Card";
import DataTable, { type DataTableColumn } from "../components/DataTable";
import ExplorerLink from "../components/ExplorerLink";
import Kicker from "../components/Kicker";
import RiskCallout from "../components/RiskCallout";
import StatLine from "../components/StatLine";
import { CHAIN_NAME } from "../config/chain";
import { useTrade } from "../context/TradeContext";
import { CONTRACTS } from "../lib/contracts";
import {
  buildVerificationRows,
  VERIFICATION_STATE_LABELS,
  type ContractVerificationRow,
  type VerificationState,
} from "../lib/networkVerification";

/**
 * Tone for a verification cell, in the mockup's mint/bad language. `null` keeps
 * the default text colour, which is what an unverified row deserves: it is not
 * a failure, but it is not a pass either.
 */
function stateTone(state: VerificationState): "ok" | "no" | null {
  if (state === "pass") return "ok";
  if (state === "mismatch") return "no";
  return null;
}

/** Why a row carries no verdict, shown next to the "Not checked" label. */
function stateLabel(row: ContractVerificationRow): string {
  const label = VERIFICATION_STATE_LABELS[row.state];
  return row.reason ? `${label} · ${row.reason}` : label;
}

export default function NetworkPage() {
  const { protocol, backend } = useTrade();
  const { deployment } = protocol;
  const monitor = backend.health?.sepoliaMonitor;

  // Rows come from the pure builder so every verdict compares the configured
  // address against a value read from chain. The hook and router have no
  // on-chain source, so those rows report Not checked rather than a pass.
  const rows = buildVerificationRows({
    contracts: CONTRACTS,
    observed: {
      poolManager: deployment.poolManager,
      authorization: deployment.authorization,
      registry: deployment.registry,
      verifier: deployment.verifier,
    },
  });

  const columns: DataTableColumn<ContractVerificationRow>[] = [
    {
      key: "name",
      header: "Contract",
      render: (row) => row.name,
    },
    {
      key: "expected",
      header: "Expected",
      mono: true,
      render: (row) => row.expected,
    },
    {
      key: "observed",
      header: "Observed on chain",
      mono: true,
      render: (row) => row.observed ?? "not reported",
    },
    {
      key: "state",
      header: "Check",
      status: (row) => stateTone(row.state),
      render: (row) => stateLabel(row),
    },
    {
      key: "explorer",
      header: "Explorer",
      render: (row) => <ExplorerLink address={row.expected}>Explorer</ExplorerLink>,
    },
  ];

  return (
    <div className="page-stack">
      <header className="page-head">
        <Kicker>Network</Kicker>
        <h1 className="page-title">Deployment</h1>
        <p className="addr">{protocol.protocolStatus}</p>
      </header>

      <Card
        title="Contract verification"
        footer="Expected values are compiled into this build and compared with the addresses read from chain. Rows marked Not checked have no on-chain source, so they stay unverified rather than confirmed."
      >
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.name}
          emptyMessage="No contracts configured."
        />
      </Card>

      <div className="grid">
        <Card title="Authorized signer">
          <AddressRow name="Signer" address={deployment.authorizedSigner} />
        </Card>

        <Card
          title="Backend"
          footer={
            monitor?.lastCheckedBlock === undefined
              ? "The backend has not reported a scanned block yet."
              : `The monitor has scanned ${CHAIN_NAME} up to block ${monitor.lastCheckedBlock.toLocaleString()}. A block number that stops advancing means the backend monitor is stalled.`
          }
        >
          <StatLine label="Health">{backend.healthState}</StatLine>
          <StatLine label="Monitor" mono>
            {monitor ? monitor.status : "unknown"}
          </StatLine>
          <StatLine label="Last checked block" mono>
            {monitor?.lastCheckedBlock === undefined
              ? "not reported"
              : monitor.lastCheckedBlock.toLocaleString()}
          </StatLine>
          <StatLine label="Policy signing">
            {backend.health?.policySigningEnabled ? "enabled" : "disabled"}
          </StatLine>
        </Card>
      </div>

      <Card title="Registry owner">
        <AddressRow name="Owner" address={deployment.registryOwner} />
        {!protocol.hasAuthorization && (
          <div className="callout-slot">
            <RiskCallout heading="Authorization mismatch">
              Pool authorization and registry consumer do not match. Swaps stay
              disabled until configuration is aligned.
            </RiskCallout>
          </div>
        )}
      </Card>
    </div>
  );
}
