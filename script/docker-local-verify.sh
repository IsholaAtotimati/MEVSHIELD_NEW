#!/usr/bin/env bash
#
# End-to-end check that the local stack is wired correctly.
#
# Proves, against a running stack:
#   - anvil answers on chain 31337
#   - the contracts deploy exited 0 and the pool is initialized
#   - the backend reports chain 31337 and is healthy
#   - the frontend serves the app and the SPA fallback
#   - the backend signs a policy that the DEPLOYED PolicyVerifier accepts
#
# The last one is the real integration proof: it takes the signature the backend
# produced and calls verifyPolicy() on the on-chain verifier. If the EIP-712
# domain, chain id, verifying contract or signer were wrong, that call reverts
# instead of returning true.
#
# Usage:
#   ./script/docker-local-verify.sh
#
#   # one-off override, without touching the env file
#   ANVIL_PORT=8645 BACKEND_PORT=4100 FRONTEND_PORT=5273 ./script/docker-local-verify.sh
#
# Ports resolve in the same order docker-local-up.sh and compose use: an
# explicit environment variable wins, then docker/.env.docker, then the default.

set -Eeuo pipefail

# Resolve the repo root without depending on BASH_SOURCE, so the script also
# works when invoked as `zsh ./script/docker-local-verify.sh`.
if [ -n "${BASH_SOURCE:-}" ]; then
  _script_path="${BASH_SOURCE[0]}"
else
  _script_path="$0"
fi
REPO_ROOT="$(cd "$(dirname "$_script_path")/.." && pwd)"
cd "$REPO_ROOT"

# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------
# Compose publishes ${ANVIL_PORT}, ${BACKEND_PORT} and ${FRONTEND_PORT}, and
# docker-local-up.sh takes them from docker/.env.docker. Reading the same file
# here means the checks follow the stack wherever the operator moved it, instead
# of failing against the built-in defaults.
#
# Precedence is compose's own: a variable already in the environment wins, then
# the env file, then the default. So
#   ANVIL_PORT=9000 ./script/docker-local-verify.sh
# checks 9000 even when the file says otherwise.
#
# The file is read in a subshell so that only the three ports escape it. Keys it
# also defines (DEPLOYER_PRIVATE_KEY, SIGNER_PRIVATE_KEY, ...) are never
# exported, never inherited by the node and curl subprocesses, and never printed.
ENV_FILE="$REPO_ROOT/docker/.env.docker"
if [ -f "$ENV_FILE" ]; then
  ENV_SOURCE="docker/.env.docker"
else
  ENV_SOURCE="no env file; compose defaults"
fi

_env_ports="$(
  if [ -f "$ENV_FILE" ]; then
    # Clear inherited values first so this captures the file's own settings;
    # the parent shell's environment is applied afterwards and takes priority.
    unset ANVIL_PORT BACKEND_PORT FRONTEND_PORT
    # shellcheck disable=SC1090
    . "$ENV_FILE" >/dev/null
    printf '%s %s %s\n' "${ANVIL_PORT:-}" "${BACKEND_PORT:-}" "${FRONTEND_PORT:-}"
  fi
)"
_file_anvil=""
_file_backend=""
_file_frontend=""
if [ -n "$_env_ports" ]; then
  # A here-string keeps this working under both bash and zsh, and avoids
  # touching the script's positional parameters.
  read -r _file_anvil _file_backend _file_frontend <<<"$_env_ports"
fi
unset _env_ports

ANVIL_PORT="${ANVIL_PORT:-${_file_anvil:-8545}}"
BACKEND_PORT="${BACKEND_PORT:-${_file_backend:-4000}}"
FRONTEND_PORT="${FRONTEND_PORT:-${_file_frontend:-5173}}"
unset _file_anvil _file_backend _file_frontend

# Every check below builds its URL from these, so a FAIL can print the exact
# address it tried.
RPC_URL="http://127.0.0.1:$ANVIL_PORT"
API_URL="http://localhost:$BACKEND_PORT"
WEB_URL="http://localhost:$FRONTEND_PORT"

# Exported for the node subprocesses that speak JSON-RPC. These are URLs, not
# secrets; nothing from the env file is exported.
export RPC_URL

POOL_MANAGER="0x5FbDB2315678afecb367f032d93F642f64180aa3"
POLICY_VERIFIER="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
MEVSHIELD_ROUTER="0x8A791620dd6260079BF849Dc5567aDC3F2FdC318"
POOL_ID="0x8d754c8c3f0e991efb877b18bf00b8d0718c2cd8af8f31a35c61de1415e19bf0"

