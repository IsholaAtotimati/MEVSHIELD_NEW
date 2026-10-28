# Network status

**Status: partial.** The page reads live deployment state for four of its six contract rows and reports backend health and monitor state. The remaining two rows compare constants to themselves, and the page cannot detect the deployment drift that matters most.

The Network page is the operator-facing view of whether the app is pointed at the right contracts and whether the backend is alive.

## What it does

### Contract verification

Six rows, each with a name, an expected address, an observed address and a pass or mismatch verdict ([frontend/src/pages/NetworkPage.tsx:18](../../frontend/src/pages/NetworkPage.tsx#L18)).

| Row | Expected | Observed from | Can this row ever fail |
| --- | --- | --- | --- |
| PoolManager | `0xE03A…3543` | `MEVShieldHook.poolManager()` | Yes |
| MEVShieldHook | `0xd15E…0080` | The same constant | No |
| PolicyRegistry | `0xB289…1c9E` | `PolicyAuthorization.registry()` | Yes |
| PolicyVerifier | `0x716f…b79f` | `PolicyAuthorization.verifier()` | Yes |
| PolicyAuthorization | `0xefC9…d7c5` | The same constant, under a second key | No |
| MEVShieldRouter | `0x6332…150D` | The same constant | No |

Three rows are tautologies. `observed` for the hook and the router is the constant itself, and `CONTRACTS.poolAuthorization` is the same literal string as `CONTRACTS.policyAuthorization` ([frontend/src/lib/contracts.ts:28](../../frontend/src/lib/contracts.ts#L28)). Those rows always render Pass. They document the configuration, they do not verify it.

The other three do verify something: the hook's PoolManager immutable, and the authorization contract's registry and verifier immutables.

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

- **Three tautological rows.** The hook, router and authorization rows cannot detect a mismatch.
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
