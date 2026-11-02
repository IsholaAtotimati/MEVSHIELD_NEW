# Developing

Start with [How to test](../runbook/how-to-test.md) when you need to prove the branch. This page is for the next edit: where the code lives, which command to run, and which gates stay closed. Commit messages are in [Committing](committing.md). The map of the rest of the docs is [the index](../README.md).

Dated notes in `docs/reviews/` record the day they were written. Current behaviour is the feature pages, the runbooks, and [the changelog since 8a676f6d](../reviews/changelog-since-8a676f6d.md).

## Layout

| Path | What you change |
| --- | --- |
| `src/` | Hook, router, and policy contracts |
| `test/` | Forge suites, including the gated Sepolia fork tests |
| `script/` | Deploy scripts and the local Docker and test-flow scripts |
| `backend/src/` | Express API, signing, risk, and the Sepolia monitor |
| `frontend/src/` | React app, wallet, quote gates, and pages |
| `docker/` | Compose stack and the environment example |
| `docs/` | The pages in the index. A new guide goes under `docs/guides/` |

The root `package.json` has no scripts. Run Forge from the repository root, and npm from `backend/` or `frontend/`.

## Gates that stay closed

- `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` stays false. That is the Sepolia execute gate. See [ADR 0005](../decisions/0005-execute-gate-stays-closed.md).
- The backend accepts chain 31337 only when `MEVSHIELD_LOCAL_CHAIN_ENABLED` is the literal `true`, `NODE_ENV` is not `production`, and Railway is unset. See [ADR 0004](../decisions/0004-fail-closed-sepolia-configuration.md).
- Do not commit a private key, a populated `.env`, or `docker/.env.docker`.

## Commands while you edit

Contracts, from the repository root, with Foundry on `PATH`:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge test
```

A plain `forge test` skips the fork suites. The Sepolia fork sandwich is Test C in [how to test](../runbook/how-to-test.md).

Backend:

```bash
cd backend
npm test
npm run build
```

Frontend:

```bash
cd frontend
npm test
npm run lint
npm run build
```

The `test` script in each `package.json` names its files. A new test file has to be added to that script or it will not run. The file list and the last recorded totals are in [Testing](../operations/testing.md).

The local anvil stack and the chain 31337 page are [local Docker](../runbook/local-docker.md) and [local test flow](../runbook/local-test-flow.md). Test A in the how-to-test page is the click-through. It stops at policy registration.

## Before a commit

Run the suite you touched. The commit message follows [committing.md](committing.md): a scoped subject and at least one bullet sentence that says why.
