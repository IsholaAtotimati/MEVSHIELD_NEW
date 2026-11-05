# Public entry and release draft

Status: the landing page is in the frontend. Staging is deployed from `feature/sepolia-fork-demo`. I wrote the host, the env, and the manual deploy step in [staging-deploy.md](staging-deploy.md). The Vercel and Railway steps below are the earlier plan. They still work if you want that pair, and they are not what is running. Styles stay in `frontend/src/index.css`. Connect decisions stay in `frontend/src/lib/landingAction.ts`.

The public name in the product is **MEVShield**. The wordmark in the app is `MEV` plus a mint `Shield`.

## What is already true

The web app is one Vite single-page application. `frontend/src/App.tsx` mounts the trade page at `/` inside `AppShell`. Activity, portfolio, policies, and network sit beside it. There is no route guard. A visitor can open every page before a wallet is connected. The top bar already offers **Connect wallet**, and on a chain `31337` build it also offers **Use anvil account**.

The visual system is one stylesheet, `frontend/src/index.css`. Background `#090a0c`, text `#f3f0e8`, mint `#3ddc97`, amber `#e8a317`, bad `#ff5c5c`. Type is Outfit and IBM Plex Mono. A landing page uses those tokens and those two faces. It does not introduce a fourth accent.

There is no user table, no email login, and no Supabase client anywhere in this repository. A wallet address is the only identity the app stores, and it lives in the browser session. A personal Supabase project on a developer machine is outside this codebase. A public release does not need that project, and it should not be pointed at it.

The backend is already shaped for Railway. `railway.json` builds `backend/`, starts `npm --prefix backend start`, and health-checks `/health`. Demo signing is refused when `NODE_ENV` is `production` or when `RAILWAY_ENVIRONMENT_NAME` is set. The frontend has no host of its own. `frontend/.env.example` still points `VITE_API_URL` at `http://localhost:4000`.

The execute gate stays closed. `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` remains false until `test/SepoliaForkDeploymentAExecution.t.sol` passes against the deployed stack. See [ADR 0005](../decisions/0005-execute-gate-stays-closed.md). A public page can explain the product and let a wallet connect. It does not open signing or execution.

The local anvil page is a separate build. `./script/local-test-flow.sh` exports `VITE_CHAIN_ID=31337` and the nginx container `mevshield-local-test-frontend` serves `frontend/dist`. A public Sepolia bundle and that local bundle are different artifacts. Publishing one must leave the other intact.

## Entry patterns

All three keep the landing page inside this frontend, so the local anvil build and the Sepolia build can both be retested from the same routes.

### 1. Wallet-first landing

Chosen.

`/` becomes a public landing page outside `AppShell`. **Connect wallet** runs the existing `connectWallet` path, then sends the visitor to `/trade`. The current trade, activity, portfolio, policies, and network pages move under that shell and keep their present behavior. There is no email, no password, and no account row.

Returning visitors who already have a connected injected wallet can land on `/trade` directly. Disconnect leaves them in the app with the same connect prompt the top bar shows today. The landing page is an introduction, and the app remains usable once the wallet is connected.

On a chain `31337` build the landing page also shows **Use anvil account**, using the same rule as the top bar (`showsAnvilAccountButton`). That keeps the local retest path one click from the new front door.

This matches the product. The signer, the policy, and the swap are already bound to `msg.sender`. An account database would sit beside that fact and would not authorize anything on-chain.

### 2. Account first, wallet second

A new Supabase project, created for MEVShield and separate from any personal project, stores an email session. After sign-up or login the visitor still connects a wallet before `/trade` will submit anything. The session and the wallet are two identities. The contracts continue to trust only the wallet.

This adds a hosted database, auth redirects, email confirmation, and a decision about what the email is allowed to do. Today it would be allowed to do nothing the wallet cannot already do. It is the right shape if a later release needs a named user, a saved preference that must survive a browser reset, or a support trail. It is extra surface for the first public page.

### 3. Open app, landing as a preface

`/` stays the trade page. A new route, `/welcome`, holds the landing page, and the side nav or the top bar links to it. Deploying the current app is then a hosting change only.

