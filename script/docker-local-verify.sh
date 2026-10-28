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
# Ports come from the same variables docker-local-up.sh uses.

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

POOL_MANAGER="0x5FbDB2315678afecb367f032d93F642f64180aa3"
POLICY_VERIFIER="0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0"
MEVSHIELD_ROUTER="0x8A791620dd6260079BF849Dc5567aDC3F2FdC318"
POOL_ID="0x8d754c8c3f0e991efb877b18bf00b8d0718c2cd8af8f31a35c61de1415e19bf0"

# slot0 of the protected pool: keccak256(poolId || 6), per poolStateSlots().
SLOT0_KEY="d548e9d5adce49f9b6eff5ddb3203f1d4fa097c132febd0fa6b9668e3b239135"

pass=0
fail=0

check() {
  local label="$1" result="$2"
  if [ "$result" = "true" ]; then
    printf '  \033[32mPASS\033[0m  %s\n' "$label"
    pass=$((pass + 1))
  else
    printf '  \033[31mFAIL\033[0m  %s\n' "$label"
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

# --- anvil -----------------------------------------------------------------
export RPC_URL="http://127.0.0.1:$ANVIL_PORT"
check "anvil eth_chainId is 0x7a69 (31337)" "$(chain_check 'chainId')"

# --- contracts -------------------------------------------------------------
DEPLOY_EXIT="$(docker inspect mevshield-contracts-deploy --format '{{.State.ExitCode}}' 2>/dev/null || echo x)"
[ "$DEPLOY_EXIT" = "0" ] && check "contracts-deploy exited 0" true || check "contracts-deploy exited 0" false

check "MEVShieldRouter has deployed code" "$(chain_check "code|$MEVSHIELD_ROUTER")"

check "protected pool is initialized (slot0 sqrtPriceX96 non-zero)" \
  "$(chain_check "slot0|$POOL_MANAGER|$SLOT0_KEY")"

# --- backend ---------------------------------------------------------------
HEALTH="$(curl -fsS "http://localhost:$BACKEND_PORT/health" 2>/dev/null || true)"
case "$HEALTH" in
  *'"status":"ok"'*'"chainId":31337'*) check "backend /health 200 with chainId 31337" true ;;
  *) check "backend /health 200 with chainId 31337" false ;;
esac

POOL_CFG="$(curl -fsS "http://localhost:$BACKEND_PORT/config/protected-pool" 2>/dev/null || true)"
case "$POOL_CFG" in
  *"$POOL_ID"*) check "backend serves the deployed protected pool id" true ;;
  *) check "backend serves the deployed protected pool id" false ;;
esac

# --- frontend --------------------------------------------------------------
FE_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:$FRONTEND_PORT/" 2>/dev/null || true)"
[ "$FE_CODE" = "200" ] && check "frontend serves the app (200)" true || check "frontend serves the app (200)" false

FE_TITLE="$(curl -fsS "http://localhost:$FRONTEND_PORT/" 2>/dev/null | grep -c '<title>MEVShield</title>' || true)"
[ "${FE_TITLE:-0}" -ge 1 ] && check "frontend HTML is the MEVShield app" true || check "frontend HTML is the MEVShield app" false

SPA_CODE="$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:$FRONTEND_PORT/network" 2>/dev/null || true)"
[ "$SPA_CODE" = "200" ] && check "SPA fallback serves a deep route (/network)" true || check "SPA fallback serves a deep route (/network)" false

# --- the integration proof -------------------------------------------------
EXPIRY=$(( $(date +%s) + 300 ))
NONCE=$(( RANDOM + 100000 ))
POLICY_BODY="{\"poolId\":\"$POOL_ID\",\"trader\":\"$MEVSHIELD_ROUTER\",\"nonce\":\"$NONCE\",\"expiry\":\"$EXPIRY\",\"amountSpecified\":\"-1000000000000000\",\"zeroForOne\":true,\"sqrtPriceLimitX96\":\"4295128741\",\"minAmountOut\":\"500000000000000\"}"

POLICY_JSON="$(curl -fsS -X POST "http://localhost:$BACKEND_PORT/policy" \
  -H 'content-type: application/json' --data "$POLICY_BODY" 2>/dev/null || true)"

case "$POLICY_JSON" in
  *'"signature"'*) check "backend signed a policy" true ;;
  *) check "backend signed a policy" false ;;
esac

if command -v node >/dev/null 2>&1 && [ -d "$REPO_ROOT/backend/node_modules/ethers" ]; then
  # ethers lives in backend/node_modules, so this runs with backend as cwd.
  VERDICT="$(
    cd "$REPO_ROOT/backend" && SIG_JSON="$POLICY_JSON" RPC="http://localhost:$ANVIL_PORT" \
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
  check "deployed PolicyVerifier accepts the backend signature" "$VERDICT"
else
  printf '  \033[33mSKIP\033[0m  deployed PolicyVerifier accepts the backend signature\n'
  printf '        (needs node and backend/node_modules; run npm --prefix backend ci)\n'
fi

printf '\n  %d passed, %d failed\n\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
