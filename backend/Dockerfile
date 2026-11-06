# syntax=docker/dockerfile:1.7
#
# MEVShield backend image. Build context is ./backend (see docker-compose.yml).
#
# Multi-stage: dependencies, build, production dependencies, then runtime.
#
# Secrets: no private key, RPC URL or API key is copied into any stage. The
# runtime image expects SIGNER_PRIVATE_KEY from the environment at run time,
# never baked into a layer.
#
# Base image pinned to an explicit patch tag so a rebuild is reproducible.

# ---------------------------------------------------------------------------
# Stage 1: dependencies (dev + prod, for the compiler)
# ---------------------------------------------------------------------------
FROM node:22.20.0-alpine AS deps

WORKDIR /app

# Manifest and lockfile first, so this layer stays cached when source changes.
COPY package.json package-lock.json ./

# --ignore-scripts blocks lifecycle scripts from transitive packages. Nothing
# here needs a postinstall step, and skipping them removes a supply-chain vector.
RUN npm ci --ignore-scripts --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 2: build (TypeScript -> dist)
# ---------------------------------------------------------------------------
FROM node:22.20.0-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
COPY src ./src

# tsc emits dist/. tsconfig excludes the test files and the two non-production
# signer helpers, so the output is production code only.
RUN npm run build

# Fail here rather than shipping an image that cannot start.
RUN test -f dist/server.js

# ---------------------------------------------------------------------------
# Stage 3: production dependencies only
# ---------------------------------------------------------------------------
FROM node:22.20.0-alpine AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---------------------------------------------------------------------------
# Stage 4: runtime
# ---------------------------------------------------------------------------
FROM node:22.20.0-alpine AS runtime

# NODE_ENV=production is deliberate: it closes the local-chain gate and the
# Sepolia demo gate inside the backend unless an operator explicitly overrides
# it. The image's default posture is the fail-closed production one. The local
# Docker stack sets NODE_ENV=development and the local flag in compose.
ENV NODE_ENV=production \
    PORT=4000

WORKDIR /app

# Dedicated unprivileged user. The node image ships nginx-free and uid 1000
# `node`, but a separate account keeps ownership explicit.
RUN addgroup -g 10001 -S mevshield \
 && adduser -u 10001 -S mevshield -G mevshield

# Application files are root-owned and read-only to the runtime user. The
# process needs no write access inside the image.
COPY --from=prod-deps --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --chown=root:root package.json ./package.json

USER 10001:10001

EXPOSE 4000

# Hits the backend's own /health endpoint. Node is already present, so no curl
# or wget is added to the image.
HEALTHCHECK --interval=10s --timeout=3s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
