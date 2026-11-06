# syntax=docker/dockerfile:1.7
#
# MEVShield frontend image. Build context is ./frontend (see docker-compose.yml).
#
# Build-time configuration: the app is a Vite SPA, so every VITE_* value is
# inlined into the JavaScript at build time. They are accepted as build args so
# a local image can point at anvil. All of them are public — never pass a secret.
#
# No VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED default is provided on purpose:
# the gate stays closed unless an operator explicitly passes "true".

# ---------------------------------------------------------------------------
# Stage 1: build the static bundle
# ---------------------------------------------------------------------------
FROM node:22.20.0-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --ignore-scripts --no-audit --no-fund

COPY . .

# Declared after the source copy is irrelevant to caching, but they must be
# visible before `vite build` runs so Vite can inline them.
ARG VITE_API_URL=http://localhost:4000
ARG VITE_CHAIN_ID=11155111
ARG VITE_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
ARG VITE_EXPLORER_URL=
ARG VITE_SEPOLIA_DEMO_MODE=false
ARG VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=false
ARG VITE_POOL_MANAGER_ADDRESS=
ARG VITE_POLICY_REGISTRY_ADDRESS=
ARG VITE_POLICY_VERIFIER_ADDRESS=
ARG VITE_POLICY_AUTHORIZATION_ADDRESS=
ARG VITE_MEVSHIELD_HOOK_ADDRESS=
ARG VITE_MEVSHIELD_ROUTER_ADDRESS=
ARG VITE_AUTHORIZED_SIGNER_ADDRESS=
ARG VITE_TOKEN0_ADDRESS=
ARG VITE_TOKEN1_ADDRESS=
ARG VITE_TOKEN0_SYMBOL=
ARG VITE_TOKEN1_SYMBOL=

ENV VITE_API_URL=$VITE_API_URL \
    VITE_CHAIN_ID=$VITE_CHAIN_ID \
    VITE_RPC_URL=$VITE_RPC_URL \
    VITE_EXPLORER_URL=$VITE_EXPLORER_URL \
    VITE_SEPOLIA_DEMO_MODE=$VITE_SEPOLIA_DEMO_MODE \
    VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=$VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED \
    VITE_POOL_MANAGER_ADDRESS=$VITE_POOL_MANAGER_ADDRESS \
    VITE_POLICY_REGISTRY_ADDRESS=$VITE_POLICY_REGISTRY_ADDRESS \
    VITE_POLICY_VERIFIER_ADDRESS=$VITE_POLICY_VERIFIER_ADDRESS \
    VITE_POLICY_AUTHORIZATION_ADDRESS=$VITE_POLICY_AUTHORIZATION_ADDRESS \
    VITE_MEVSHIELD_HOOK_ADDRESS=$VITE_MEVSHIELD_HOOK_ADDRESS \
    VITE_MEVSHIELD_ROUTER_ADDRESS=$VITE_MEVSHIELD_ROUTER_ADDRESS \
    VITE_AUTHORIZED_SIGNER_ADDRESS=$VITE_AUTHORIZED_SIGNER_ADDRESS \
    VITE_TOKEN0_ADDRESS=$VITE_TOKEN0_ADDRESS \
    VITE_TOKEN1_ADDRESS=$VITE_TOKEN1_ADDRESS \
    VITE_TOKEN0_SYMBOL=$VITE_TOKEN0_SYMBOL \
    VITE_TOKEN1_SYMBOL=$VITE_TOKEN1_SYMBOL

# `npm run build` runs tsc first, so a type error fails the image build.
RUN npm run build

# Fail the build if Vite produced no entry bundle.
RUN test -f dist/index.html

# ---------------------------------------------------------------------------
# Stage 2: serve with nginx
# ---------------------------------------------------------------------------
FROM nginx:1.29.3-alpine AS runtime

# Only the compiled bundle and the server config are carried into the runtime
# image. No node_modules, no source, no toolchain.
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# The stock nginx image normally runs the master as root so it can bind port 80
# and drop privileges. Ports below 1024 require that, so this image listens on
# 8080 and runs entirely as the unprivileged `nginx` user.
#
# Running unprivileged needs three writable locations: the pid file, the temp
# cache, and the log directory. A dedicated /tmp/nginx keeps them together and
# off any path the base image expects to own.
RUN mkdir -p /tmp/nginx/client_body /tmp/nginx/proxy /tmp/nginx/fastcgi /tmp/nginx/uwsgi /tmp/nginx/scgi \
 && chown -R nginx:nginx /tmp/nginx /var/cache/nginx /usr/share/nginx/html \
 && sed -i 's#^pid .*#pid /tmp/nginx/nginx.pid;#' /etc/nginx/nginx.conf

USER nginx

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
