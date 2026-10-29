#!/usr/bin/env bash
#
# Build and serve the frontend against the ALREADY-RUNNING local anvil stack, so
# the trade page can actually reach "Check protection" and register a policy.
#
#   ./script/local-test-flow.sh              build a bundle, serve it in nginx
#   ./script/local-test-flow.sh --dev        serve with the Vite dev server (HMR)
#   ./script/local-test-flow.sh --port 5599  change the published frontend port
#   ./script/local-test-flow.sh --stop       remove the containers this script made
#
# This script is READ-ONLY with respect to the running stack. It does not
# restart, rebuild or reconfigure anvil, the contracts deploy, the published
# backend or the published frontend. It reads the published host ports from
# docker/.env.docker and the deployment record from the stack's `deployments`
# volume, then configures a NEW frontend build from those values.
#
# One exception, and it is additive: policy creation needs a backend running with
# demo signing on (`MEVSHIELD_SEPOLIA_DEMO_ENABLED=true`), and the published
# backend pins that to "false". When the published backend reports
# localDemoMode:false this script starts a SECOND backend on its own port
# against the same anvil, and leaves the published one alone.
#
# See docs/runbook/local-test-flow.md for what every gate means.

set -Eeuo pipefail

if [ -n "${BASH_SOURCE:-}" ]; then
  _script_path="${BASH_SOURCE[0]}"
else
  _script_path="$0"
fi
REPO_ROOT="$(cd "$(dirname "$_script_path")/.." && pwd)"
cd "$REPO_ROOT"

FRONTEND_NGINX_NAME="mevshield-local-test-frontend"
DEMO_BACKEND_NAME="mevshield-local-test-backend"

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[33m    warning: %s\033[0m\n' "$*" >&2; }
fail() {
  printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2
  exit 1
}
need() { command -v "$1" >/dev/null 2>&1 || fail "$1 is required but not on PATH."; }

DO_DEV=""
DO_STOP=""
DO_NO_BUILD=""
LOCAL_TEST_PORT="${LOCAL_TEST_PORT:-5599}"
DEMO_BACKEND_PORT="${DEMO_BACKEND_PORT:-4200}"
DEMO_BACKEND_IMAGE="mevshield/backend:local-test"

while [ $# -gt 0 ]; do
  case "$1" in
    --dev) DO_DEV="yes" ;;
    --stop) DO_STOP="yes" ;;
    --no-build) DO_NO_BUILD="yes" ;;
    --port)
      shift
      [ $# -gt 0 ] || fail "--port needs a value"
      LOCAL_TEST_PORT="$1"
      ;;
    -h | --help)
      sed -n '2,24p' "$_script_path" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) fail "unknown argument: $1" ;;
  esac
  shift
done

if [ -n "$DO_STOP" ]; then
  docker rm -f "$FRONTEND_NGINX_NAME" >/dev/null 2>&1 || true
  docker rm -f "$DEMO_BACKEND_NAME" >/dev/null 2>&1 || true
  log "Removed the local test frontend and demo backend containers."
  info "The published stack was never touched and is still running."
  exit 0
fi

need docker
need curl
need node
docker info >/dev/null 2>&1 || fail "The Docker daemon is not reachable. Start Docker Desktop."

# ---------------------------------------------------------------------------
# 1. Published host ports
# ---------------------------------------------------------------------------
# docker/.env.docker is the documented source of truth, but it is gitignored, so
# a fresh worktree does not have it. When it is absent, fall back to the port
# bindings of the containers that are actually running: what a port really is
# on the host beats what a file says it should be.
ENV_FILE="$REPO_ROOT/docker/.env.docker"
if [ -f "$ENV_FILE" ]; then
  # Sourced in a subshell so nothing else in the file (FRONTEND_URL and friends)
  # leaks into the build environment constructed below.
  ANVIL_PORT="$(set -a; . "$ENV_FILE"; printf '%s' "${ANVIL_PORT:-8545}")"
  BACKEND_PORT="$(set -a; . "$ENV_FILE"; printf '%s' "${BACKEND_PORT:-4000}")"
  info "ports read from docker/.env.docker"
else
  host_port() {
    docker port "$1" "$2/tcp" 2>/dev/null | head -n 1 | sed 's/.*://'
  }
  ANVIL_PORT="$(host_port mevshield-anvil 8545)"
  BACKEND_PORT="$(host_port mevshield-backend 4000)"
  ANVIL_PORT="${ANVIL_PORT:-8545}"
  BACKEND_PORT="${BACKEND_PORT:-4000}"
  info "docker/.env.docker absent; ports read from the running containers"
