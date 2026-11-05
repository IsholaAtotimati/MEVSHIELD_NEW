# Staging deploy, from me to you

I put a staging copy of this branch on my own server. It is public, it is Sepolia, and the execute path is still closed. It is not a production release. `main` does not have the landing page yet, so I deployed `feature/sepolia-fork-demo`.

You can stand up the same pair on Coolify, or on anything else that builds these two Dockerfiles. Railway and Vercel still work. Nothing in the code requires them. `railway.json` is only a start command and a health check for Railway. `RAILWAY_ENVIRONMENT_NAME` is read for one reason: when it is set, demo signing stays off. On Coolify that variable is absent, which is the safe direction.

My URLs:

- Site: https://mevshield-staging.eykegai.com
- API: https://mevshield-api-staging.eykegai.com/health

`/health` answers with chain `11155111`, `policySigningEnabled` false, and `localDemoMode` false. The JSON field `environment` is `NODE_ENV`. I set that to `production` so the local-chain gate and the demo gate stay shut. It does not mean this hostname is production.

## What you are deploying

Two processes, from the Dockerfiles that are already in the repo. Do not deploy `docker-compose.yml`. That file is the local anvil stack, with published development keys, and it must stay on a laptop.

| App | Context | Dockerfile | Listen | Health |
| --- | --- | --- | --- | --- |
| API | `backend/` | `backend/Dockerfile` | 4000 | `GET /health` |
| Site | `frontend/` | `frontend/Dockerfile` | 8080 | `GET /healthz` |

The root `.dockerignore` excludes `backend/` and `frontend/` because the contracts image is built from the repo root. If your platform builds with the repo root as the Docker context, those directories will be missing and the image build will fail. Set the base directory to `backend` for the API and `frontend` for the site, so each build uses that directory's own Dockerfile and `.dockerignore`.

`VITE_*` values are baked in when the frontend image builds. Changing one means rebuilding that image. They are public. Do not put a signer key or an RPC provider key in any `VITE_` variable.

## What I set

API, runtime only:

| Name | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `LOG_LEVEL` | `info` |
| `CHAIN_ID` | `11155111` |
| `FRONTEND_URL` | `https://mevshield-staging.eykegai.com` |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| Verifier, router, hook, registry, and `PROTECTED_POOL_*` | The values in `backend/.env.example` |

Those pool and address values have to match the pins in `backend/src/config/runtimeConfig.ts`. If they drift, the process exits on startup instead of serving the wrong pool. I left `SIGNER_PRIVATE_KEY` unset. I left `MEVSHIELD_V2_POLICY_ENABLED` false. I left `MEVSHIELD_SEPOLIA_DEMO_ENABLED` false. I did not set `MEVSHIELD_LOCAL_CHAIN_ENABLED`. `POST /policy` stays 503 until we deliberately open signing.

Site, build arguments:

| Name | Value |
| --- | --- |
| `VITE_CHAIN_ID` | `11155111` |
| `VITE_API_URL` | `https://mevshield-api-staging.eykegai.com` |
| `VITE_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` |
| `VITE_EXPLORER_URL` | `https://sepolia.etherscan.io` |

I did not set `VITE_SEPOLIA_DEMO_MODE` or `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED`. The bundle marker is `mevshield-built-chain:11155111`. Contract addresses on Sepolia already have defaults in the frontend, so I did not override them.

`FRONTEND_URL` and `VITE_API_URL` are a pair. The first is the origin the browser uses for the site, and it is the only CORS origin the API allows. The second is the origin the browser uses for the API. Both are the public `https` names. A typo does not crash the process. The page loads and the browser calls fail.

On your copy, use your own two hostnames in those two variables. Keep every other value in the tables above.

## If you use Coolify

Create one project, put both apps in an environment you name `staging`, and point both at this repository and branch `feature/sepolia-fork-demo`. Build pack is Dockerfile. Expose port `4000` on the API and `8080` on the site.

Mark the `VITE_*` variables as build-time. Mark the API variables as runtime. Deploy the API first and confirm `/health`, then deploy the site. The site image has to be built after `VITE_API_URL` is set, because that URL is compiled into the JavaScript.

The backend image has no `curl`. Coolify's own health probe runs `curl` inside the container, so I turned that probe off. The image already has a health check that uses Node. If your Coolify deploy fails in the first minute with a healthy-looking container and then rolls it back, that probe is the reason. The frontend image has `wget`, which its own health check uses.

## What is specific to my server

My Coolify box still has cPanel Apache on ports 80 and 443. Coolify's proxy listens on `127.0.0.1:8088`. I created the two subdomains in cPanel and proxied each vhost to that port, with `X-Forwarded-Proto: https` on the TLS vhost. In Coolify I set the app domains as `http://` names, because Apache owns the certificate. Visitors still use `https://`.

If your Coolify proxy owns 443 itself, skip the Apache step. Give each app an `https://` domain and let Coolify issue the certificate. Then set `FRONTEND_URL` and `VITE_API_URL` to those `https` origins and rebuild the site.

The local anvil page on my laptop is a third build. It is `VITE_CHAIN_ID=31337`, produced only by `./script/local-test-flow.sh`. Do not point a public hostname at it, and do not copy a Sepolia `frontend/dist` over it while that container is running.

## A push deploys staging

Pushing to `Eykegai/mevshield` `development` deploys both apps automatically. The `eykegai-coolify` GitHub App has the webhook `https://coolify.eykegai.com/webhooks/source/github/events` with the secret stored in this Coolify source, and each push has rebuilt both containers on its own.

- A frontend change needs the site rebuild only. An API change needs the API rebuild only. A `VITE_*` change is a site rebuild even when the backend did not change.
- The other resources on this server do not follow a Git branch: `whoami` is a published image, `japa-wordpress` is a Coolify template, and `social-wowonder` and `jpool-app` were built from directories on the VPS.

## Where the deploy source lives now

Both apps now build from **`Eykegai/mevshield`** (private org repo), branch **`development`**, through the `eykegai-coolify` GitHub App. The app is installed on the org with only `Eykegai/mevshield` selected. `development` holds the full `feature/sepolia-fork-demo` history, including the docs commit, and is the repo's default branch. `IsholaAtotimati/MEVSHIELD_NEW` stays my working mirror; until a mirror step is automated, a deploy source change has to be pushed to both. When this work lands on `main`, I will point the apps at `main` and redeploy.

The deploy webhook was already configured during the app registration. Do not change it: the URL is `https://coolify.eykegai.com/webhooks/source/github/events` and the secret is the one stored in this Coolify source.

I push both remotes with one command, `./script/push-both.sh`. It sends the current branch to `origin` under its own name and to `eykegai` as `development`, and it refuses to run on `main`.

## What I check after a deploy

1. `GET /health` returns chain `11155111`, signing off, demo mode off.
2. `/` is the landing page and says Sepolia, and it says the execute path stays closed.
3. `/trade` is the swap console and the top bar reads `Sepolia · 11155111`.
4. A request from the site origin to `/health` includes `Access-Control-Allow-Origin` for that origin.
5. `POST /policy` returns 503.
