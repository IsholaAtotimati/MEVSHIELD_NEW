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
import { verificationTone } from "../lib/statusTone";

type ContractRow = {
  name: string;
  expected: string;
  observed: string | null;
};

export default function NetworkPage() {
  const { protocol, backend } = useTrade();
  const { deployment } = protocol;
  const monitor = backend.health?.sepoliaMonitor;

  const rows: ContractRow[] = [
    {
      name: "PoolManager",
      expected: CONTRACTS.poolManager,
      observed: deployment.poolManager,
    },
    {
      name: "MEVShieldHook",
      expected: CONTRACTS.mevShieldHook,
      observed: CONTRACTS.mevShieldHook,
    },
    {
      name: "PolicyRegistry",
      expected: CONTRACTS.policyRegistry,
      observed: deployment.registry,
    },
    {
      name: "PolicyVerifier",
      expected: CONTRACTS.policyVerifier,
      observed: deployment.verifier,
    },
    {
      name: "PolicyAuthorization",
      expected: CONTRACTS.policyAuthorization,
      observed: CONTRACTS.poolAuthorization,
    },
    {
      name: "MEVShieldRouter",
      expected: CONTRACTS.mevShieldRouter,
      observed: CONTRACTS.mevShieldRouter,
    },
  ];

  const columns: DataTableColumn<ContractRow>[] = [
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
      status: (row) => verificationTone(row.observed, row.expected),
      render: (row) =>
        verificationTone(row.observed, row.expected) === "ok"
          ? "Pass"
          : "Mismatch",
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
        footer="Expected values are compiled into this build. A mismatch keeps swaps disabled."
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