# slot0 of the protected pool: keccak256(poolId || 6), per poolStateSlots().
SLOT0_KEY="d548e9d5adce49f9b6eff5ddb3203f1d4fa097c132febd0fa6b9668e3b239135"

pass=0
fail=0

check() {
  local label="$1" result="$2" url="${3:-}"
  if [ "$result" = "true" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$label"
    pass=$((pass + 1))
  else
    # The URL is printed so a port mismatch is visible instead of showing only
    # "fetch failed" against an address the operator never chose.
    if [ -n "$url" ]; then
      printf '  \033[31mFAIL\033[0m  %s\n' "$label"
      printf '        tried %s\n' "$url"
    else
      printf '  \033[31mFAIL\033[0m  %s\n' "$label"
    fi
    fail=$((fail + 1))
  fi
}

# Chain-state checks run in one node process.
#
# Earlier revisions built JSON-RPC bodies in shell strings. That breaks under
# zsh, which brace-expands the `{...}` literals and mangles the request, and it
# also choked on contract bytecode length. Building the requests in node avoids
# both problems.
chain_check() {
  CHAIN_ARGS="$1" node -e '
    const parts = (process.env.CHAIN_ARGS || "").split("|");
    const kind = parts[0];
    const a = parts[1];
    const b = parts[2];
    const url = process.env.RPC_URL;
    const call = async (method, params) => {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const body = await res.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    };
    (async () => {
      if (kind === "chainId") {
        const id = await call("eth_chainId", []);
        process.stdout.write(id === "0x7a69" ? "true" : "false");
      } else if (kind === "code") {
        const code = await call("eth_getCode", [a, "latest"]);
        process.stdout.write(code && code !== "0x" ? "true" : "false");
      } else if (kind === "slot0") {
        // extsload(bytes32) selector 0x1e2eaeaf. The low 160 bits of the word
        // are sqrtPriceX96; zero means initialize() was never called.
        const word = await call("eth_call", [{ to: a, data: "0x1e2eaeaf" + b }, "latest"]);
        const sqrtPrice = BigInt("0x" + word.slice(-40));
        process.stdout.write(sqrtPrice > 0n ? "true" : "false");
      } else {
        process.stdout.write("false");
      }
    })().catch((e) => {
      console.error("chain_check:", e.message);
      process.stdout.write("false");
    });
  '
}

printf '\nMEVShield local stack verification\n\n'
printf '  anvil %s   backend %s   frontend %s\n' "$RPC_URL" "$API_URL" "$WEB_URL"
printf '  ports from %s\n\n' "$ENV_SOURCE"

# --- fail fast when nothing is listening -----------------------------------
# Without this, every check below fails on its own with "fetch failed" and the
# operator sees a wall of red without learning that the stack, or the port, is
# the problem.
rpc_reachable() {
  if command -v node >/dev/null 2>&1; then
    node -e '
      fetch(process.env.RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
        signal: AbortSignal.timeout(4000),
      }).then((r) => r.json()).then((b) => process.exit(b.result ? 0 : 1)).catch(() => process.exit(1));
    ' >/dev/null 2>&1
  else
    # No node: fall back to curl so the preflight still works.
    curl -fsS -m 4 -X POST -H 'content-type: application/json' \
      --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' \
      "$RPC_URL" >/dev/null 2>&1
  fi
}

if ! rpc_reachable; then
  printf '  \033[31mFAIL\033[0m  nothing is answering JSON-RPC at %s\n\n' "$RPC_URL"
  printf '  The stack is probably not running, or it is on different ports than this\n'
  printf '  script expects. Ports came from: %s\n\n' "$ENV_SOURCE"
  printf '  Fix one of these:\n'
  printf '    start the stack        ./script/docker-local-up.sh\n'
  printf '    use the running ports  ANVIL_PORT=<port> BACKEND_PORT=<port> FRONTEND_PORT=<port> ./script/docker-local-verify.sh\n'
  printf '    record them in docker/.env.docker, which ./script/docker-local-up.sh and this script both read\n\n'
  printf '  Check where the stack actually published: docker compose ps\n\n'
  exit 1
fi

# --- anvil -----------------------------------------------------------------
check "anvil eth_chainId is 0x7a69 (31337)" "$(chain_check 'chainId')" "$RPC_URL"

# --- contracts -------------------------------------------------------------
DEPLOY_EXIT="$(docker inspect mevshield-contracts-deploy --format '{{.State.ExitCode}}' 2>/dev/null || echo x)"
[ "$DEPLOY_EXIT" = "0" ] && check "contracts-deploy exited 0" true || check "contracts-deploy exited 0" false

check "MEVShieldRouter has deployed code" "$(chain_check "code|$MEVSHIELD_ROUTER")" "$RPC_URL (eth_getCode $MEVSHIELD_ROUTER)"

