import AddressRow from "../components/AddressRow";
import { useTrade } from "../context/TradeContext";
import { CONTRACTS } from "../lib/contracts";
import { etherscanAddressUrl } from "../lib/format";

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

  return (
    <div className="page-stack">
      <header className="page-header">
        <h1>Network</h1>
        <p className="muted">{protocol.protocolStatus}</p>
      </header>

      <div className="card">
        <h2>Contract verification</h2>
        <div className="address-list">
          {rows.map((row) => {
            const pass =
              row.observed?.toLowerCase() === row.expected.toLowerCase();
            return (
              <div key={row.name} className="verify-row">
                <AddressRow name={row.name} address={row.expected as `0x${string}`} />
                <span className={pass ? "verify-pass" : "verify-fail"}>
                  {pass ? "Pass" : "Mismatch"}
                </span>
                <a
                  href={etherscanAddressUrl(row.expected)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Etherscan
                </a>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>Authorized signer</h2>
          <AddressRow
            name="Signer"
            address={deployment.authorizedSigner}
          />
        </div>
        <div className="card">
          <h2>Backend</h2>
          <div className="row">
            <span>Health</span>
            <strong>{backend.healthState}</strong>
          </div>
          <div className="row">
            <span>Monitor</span>
            <strong>{monitor ? monitor.status : "unknown"}</strong>
          </div>
          <div className="row">
            <span>Last checked block</span>
            <strong>
              {monitor?.lastCheckedBlock === undefined
                ? "not reported"
                : monitor.lastCheckedBlock.toLocaleString()}
            </strong>
          </div>
          <div className="row">
            <span>Policy signing</span>
            <strong>
              {backend.health?.policySigningEnabled ? "enabled" : "disabled"}
            </strong>
          </div>
          <p className="muted" role="status" aria-live="polite">
            {monitor?.lastCheckedBlock === undefined
              ? "The backend has not reported a scanned block yet."
              : `The monitor has scanned Sepolia up to block ${monitor.lastCheckedBlock.toLocaleString()}. A block number that stops advancing means the backend monitor is stalled.`}
          </p>
        </div>
      </div>

      <div className="card">
        <h2>Registry owner</h2>
        <AddressRow name="Owner" address={deployment.registryOwner} />
        {!protocol.hasAuthorization && (
          <p className="warning">
            Pool authorization and registry consumer do not match. Swaps stay
            disabled until configuration is aligned.
          </p>
        )}
      </div>
    </div>
  );
}
