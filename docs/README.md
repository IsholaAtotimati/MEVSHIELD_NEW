# MEVShield documentation

This is the documentation set for the MEVShield repository at branch `feature/web-app-redesign`, commit `a0120d96`. Everything here is derived from the source in this repository. It is not derived from `README.md`, and it is not derived from the older briefs under `docs/eae/` and `docs/assignments/`, which describe router getters that do not exist.

If a statement here and a statement in `README.md` disagree, this documentation is the one written against the code.

## Where to start

| You are | Start with |
| --- | --- |
| New to the project, want the shape of the system | [Architecture overview](architecture/overview.md) |
| Auditing what the contracts actually enforce | [Overview: what is enforced on-chain](architecture/overview.md#what-is-enforced-on-chain), then [Contracts](architecture/contracts.md) |
| Integrating with the backend | [API reference](api/reference.md) |
| Running or deploying it | [Configuration](operations/configuration.md), then [Testing](operations/testing.md) |
| Understanding why something is the way it is | [Decisions](decisions/) |
| Checking whether a user-facing capability works | [Features](features/) |

## Sections

### Architecture

How the system is built and where the boundaries are.

| Page | Answers |
| --- | --- |
| [overview.md](architecture/overview.md) | What the three layers are, where the trust boundaries sit, and exactly what is enforced on-chain versus off-chain |
| [contracts.md](architecture/contracts.md) | Each contract's responsibility, external surface, immutables, access control, events and errors |
| [data-model.md](architecture/data-model.md) | The policy struct in its four declarations, how `policyId` is derived, the nonce lifecycle, and the ERC-20 settlement path |

Audience: engineers reading the code, reviewers assessing the security properties, and anyone who needs to know whether a constraint is enforced or merely reported.

### Services

How each runtime component behaves.

| Page | Answers |
| --- | --- |
| [backend.md](services/backend.md) | The Express service: modules, startup requirements, the Sepolia pinning, the signing gate, the risk model, logging |
| [frontend.md](services/frontend.md) | The React app: routes, hooks, context, page responsibilities, and the readiness gate chain |
| [monitoring.md](services/monitoring.md) | The Sepolia log monitor, correlation ids, the structured log format, and where it fails open |

Audience: anyone operating or extending a service, and anyone debugging a request that spans layers.

### Reference

| Page | Answers |
| --- | --- |
| [api/reference.md](api/reference.md) | Every HTTP route, its request and response schema with field-level validation, and every error status |

Audience: integrators, and anyone writing a client against the backend.

### Features

One page per user-facing capability, each stating its status, what it does, what it depends on, and its known limitations.

| Page | Status |
| --- | --- |
| [protected-swap.md](features/protected-swap.md) | Gated |
| [risk-preview.md](features/risk-preview.md) | Shipped, with a formula that does not vary by risk |
| [policy-lifecycle.md](features/policy-lifecycle.md) | Partial: no cancellation, no full-policy commitment, no caller authentication |
| [activity-history.md](features/activity-history.md) | Partial: local history complete, on-chain history bounded and incomplete |
| [portfolio-and-approvals.md](features/portfolio-and-approvals.md) | Shipped |
| [network-status.md](features/network-status.md) | Partial: three of six verification rows are tautologies |

Audience: product readers, testers, and anyone deciding what to build next.

Status vocabulary:

- **shipped**: the capability works in the committed configuration.
- **partial**: some of the capability works; the page names what does not.
- **gated**: implemented, but blocked by a deliberate configuration flag.
- **not built**: named as intended and absent from the code.

### Operations

| Page | Answers |
| --- | --- |
| [configuration.md](operations/configuration.md) | Every environment variable in all three layers, with required or optional, default, purpose and a safety note |
| [testing.md](operations/testing.md) | How to run each suite, what each covers, which fork suites are gated, and why the V2 fork suite does not test the deployed router |
| [runbook/local-docker.md](runbook/local-docker.md) | Bringing the whole stack up locally in Docker against anvil: the images, the compose services, the deploy and seed scripts, the verification script, and the ports |

Audience: whoever runs the system.

### Decisions

Architecture Decision Records in the standard form: Title, Status, Context, Decision, Consequences.

| Record | Decision |
| --- | --- |
| [0001](decisions/0001-signed-policy-authorization.md) | Signed policy authorization model |
| [0002](decisions/0002-router-versus-hook-enforcement-split.md) | Router versus hook enforcement split |
| [0003](decisions/0003-config-sourced-pool-identity.md) | Read pool id and hook from configuration rather than router getters |
| [0004](decisions/0004-fail-closed-sepolia-configuration.md) | Fail-closed Sepolia configuration |
| [0005](decisions/0005-execute-gate-stays-closed.md) | Execute gate stays closed until a live-stack fork test passes |

Audience: anyone who needs to know why a choice was made before changing it.

### Reviews

[docs/reviews/](reviews/) holds dated review records. They are development records, not independent audits. The 28 October 2026 review includes a closure status section that names the commit for each finding.

## Conventions used here

- File references appear as links with line anchors, for example `src/MEVShieldHook.sol:114`. They point at commit `a0120d96`.
- "Enforced" means a check that reverts a transaction. "Reports" or "gates" means a check that only influences what a client will submit.
- Where a constraint is described as enforced somewhere weaker than the product wording implies, the page says so and names the file.
- Contract addresses, chain ids and pool ids are quoted from source, not from the README.

## Known inaccuracies in other material

Two documents in the repository describe behaviour that does not exist and should not be relied on:

- Any brief claiming the deployed router exposes `protectedPoolId()` or `protectedHook()`. Those functions were never in committed or deployed source. The selectors are absent from the deployed runtime and both calls revert. See [ADR 0003](decisions/0003-config-sourced-pool-identity.md).
- `README.md` describes the system in product terms and includes a roadmap. A checked roadmap box there records development progress, not that a gap in the enforcement boundary has closed.

## The short version

Contracts enforce signature, expiry, nonce, pool binding, swap-parameter binding and a non-zero minimum output in the hook ([src/MEVShieldHook.sol:76](../src/MEVShieldHook.sol#L76)). The router enforces realized minimum output and the 600-tick price-limit distance ([src/MEVShieldRouter.sol:154](../src/MEVShieldRouter.sol#L154)). The `maxLoss` and `maxFee` caps are compared against caller-supplied estimates, not measured on-chain. The UI cannot execute a protected swap in the committed configuration, and that gate is intentional.
