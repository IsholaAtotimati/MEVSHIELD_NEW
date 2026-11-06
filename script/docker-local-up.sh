#!/usr/bin/env bash
#
# Bring up the MEVShield local Docker stack and report what is running.
#
#   ./script/docker-local-up.sh              start, wait, print addresses
#   ./script/docker-local-up.sh --reset      wipe volumes first, then start
#   ./script/docker-local-up.sh --down       stop everything and exit
#   ./script/docker-local-up.sh --logs       follow all logs after starting
#   ./script/docker-local-up.sh --no-build   skip the image build
#
# Exit codes:
#   0  every layer is healthy
#   1  something failed; the failing layer is named on stderr
#
# This script only ever talks to a local anvil chain. It cannot deploy to, or
# configure, a real network.

set -Eeuo pipefail

# Resolve the repo root without depending on BASH_SOURCE, so the script also
# works when invoked as `zsh ./script/docker-local-up.sh` instead of through its
# bash shebang. macOS ships bash 3.2, so nothing newer than that is used.
if [ -n "${BASH_SOURCE:-}" ]; then
  _script_path="${BASH_SOURCE[0]}"
else
  _script_path="$0"
fi
REPO_ROOT="$(cd "$(dirname "$_script_path")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Load optional local overrides, then fall back to the documented defaults
# ---------------------------------------------------------------------------
# docker-compose.yml reads variables from the shell environment, not from a file
# named by --env-file, so this script exports them explicitly. docker/.env.docker
# is optional; docker/.env.docker.example documents every variable.
ENV_FILE="$REPO_ROOT/docker/.env.docker"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

ANVIL_PORT="${ANVIL_PORT:-8545}"
BACKEND_PORT="${BACKEND_PORT:-4000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:$FRONTEND_PORT}"
VITE_API_URL="${VITE_API_URL:-http://localhost:$BACKEND_PORT}"
VITE_RPC_URL="${VITE_RPC_URL:-http://localhost:$ANVIL_PORT}"

# These must reach compose. Exporting after the fallbacks means a value from
# docker/.env.docker wins, and the defaults fill in anything it omits.
export ANVIL_PORT BACKEND_PORT FRONTEND_PORT FRONTEND_URL VITE_API_URL VITE_RPC_URL

DO_RESET=""
DO_DOWN=""
FOLLOW_LOGS=""
NO_BUILD=""

for arg in "$@"; do
  case "$arg" in
    --reset) DO_RESET="yes" ;;
    --down) DO_DOWN="yes" ;;
    --logs) FOLLOW_LOGS="yes" ;;
    --no-build) NO_BUILD="yes" ;;
    -h | --help)
      sed -n '2,17p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

log() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
fail() {
  printf '\n\033[31mERROR: %s\033[0m\n' "$*" >&2
  printf 'Inspect the stack with: docker compose ps && docker compose logs\n' >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail "docker is not installed or not on PATH"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 is required"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not running. Start Docker Desktop first."

# ---------------------------------------------------------------------------
# --down
# ---------------------------------------------------------------------------
if [ -n "$DO_DOWN" ]; then
  log "stopping the stack"
  docker compose down --volumes --remove-orphans
  info "stopped; volumes removed"
  exit 0
fi

# ---------------------------------------------------------------------------
# Submodules
# ---------------------------------------------------------------------------
# The contracts image copies lib/ from the build context rather than cloning it,
# so the host must have the submodules checked out. Nested submodules matter:
# SetupBackendSwap imports solmate through v4-core.
log "checking git submodules"
if [ ! -d "$REPO_ROOT/lib/forge-std/src" ] || [ ! -d "$REPO_ROOT/lib/v4-core/src" ] || \
   [ ! -d "$REPO_ROOT/lib/openzeppelin-contracts/contracts" ] || \
   [ ! -d "$REPO_ROOT/lib/v4-core/lib/solmate/src" ]; then
  info "submodules are missing; initialising (needs network access)"
  git submodule update --init --recursive
else
  info "submodules present"
fi

# ---------------------------------------------------------------------------
# Reset
# ---------------------------------------------------------------------------
if [ -n "$DO_RESET" ]; then
  log "resetting: stopping containers and deleting volumes"
  docker compose down --volumes --remove-orphans
  info "reset complete"
fi

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
if [ -z "$NO_BUILD" ]; then
  log "building images"
  info "backend, frontend and contracts toolchain"
  docker compose build || fail "image build failed"
else
  log "skipping image build (--no-build)"
fi

# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------
log "starting the stack"
info "anvil :$ANVIL_PORT   backend :$BACKEND_PORT   frontend :$FRONTEND_PORT"
# --wait blocks until every service with a healthcheck is healthy and every
# one-shot service has exited successfully. If contracts-deploy fails, this
# returns non-zero instead of starting a half-wired stack.
if ! docker compose up -d --wait --wait-timeout 300; then
  docker compose ps >&2 || true
  printf '\n' >&2
  printf 'contracts-deploy log:\n' >&2
  docker compose logs --no-log-prefix --tail 40 contracts-deploy >&2 || true
  fail "the stack did not become healthy"
fi

# ---------------------------------------------------------------------------
# Read the deployed addresses
# ---------------------------------------------------------------------------
log "reading deployed addresses"
DEPLOY_JSON="$(docker compose run --rm --no-deps --entrypoint cat contracts-deploy /deployments/local.json 2>/dev/null || true)"

if [ -z "$DEPLOY_JSON" ]; then
  info "addresses file not readable; falling back to the deterministic defaults"
  DEPLOY_JSON=""
fi

value_of() {
  if [ -n "$DEPLOY_JSON" ]; then
    printf '%s' "$DEPLOY_JSON" | sed -n "s/.*\"$1\": \"\([^\"]*\)\".*/\1/p" | head -1
  fi
}

print_addr() {
  local label="$1" value="$2"
  if [ -n "$value" ]; then
    printf '    %-22s %s\n' "$label" "$value"
  fi
}

# ---------------------------------------------------------------------------
# Verify each layer
# ---------------------------------------------------------------------------
log "verifying every layer"

# anvil
# The check is done in node rather than by parsing JSON with sed, because zsh
# brace-expands the `{...}` literal inside a double-quoted string and would
# mangle the request.
CHAIN_OK="$(
  RPC_URL="http://127.0.0.1:$ANVIL_PORT" node -e '
    (async () => {
      const res = await fetch(process.env.RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      const body = await res.json();
      process.stdout.write(body.result === "0x7a69" ? "true" : String(body.result ?? ""));
    })().catch(() => process.stdout.write(""));
  ' 2>/dev/null || true
)"
if [ "$CHAIN_OK" = "true" ]; then
  info "anvil        eth_chainId 0x7a69 (31337)"
else
  fail "anvil did not report chain id 31337 (got '${CHAIN_OK:-no response}')"
fi

# contracts
DEPLOY_EXIT="$(docker inspect mevshield-contracts-deploy --format '{{.State.ExitCode}}' 2>/dev/null || echo missing)"
if [ "$DEPLOY_EXIT" = "0" ]; then
  info "contracts    docker-deploy-local.sh exited 0"
else
  fail "contracts-deploy did not exit 0 (got '$DEPLOY_EXIT')"
fi
print_addr "PoolManager" "$(value_of poolManager)"
print_addr "PolicyRegistry" "$(value_of policyRegistry)"
print_addr "PolicyVerifier" "$(value_of policyVerifier)"
print_addr "PolicyAuthorization" "$(value_of policyAuthorization)"
print_addr "MEVShieldHook" "$(value_of mevShieldHook)"
print_addr "MEVShieldRouter" "$(value_of mevShieldRouter)"
print_addr "AuthorizedSigner" "$(value_of authorizedSigner)"
print_addr "PoolId" "$(printf '%s' "$DEPLOY_JSON" | sed -n 's/.*"poolId": "\([^"]*\)".*/\1/p' | head -1)"
print_addr "TokenA" "$(printf '%s' "$DEPLOY_JSON" | sed -n 's/.*"tokenA": "\([^"]*\)".*/\1/p' | head -1)"
print_addr "TokenB" "$(printf '%s' "$DEPLOY_JSON" | sed -n 's/.*"tokenB": "\([^"]*\)".*/\1/p' | head -1)"

# backend
HEALTH_JSON="$(curl -fsS "http://localhost:$BACKEND_PORT/health" 2>/dev/null || true)"
case "$HEALTH_JSON" in
  *'"status":"ok"'*)
    info "backend      /health 200 status=ok"
    ;;
  *)
    fail "backend /health did not return status ok (got '${HEALTH_JSON:-no response}')"
    ;;
esac

# frontend
FRONTEND_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:$FRONTEND_PORT/" 2>/dev/null || true)"
if [ "$FRONTEND_CODE" = "200" ]; then
  # The SPA fallback is what makes client-side routes work on a fresh load.
  SPA_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:$FRONTEND_PORT/network" 2>/dev/null || true)"
  if [ "$SPA_CODE" = "200" ]; then
    info "frontend     / and /network both 200"
  else
    fail "frontend SPA fallback for /network returned '$SPA_CODE'"
  fi
else
  fail "frontend returned '$FRONTEND_CODE' instead of 200"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
cat <<SUMMARY

$(printf '\033[1m==> the stack is up\033[0m')

    Frontend      $FRONTEND_URL
    Backend       $VITE_API_URL        (/health)
    Anvil RPC     $VITE_RPC_URL        (chain id 31337)

    Contracts:    docker compose exec contracts-deploy cat /deployments/local.json
    Logs:         docker compose logs -f [anvil|backend|frontend|contracts-deploy]
    Reset:        ./script/docker-local-up.sh --reset
    Stop:         ./script/docker-local-up.sh --down

To use the app, add the local network to MetaMask:
    Network name   MEVShield Local
    RPC URL        $VITE_RPC_URL
    Chain ID       31337
    Currency       ETH
Then import anvil account #0 (or #1) using a development key from
docker/.env.docker.example. These keys are public and hold no real value.

The execute gate stays closed on purpose. Swaps cannot be executed from this
stack; see docs/runbook/local-docker.md for what is and is not wired.
SUMMARY

if [ -n "$FOLLOW_LOGS" ]; then
  log "following logs (Ctrl-C to stop following; the stack keeps running)"
  docker compose logs -f
fi
