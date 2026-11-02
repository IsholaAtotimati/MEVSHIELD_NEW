# Hosted demo deployment

This configures a **read-only Sepolia demo**: the frontend displays a
deterministic estimate and can request the backend's risk preview. It does not
sign policies or offer swap execution. Do not turn on policy signing or the
minimum-output verification flag for this demo.

The backend's existing `isLocalSepoliaDemoEnabled` deliberately refuses demo
signing when `RAILWAY_ENVIRONMENT_NAME` is present. Keep that behavior. The
backend must run with `MEVSHIELD_V2_POLICY_ENABLED=false`; it does not need a
signer private key for risk previews.

## Railway backend

Create a Railway service from the repository root and use the committed
[`railway.json`](../../railway.json). It installs and builds `backend/`, starts
the compiled service, and checks `GET /health`. The backend binds to
`0.0.0.0` and uses Railway's `PORT`.

Set these Railway variables:

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `CHAIN_ID` | `11155111` |
| `PORT` | Leave unset; Railway provides it |
| `FRONTEND_URL` | Exact Vercel origin, e.g. `https://your-project.vercel.app`. Multiple allowed origins may be comma-separated |
| `MEVSHIELD_V2_POLICY_ENABLED` | `false` |
| `MEVSHIELD_SEPOLIA_DEMO_ENABLED` | `false` |
| `SEPOLIA_RPC_URL` | A working Sepolia RPC URL |
| `POLICY_VERIFIER_ADDRESS` | Existing configured Sepolia verifier address |
| `ROUTER_ADDRESS` | Existing configured Sepolia router address |
| `PROTECTED_POOL_CURRENCY0` | Existing configured pool currency0 |
| `PROTECTED_POOL_CURRENCY1` | Existing configured pool currency1 |
| `PROTECTED_POOL_FEE` | Existing configured pool fee |
| `PROTECTED_POOL_TICK_SPACING` | Existing configured pool tick spacing |
| `PROTECTED_POOL_HOOK` | Existing configured pool hook |
| `PROTECTED_POOL_ID` | Existing configured pool ID |

`POLICY_REGISTRY_ADDRESS` and `HOOK_ADDRESS` are optional for the backend's
monitor; set them with the existing configured addresses if monitoring is
desired. Do not set `SIGNER_PRIVATE_KEY` for this read-only demo. Do not enable
either signing flag.

The health endpoint reports process/configuration health, not Sepolia RPC or
pool health. `POST /risk-preview` requires a reachable RPC and initialized
pool; failures are returned as errors rather than replaced by simulated backend
data.

## Vercel frontend

Create a Vercel project with **Root Directory** `frontend`. The included
[`vercel.json`](../../frontend/vercel.json) builds with `npm run build`, serves
`dist`, and rewrites SPA routes to `index.html`, so refreshing nested routes
continues to work.

Set these Vercel **Production** environment variables, then redeploy:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | Railway public HTTPS URL, without a trailing slash |
| `VITE_CHAIN_ID` | `11155111` |
| `VITE_RPC_URL` | A browser-reachable Sepolia RPC URL |
| `VITE_READ_ONLY_DEMO_MODE` | `true` |
| `VITE_SEPOLIA_DEMO_MODE` | `false` |
| `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` | `false` |

The Vite variables are public and embedded in the bundle. Never put a private
key, RPC provider secret, or other credential in a `VITE_*` variable. The
frontend talks directly to the Sepolia RPC for read-only pool, protocol and
wallet reads; RPC providers must allow browser requests from the deployed site.

## Data and repository notes

- Activity and policy preferences use browser `localStorage`; they are per
  browser and are not shared with Railway or other users.
- Backend observability is emitted to stdout for Railway logs. It is not
  persisted to a local history file.
- Ignore `backend/.local-demo/`; local `history.json` content is not deployment
  data and must not be committed.
- `.env` files and local overrides are ignored. Commit only placeholder
  `.env.example` files.

## GitHub and release steps

Review the complete local diff and ensure the deployment variables are set in
Railway/Vercel dashboards, not committed to GitHub. No commit, push, or cloud
deployment is part of this preparation.

From the repository root, validate locally:

```sh
npm --prefix backend ci
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend ci
npm --prefix frontend test
npm --prefix frontend run build
git diff --check
```

After review and approval, push the reviewed branch to GitHub, create/connect
the Railway service, then create/connect the Vercel project. Set Railway's
`FRONTEND_URL` to the final Vercel origin before testing the Vercel app.

## Demo versus production

The fixed rate shown in the frontend is a simulated estimate. Backend risk
preview is a deterministic MVP calculation, not live-market analysis.
`VITE_READ_ONLY_DEMO_MODE` enables only that estimate/preview presentation in a
production bundle. Signing and execution remain disabled, and registered
policies or successful swaps must not be implied by demo UI or local browser
history. Normal production execution remains unavailable pending quote
simulation and deployment verification.