This is the smallest code change. It also leaves the first URL a visitor sees as the trading console, with a connect prompt and a closed execute gate, before they have been told what the product is. The local test flow is undisturbed because `/` does not move.

## Hosting options

The frontend and the backend are different processes. The frontend is a static Vite build plus the visitor's wallet. The backend is a long-running Express process with pinned Sepolia config, an RPC client, an optional signer key, and a log monitor. They can be published separately.

| Option | Frontend | Backend | Fits this repo | Cost of the first public URL |
| --- | --- | --- | --- | --- |
| A. Vercel + Railway | New Vercel project, static `frontend/dist` | The existing Railway service | Yes. Railway is already described in `railway.json` and in the backend docs | Lowest. Two dashboards, one new project |
| B. Railway for both | Second Railway service, static files or a small Node host | Existing Railway service | Yes. One vendor | Similar effort, less familiar static hosting |
| C. One VPS | nginx for `frontend/dist` | The existing backend image | Yes. Dockerfiles already exist | More operating work: TLS, process restart, deploys |
| D. Supabase as the app host | Supabase does not serve this Vite app or this Express process | Same | No, unless pattern 2 is chosen, and then Supabase is only the account store | A personal Supabase project stays out of the release |

Recommended host pair: **option A**. Vercel publishes the landing page and the app. Railway keeps the API. The local Docker stack stays the retest environment and is not what gets a public domain.

Vercel builds the frontend with public `VITE_*` values only:

- `VITE_CHAIN_ID=11155111`
- `VITE_API_URL` set to the Railway origin
- `VITE_RPC_URL` set to a keyless public Sepolia endpoint, the same class of URL already in `frontend/.env.example`
- `VITE_SEPOLIA_DEMO_MODE` unset
- `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` unset

Railway then sets `FRONTEND_URL` to the Vercel origin so browser CORS allows the new page. `SIGNER_PRIVATE_KEY` stays in the Railway secret store. Signing stays off while the execute gate is closed.

The local test container is a third build. It keeps `VITE_CHAIN_ID=31337` and is produced only by `./script/local-test-flow.sh`. A Vercel production build must not be copied into `frontend/dist` while that container is running.

## What the first public release contains

1. A landing page at `/` in this frontend, using the existing tokens, type, and the line already used as the product principle: assess before execution, authorize explicitly, enforce on-chain.
2. The three-step explanation from the README, a short limit statement (experimental, Sepolia, the execute path is closed until the live-stack fork test passes), and one primary action.
3. Pattern 1. The primary action is **Connect wallet**, and the app routes move to `/trade`, `/activity`, `/portfolio`, `/policies`, and `/network`.
4. A Vercel project for that frontend, pointed at the existing Railway API, with the execute gate left closed.
5. A CORS update on Railway and a smoke check: `/` renders, connect reaches `/trade`, `/health` answers from the browser origin, and a production bundle shows Sepolia `11155111`.

## What the first public release leaves alone

- The execute gate and `MEVSHIELD_V2_POLICY_ENABLED`.
- Contract addresses and the Sepolia deployment.
- The anvil keys, the local compose stack, and the local bundle guard.
- Any personal Supabase project.
- Mainnet, a custom domain beyond the first Vercel hostname, and analytics.

## Release sequence

1. Entry pattern confirmed: wallet-first landing.
2. Add the landing route inside the existing Vite app and move the console routes. Retest on the local anvil page and with `npm run dev` on Sepolia.
3. Create a Vercel project from this repository, root directory `frontend`, build command the existing `npm run build`, output `dist`. Set the public env vars above at build time. `VITE_CHAIN_ID` must be `11155111` for that project.
4. Point `VITE_API_URL` at the live Railway origin and set Railway `FRONTEND_URL` to the Vercel origin. Confirm `GET /health` from the deployed page.
5. Walk the public page: landing copy, connect, `/trade` with the gate still closed, disconnect, and a direct visit to `/trade`.
6. Record the URLs and the still-closed gate in this page, then remove the draft status.

## Architecture

Approved.

`TradeProvider` keeps wrapping the router, so the landing page calls the same `connectWallet` and `connectAnvil` hooks as the top bar.