fi

ANVIL_URL="http://localhost:$ANVIL_PORT"
PUBLISHED_BACKEND_URL="http://localhost:$BACKEND_PORT"

info "anvil              $ANVIL_URL"
info "published backend  $PUBLISHED_BACKEND_URL"
info "test frontend      http://localhost:$LOCAL_TEST_PORT"

# ---------------------------------------------------------------------------
# 2. Prove the chain is up and is the local chain
# ---------------------------------------------------------------------------
CHAIN_ID_HEX="$(curl -fsS -m 5 -X POST "$ANVIL_URL" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
  | sed -n 's/.*"result":"\([^"]*\)".*/\1/p')" || true
[ -n "$CHAIN_ID_HEX" ] || fail "No JSON-RPC answer from $ANVIL_URL. Is the stack up? ./script/docker-local-up.sh"
CHAIN_ID="$((CHAIN_ID_HEX))"
[ "$CHAIN_ID" = "31337" ] || fail "$ANVIL_URL is chain $CHAIN_ID, expected 31337. This script is local-only."

# ---------------------------------------------------------------------------
# 3. The deployment record, read from the stack's volume
# ---------------------------------------------------------------------------
# Discovered by compose label rather than a hard-coded project name, so a
# renamed project still works.
VOLUME_NAME="$(docker volume ls -q \
  --filter "label=com.docker.compose.project=mevshield-local" \
  --filter "label=com.docker.compose.volume=deployments" | head -n 1)"
[ -n "$VOLUME_NAME" ] || fail "No deployments volume found for the mevshield-local stack."

DEPLOYMENT_RECORD="$(docker run --rm -v "$VOLUME_NAME":/d:ro alpine:latest cat /d/local.json)" \
  || fail "Could not read /deployments/local.json from volume $VOLUME_NAME."
[ -n "$DEPLOYMENT_RECORD" ] || fail "The deployment record in $VOLUME_NAME is empty. Did contracts-deploy succeed?"

# Reads one field out of the record. Node is already required for the build, so
# this avoids depending on jq being installed.
record_value() {
  RECORD="$DEPLOYMENT_RECORD" FIELD="$1" node -e '
    const parse = (path) =>
      path.split(".").reduce((value, key) => value?.[key], JSON.parse(process.env.RECORD));
    const value = parse(process.env.FIELD);
    if (typeof value === "number" || typeof value === "string") {
      process.stdout.write(String(value));
    } else {
      process.exit(1);
    }
  ' || fail "The deployment record has no usable '$1' field."
}

POOL_MANAGER="$(record_value poolManager)"
POLICY_REGISTRY="$(record_value policyRegistry)"
POLICY_VERIFIER="$(record_value policyVerifier)"
POLICY_AUTHORIZATION="$(record_value policyAuthorization)"
MEVSHIELD_HOOK="$(record_value mevShieldHook)"
MEVSHIELD_ROUTER="$(record_value mevShieldRouter)"
AUTHORIZED_SIGNER="$(record_value authorizedSigner)"
RECORD_CHAIN_ID="$(record_value chainId)"
POOL_CURRENCY0="$(record_value protectedPool.currency0)"
POOL_CURRENCY1="$(record_value protectedPool.currency1)"
POOL_FEE="$(record_value protectedPool.fee)"
POOL_TICK_SPACING="$(record_value protectedPool.tickSpacing)"
POOL_HOOK="$(record_value protectedPool.hooks)"
POOL_ID="$(record_value protectedPool.poolId)"
TOKEN_A="$(record_value tokens.tokenA)"
TOKEN_B="$(record_value tokens.tokenB)"

[ "$RECORD_CHAIN_ID" = "31337" ] || fail "The deployment record is for chain $RECORD_CHAIN_ID, expected 31337."

info "router             $MEVSHIELD_ROUTER"
info "hook               $MEVSHIELD_HOOK"
info "authorization      $POLICY_AUTHORIZATION"
info "pool               $POOL_ID"