check "protected pool is initialized (slot0 sqrtPriceX96 non-zero)" \
  "$(chain_check "slot0|$POOL_MANAGER|$SLOT0_KEY")" "$RPC_URL (extsload $POOL_MANAGER)"

# --- backend ---------------------------------------------------------------
HEALTH="$(curl -fsS "$API_URL/health" 2>/dev/null || true)"
case "$HEALTH" in
  *'"status":"ok"'*'"chainId":31337'*) check "backend /health 200 with chainId 31337" true ;;
  *) check "backend /health 200 with chainId 31337" false "$API_URL/health" ;;
esac

POOL_CFG="$(curl -fsS "$API_URL/config/protected-pool" 2>/dev/null || true)"
case "$POOL_CFG" in
  *"$POOL_ID"*) check "backend serves the deployed protected pool id" true ;;
  *) check "backend serves the deployed protected pool id" false "$API_URL/config/protected-pool" ;;
esac

# --- frontend --------------------------------------------------------------
FE_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "$WEB_URL/" 2>/dev/null || true)"
[ "$FE_CODE" = "200" ] && check "frontend serves the app (200)" true || check "frontend serves the app (200)" false "$WEB_URL/"

FE_TITLE="$(curl -fsS "$WEB_URL/" 2>/dev/null | grep -c '<title>MEVShield</title>' || true)"
[ "${FE_TITLE:-0}" -ge 1 ] && check "frontend HTML is the MEVShield app" true || check "frontend HTML is the MEVShield app" false "$WEB_URL/"

SPA_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "$WEB_URL/network" 2>/dev/null || true)"
[ "$SPA_CODE" = "200" ] && check "SPA fallback serves a deep route (/network)" true || check "SPA fallback serves a deep route (/network)" false "$WEB_URL/network"

# --- the integration proof -------------------------------------------------
EXPIRY=$(( $(date +%s) + 300 ))
NONCE=$(( RANDOM + 100000 ))
POLICY_BODY="{\"poolId\":\"$POOL_ID\",\"trader\":\"$MEVSHIELD_ROUTER\",\"nonce\":\"$NONCE\",\"expiry\":\"$EXPIRY\",\"amountSpecified\":\"-1000000000000000\",\"zeroForOne\":true,\"sqrtPriceLimitX96\":\"4295128741\",\"minAmountOut\":\"500000000000000\"}"

POLICY_JSON="$(curl -fsS -X POST "$API_URL/policy" \
  -H 'content-type: application/json' --data "$POLICY_BODY" 2>/dev/null || true)"

case "$POLICY_JSON" in
  *'"signature"'*) check "backend signed a policy" true ;;
  *) check "backend signed a policy" false "$API_URL/policy (POST)" ;;
esac

if command -v node >/dev/null 2>&1 && [ -d "$REPO_ROOT/backend/node_modules/ethers" ]; then
  # ethers lives in backend/node_modules, so this runs with backend as cwd.
  VERDICT="$(
    cd "$REPO_ROOT/backend" && SIG_JSON="$POLICY_JSON" RPC="$RPC_URL" \
      VERIFIER="$POLICY_VERIFIER" node --input-type=module -e '
        import { JsonRpcProvider, Contract } from "ethers";
        const j = JSON.parse(process.env.SIG_JSON);
        const p = j.policy;
        const provider = new JsonRpcProvider(process.env.RPC, 31337, { staticNetwork: true });
        const TUPLE = "(bytes32,address,uint256,uint256,uint256,uint256,bool,int256,uint160,uint256)";
        const verifier = new Contract(process.env.VERIFIER, [`function verifyPolicy(${TUPLE},bytes) view returns (bool)`], provider);
        const tuple = [
          p.poolId, p.trader, p.nonce, p.expiry, p.maxLoss, p.maxFee,
          p.zeroForOne, p.amountSpecified, p.sqrtPriceLimitX96, p.minAmountOut,
        ];
        try {
          console.log((await verifier.verifyPolicy(tuple, j.signature)) ? "true" : "false");
        } catch (e) {
          console.error(String(e.shortMessage ?? e));
          console.log("false");
        }
      ' 2>/dev/null || echo false
  )"
  check "deployed PolicyVerifier accepts the backend signature" "$VERDICT" \
    "$RPC_URL (verifyPolicy on $POLICY_VERIFIER)"
else
  printf '  \033[33mSKIP\033[0m  deployed PolicyVerifier accepts the backend signature\n'
  printf '        (needs node and backend/node_modules; run npm --prefix backend ci)\n'
fi

printf '\n  %d passed, %d failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