| Path | Layout | Page |
| --- | --- | --- |
| `/` | Landing, outside `AppShell` | New `LandingPage` |
| `/trade` | `AppShell` | Current `TradePage` |
| `/activity` | `AppShell` | Current `ActivityPage` |
| `/portfolio` | `AppShell` | Current `PortfolioPage` |
| `/policies` | `AppShell` | Current `PoliciesPage` |
| `/network` | `AppShell` | Current `NetworkPage` |
| anything else | redirect to `/` | Landing |

The side nav Trade link changes from `/` to `/trade`. The landing page has its own header: wordmark, and the wallet action. It does not render the side nav, the demo banner, or the top bar.

Connect behavior:

- No account yet. **Connect wallet** runs `planConnectWallet`. A returned account navigates to `/trade`. A refusal or a failure stays on `/` and shows `wallet.walletStatus`.
- Account already connected. The primary action reads **Enter app** and links to `/trade`. The short address is shown beside it.
- Local chain `31337` with no account. **Use anvil account** is shown when `showsAnvilAccountButton` is true. Success also navigates to `/trade`.
- Wrong network after a successful connect. Navigation still goes to `/trade`. The existing top-bar warning asks for the built chain.
- Direct visit to `/trade` or any other console route with no wallet. The page renders, and the top bar offers connect, as it does today.
- Disconnect. The visitor stays on the current console route.

Unknown paths resolve to the landing page. A pure helper, tested next to `walletConnect.test.mjs`, decides the primary action from whether an account is present. The connect plan itself stays in `walletConnect.ts`.

## Layout

Approved: split hero. The browser selection was `split`.

Wide viewport: wordmark and the wallet action on one header row. Below that, two columns. The left column holds the kicker, the headline, the lede, and the amber limit. The right column holds three step cards. Below about 800px the columns stack, and the steps follow the limit.

Copy, locked with the layout:

- Kicker: Programmable execution
- Headline: Assess before execution. Authorize explicitly. Enforce on-chain.
- Lede: Set the conditions for a USDC swap. MEVShield signs them into a policy and the router checks them when the swap runs.
- Limit, public chain: Experimental. Sepolia testnet. The execute path stays closed until the live deployment is verified.
- Limit, chain 31337: Experimental. Local anvil. Test tokens have no real-world value.
- Steps: 01 Assess, a deterministic risk check before anything is signed. 02 Authorize, you sign an execution policy for this swap. 03 Enforce, the router rejects a swap that breaks the policy.

The page uses the existing tokens and the existing `Button` component. Primary is mint. The limit uses the amber treatment already used by the demo banner. No fourth accent. Styles stay in `frontend/src/index.css`.

## Page behavior

Approved.

`frontend/src/pages/LandingPage.tsx` renders the split. `frontend/src/lib/landingAction.ts` is a pure helper:

- An account present returns `{ kind: "enter", label: "Enter app", to: "/trade" }`.
- No account returns `{ kind: "connect", label: "Connect wallet" }`.

The page turns `kind: "enter"` into a link to `/trade` and shows `shortAddress`. It turns `kind: "connect"` into the existing `connectWallet` call. After that call, a non-null account navigates to `/trade`. The anvil button uses `showsAnvilAccountButton` and `connectAnvil`, then the same navigation. `wallet.walletStatus` renders under the actions when it is a failure or a refusal. A wrong network still navigates.

Files:

- Create `frontend/src/pages/LandingPage.tsx`
- Create `frontend/src/lib/landingAction.ts`
- Create `frontend/src/lib/landingAction.test.mjs` and add it to the `test` script in `frontend/package.json`
- Modify `frontend/src/App.tsx` routes
- Modify `frontend/src/layout/SideNav.tsx` so Trade points at `/trade`
- Modify `frontend/src/index.css` with the landing classes
- Modify `docs/services/frontend.md` route map

The connect plan in `walletConnect.ts` stays unchanged. Its tests stay unchanged.

Check, once this section is approved: the landing page in the browser on a Sepolia dev server and on the local anvil page, including connect, refusal, enter-app, and a direct visit to `/trade`.

## Hosting

Staging is the Coolify copy in [staging-deploy.md](staging-deploy.md). The local anvil stack stays local. Demo mode and the execute gate stay unset. Vercel for the frontend and Railway for the API remain a valid second copy. They are not the staging host.
