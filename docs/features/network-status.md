# Network status

**Status: partial.** Four of the six contract rows compare a configured address with a value read from chain. The hook and the router have no on-chain source, so those rows stay Not checked. The page also reports backend health and monitor state. It still cannot detect the deployment drift that matters most, which is bytecode.

The Network page is the operator-facing view of whether the app is pointed at the right contracts and whether the backend is alive.

## What it does

### Contract verification

Six rows, built by `buildVerificationRows` in [frontend/src/lib/networkVerification.ts](../../frontend/src/lib/networkVerification.ts). A row reaches Pass or Mismatch only when the observed value was read from chain. A missing read is Not checked, with the reason `no chain read yet`. It is not a pass.

| Row | Expected | Observed from | Verdict |
| --- | --- | --- | --- |
| PoolManager | Configured `poolManager` | `MEVShieldHook.poolManager()` | Pass or Mismatch once the read returns |
| MEVShieldHook | Configured hook | None. No PoolManager getter names the hook for this pool | Not checked, `no on-chain source` |
| PolicyRegistry | Configured registry | `PolicyAuthorization.registry()` | Pass or Mismatch once the read returns |
| PolicyVerifier | Configured verifier | `PolicyAuthorization.verifier()` | Pass or Mismatch once the read returns |
| PolicyAuthorization | Configured authorization | `MEVShieldHook.authorization()` | Pass or Mismatch once the read returns |
| MEVShieldRouter | Configured router | None. Nothing on chain records which router this app expects | Not checked, `no on-chain source` |

The hook and router rows used to compare a constant with itself, and PolicyAuthorization compared two keys that held the same literal, so those three rows could not fail. They now either read a chain value or say they were not checked. The footer on the card says the same thing.

### Deployment readiness

`useProtocol` reads seven values once on mount and derives two booleans:

- `protocolAddressesVerified` requires the hook's PoolManager, the authorization's registry and verifier, and the verifier's authorized signer to all equal the expected constants ([frontend/src/hooks/useProtocol.ts:106](../../frontend/src/hooks/useProtocol.ts#L106)).
- `hasAuthorization` requires the registry's `authorizedConsumer` to equal the authorization address ([frontend/src/hooks/useProtocol.ts:100](../../frontend/src/hooks/useProtocol.ts#L100)).

Both feed the readiness chain. A failure in either blocks policy creation and execution before any transaction is attempted.

### Backend health

The page shows `healthState`, the monitor status, the last checked block and whether policy signing is enabled ([frontend/src/pages/NetworkPage.tsx:92](../../frontend/src/pages/NetworkPage.tsx#L92)).

The last-checked-block row carries an explicit warning that a number that stops advancing means the monitor is stalled ([frontend/src/pages/NetworkPage.tsx:105](../../frontend/src/pages/NetworkPage.tsx#L105)). That is the only place in the UI where a stalled monitor is visible.

### Registry owner

A single row showing the registry owner, plus a warning when the pool authorization and registry consumer disagree ([frontend/src/pages/NetworkPage.tsx:114](../../frontend/src/pages/NetworkPage.tsx#L114)).

## What it depends on

| Dependency | Why |
| --- | --- |
| Public RPC | All contract reads |
| Backend `/health` | Monitor and signing state |
| Static address constants | The expected values |
| `useProtocol` on mount | No refresh control and no polling |

## Known limitations

- **Hook and router rows cannot fail.** Nothing on chain names the hook for the pool or names the router, so those two rows stay Not checked. A wrong hook or router address in the build is not caught here.
- **No refresh.** `loadProtocol` runs once on mount. After a redeploy, the page shows stale observed values until reload.
- **No polling for protocol state.** Only the backend health poll is periodic, at 15 seconds.
- **The row verdict ignores `protocolAddressesVerified`.** A row can show Pass while the derived boolean is false, because the row compares a narrower pair of values. The warning is only rendered for the consumer mismatch.
- **No bytecode or codehash check.** The page confirms addresses and immutables, not that the code at those addresses is the code in this repository. The deployed router was investigated separately and matched the HEAD runtime after normalisation, but nothing in the UI performs that comparison. See `docs/reviews/2026-10-28-router-bytecode-investigation.md` on the `fix/router-source-of-truth` branch.
- **No chain guard on the reads.** `useProtocol` reads through a client fixed to Sepolia, so a wrong-wallet-network does not change these results. The wallet network is reported separately in the top bar.
- **No signer address verification.** The page displays `deployment.authorizedSigner` but does not compare it to `CONTRACTS.authorizedSigner` in that row; the comparison happens inside `protocolAddressesVerified`.

## Related pages

- [Frontend service](../services/frontend.md).
- [Monitoring](../services/monitoring.md).
- [Configuration](../operations/configuration.md).
- [ADR 0003](../decisions/0003-config-sourced-pool-identity.md).