# ---------------------------------------------------------------------------
# 4. Does the published backend sign demo policies?
# ---------------------------------------------------------------------------
# Demo policies carry a 1-base-unit minimum output, and the backend accepts that
# only from a process started with MEVSHIELD_SEPOLIA_DEMO_ENABLED=true. Compose
# pins it to "false", so check rather than assume.
BACKEND_URL="$PUBLISHED_BACKEND_URL"
NEEDS_DEMO_BACKEND=""
PUBLISHED_HEALTH="$(curl -fsS -m 5 "$PUBLISHED_BACKEND_URL/health" 2>/dev/null || true)"
if [ -z "$PUBLISHED_HEALTH" ]; then
  warn "The published backend is not answering on $PUBLISHED_BACKEND_URL. Policy creation will fail."
elif printf '%s' "$PUBLISHED_HEALTH" | grep -q '"localDemoMode":true'; then
  info "published backend already signs demo policies; reusing it"
else
  BACKEND_URL="http://localhost:$DEMO_BACKEND_PORT"
  NEEDS_DEMO_BACKEND="yes"
fi

if [ -n "$NEEDS_DEMO_BACKEND" ]; then
  docker rm -f "$DEMO_BACKEND_NAME" >/dev/null 2>&1 || true

  # Built from this checkout, not a pre-existing tag: the published
  # mevshield/backend:local image is whatever the stack was built from, and a
  # stale one would silently test different code than the working tree.
  if [ -z "$DO_NO_BUILD" ]; then
    log "Building the demo-signing backend image"
    docker build -f "$REPO_ROOT/backend/Dockerfile" -t "$DEMO_BACKEND_IMAGE" \
      "$REPO_ROOT/backend" >/dev/null \
      || fail "The backend image failed to build."
  fi

  docker run -d --name "$DEMO_BACKEND_NAME" \
    --network mevshield-local_mevshield \
    -p "$DEMO_BACKEND_PORT:4000" \
    -e NODE_ENV=development \
    -e PORT=4000 \
    -e CHAIN_ID=31337 \
    -e MEVSHIELD_LOCAL_CHAIN_ENABLED=true \
    -e MEVSHIELD_V2_POLICY_ENABLED=true \
    -e MEVSHIELD_SEPOLIA_DEMO_ENABLED=true \
    -e SIGNER_PRIVATE_KEY="0x00000000000000000000000000000000000000000000000000000000000a11ce" \
    -e POLICY_VERIFIER_ADDRESS="$POLICY_VERIFIER" \
    -e VERIFIER_ADDRESS="$POLICY_VERIFIER" \
    -e POLICY_REGISTRY_ADDRESS="$POLICY_REGISTRY" \
    -e ROUTER_ADDRESS="$MEVSHIELD_ROUTER" \
    -e HOOK_ADDRESS="$MEVSHIELD_HOOK" \
    -e RPC_URL="http://anvil:8545" \
    -e SEPOLIA_RPC_URL= \
    -e PROTECTED_POOL_CURRENCY0="$POOL_CURRENCY0" \
    -e PROTECTED_POOL_CURRENCY1="$POOL_CURRENCY1" \
    -e PROTECTED_POOL_FEE="$POOL_FEE" \
    -e PROTECTED_POOL_TICK_SPACING="$POOL_TICK_SPACING" \
    -e PROTECTED_POOL_HOOK="$POOL_HOOK" \
    -e PROTECTED_POOL_ID="$POOL_ID" \
    -e "FRONTEND_URL=http://localhost:$LOCAL_TEST_PORT" \
    "$DEMO_BACKEND_IMAGE" >/dev/null \
    || fail "Could not start the demo-signing backend. Is $DEMO_BACKEND_IMAGE built?"

  info "started demo-signing backend on $BACKEND_URL (published backend untouched)"
  attempt=0
  while [ "$attempt" -lt 40 ]; do
    if curl -fsS -m 2 "$BACKEND_URL/health" 2>/dev/null | grep -q '"localDemoMode":true'; then
      info "demo-signing backend is healthy with localDemoMode:true"
      break
    fi
    attempt=$((attempt + 1))
    sleep 0.5
  done
  if ! curl -fsS -m 2 "$BACKEND_URL/health" 2>/dev/null | grep -q '"localDemoMode":true'; then
    docker logs --tail 40 "$DEMO_BACKEND_NAME" >&2 || true
    fail "The demo-signing backend did not report localDemoMode:true within 20s."
  fi
fi

# ---------------------------------------------------------------------------
# 5. The local chain configuration, for the build
# ---------------------------------------------------------------------------
export VITE_CHAIN_ID=31337
export VITE_RPC_URL="$ANVIL_URL"
export VITE_API_URL="$BACKEND_URL"
# The deterministic demo estimate. Required because no quoter exists yet:
# assessProtectedPool always ends at quote-simulation-unavailable.
export VITE_SEPOLIA_DEMO_MODE=true
# Deliberately not set. On chain 31337 verification comes from comparing
# VITE_LOCAL_DEPLOYMENT_RECORD with the configured addresses; setting the flag
# would bypass that comparison and prove nothing.
unset VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED
export VITE_LOCAL_DEPLOYMENT_RECORD="$DEPLOYMENT_RECORD"
export VITE_POOL_MANAGER_ADDRESS="$POOL_MANAGER"
export VITE_POLICY_REGISTRY_ADDRESS="$POLICY_REGISTRY"
export VITE_POLICY_VERIFIER_ADDRESS="$POLICY_VERIFIER"
export VITE_POLICY_AUTHORIZATION_ADDRESS="$POLICY_AUTHORIZATION"
export VITE_MEVSHIELD_HOOK_ADDRESS="$MEVSHIELD_HOOK"
export VITE_MEVSHIELD_ROUTER_ADDRESS="$MEVSHIELD_ROUTER"
export VITE_AUTHORIZED_SIGNER_ADDRESS="$AUTHORIZED_SIGNER"
export VITE_TOKEN0_ADDRESS="$TOKEN_A"
export VITE_TOKEN1_ADDRESS="$TOKEN_B"
unset VITE_EXPLORER_URL

# ---------------------------------------------------------------------------
# 6. Build, then serve
# ---------------------------------------------------------------------------
if [ -n "$DO_DEV" ]; then
  log "Serving the frontend with the Vite dev server on http://localhost:$LOCAL_TEST_PORT"
  info "Ctrl-C to stop the dev server."
  info "The demo backend keeps running; ./script/local-test-flow.sh --stop removes it."
  cd "$REPO_ROOT/frontend"
  exec npx vite --port "$LOCAL_TEST_PORT" --strictPort --host 127.0.0.1
fi

[ -d "$REPO_ROOT/frontend/node_modules" ] || fail "frontend/node_modules is missing. Run: (cd frontend && npm ci)"

log "Building the frontend for chain 31337"
(cd "$REPO_ROOT/frontend" && npm run build >/dev/null) || fail "The frontend build failed."
DIST_DIR="$REPO_ROOT/frontend/dist"

# A static server cannot set the app's env, so every value above is baked into
# the bundle at build time. nginx needs one thing the build does not carry: the
# react-router history fallback.
CONF_DIR="$(mktemp -d)"
trap 'rm -rf "$CONF_DIR"' EXIT
cat >"$CONF_DIR/default.conf" <<'NGINX'
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    # Client-side routes (/activity, /portfolio, ...) are not files on disk.
    location / {
        try_files $uri $uri/ /index.html;
    }

    location = /index.html {
        add_header Cache-Control "no-store";
    }
}
NGINX

docker rm -f "$FRONTEND_NGINX_NAME" >/dev/null 2>&1 || true
docker run -d --name "$FRONTEND_NGINX_NAME" \
  -p "$LOCAL_TEST_PORT:80" \
  -v "$DIST_DIR":/usr/share/nginx/html:ro \
  -v "$CONF_DIR/default.conf":/etc/nginx/conf.d/default.conf:ro \
  nginx:1.29.3-alpine >/dev/null \
  || fail "Could not start the nginx container."

attempt=0
while [ "$attempt" -lt 40 ]; do
  if curl -fsS -m 2 "http://localhost:$LOCAL_TEST_PORT/" >/dev/null 2>&1; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 0.25
done
curl -fsS -m 2 "http://localhost:$LOCAL_TEST_PORT/" >/dev/null 2>&1 \
  || fail "The frontend did not answer on http://localhost:$LOCAL_TEST_PORT"

log "Local test flow is up"
cat <<SUMMARY
    Open   http://localhost:$LOCAL_TEST_PORT

    Gates in this build
      chain 31337                        open
      deployment verified (local record) open, by comparing addresses
      demo estimate (deterministic)      open
      execute / swap                     open, as a consequence of the above

    Gates still closed on Sepolia
      deployment verified                flag only, fail-closed
      demo estimate                      Vite dev server only

    Import an anvil account into your wallet:
      RPC         $ANVIL_URL
      Chain ID    31337
      Account #0  0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
      Key         0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
                  (published anvil key: insecure, local only, worth nothing)

    Stop this frontend:  ./script/local-test-flow.sh --stop
SUMMARY
