#!/usr/bin/env bash
#
# Deploy the MEVShield contracts to the local anvil chain and record the
# resulting addresses.
#
# Runs inside the contracts container, from the repository root. The compose
# service mounts this directory at /work and the addresses volume at
# /deployments.
#
# What it does, in order:
#   1. Wait for anvil to answer eth_chainId with 31337.
#   2. Run script/DeployLocal.s.sol against anvil.
#   3. Read the addresses Forge wrote to broadcast/, and write them to the
#      shared volume as JSON and as an env file.
#   4. Run script/SetupBackendSwap.s.sol with those addresses, which deploys two
#      mock ERC-20 tokens, initializes a protected pool and sets router
#      approvals.
#   5. Derive the pool id from the token addresses and the pool key, then verify
#      the deployment matches the addresses the other services are configured
#      with. A mismatch exits non-zero so the stack does not start half-wired.
#
# Environment:
#   ANVIL_RPC_URL          default http://anvil:8545
#   DEPLOYER_PRIVATE_KEY   required; anvil dev key by default from compose
#   EXPECTED_* addresses   optional; when set, the deploy is compared to them

set -Eeuo pipefail

ANVIL_RPC_URL="${ANVIL_RPC_URL:-http://anvil:8545}"
DEPLOYMENTS_DIR="${DEPLOYMENTS_DIR:-/deployments}"
OUT_JSON="$DEPLOYMENTS_DIR/local.json"
OUT_ENV="$DEPLOYMENTS_DIR/local.env"

log() {
  printf '[deploy] %s\n' "$*" >&2
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

trap 'printf "[deploy] failed at line %s: %s\n" "$LINENO" "$BASH_COMMAND" >&2' ERR

if [ -z "${DEPLOYER_PRIVATE_KEY:-}" ]; then
  fail "DEPLOYER_PRIVATE_KEY is not set. docker/.env.docker supplies anvil's dev key."
fi

mkdir -p "$DEPLOYMENTS_DIR"

# ---------------------------------------------------------------------------
# 1. Wait for anvil
# ---------------------------------------------------------------------------
log "waiting for anvil at $ANVIL_RPC_URL"
ready=""
for _ in $(seq 1 60); do
  if chain_id="$(cast chain-id --rpc-url "$ANVIL_RPC_URL" 2>/dev/null)"; then
    if [ "$chain_id" = "31337" ]; then
      ready="yes"
      break
    fi
    log "anvil reports chain id $chain_id, expected 31337"
  fi
  sleep 2
done
[ -n "$ready" ] || fail "anvil did not become ready at $ANVIL_RPC_URL"
log "anvil ready on chain 31337"

# ---------------------------------------------------------------------------
# 2. Deploy core contracts
# ---------------------------------------------------------------------------
log "running script/DeployLocal.s.sol"
forge script script/DeployLocal.s.sol:DeployLocal \
  --rpc-url "$ANVIL_RPC_URL" \
  --broadcast \
  --skip-simulation >"$DEPLOYMENTS_DIR/deploy-local.log" 2>&1 \
  || { tail -40 "$DEPLOYMENTS_DIR/deploy-local.log" >&2; fail "DeployLocal reverted"; }

BROADCAST_JSON="broadcast/DeployLocal.s.sol/31337/run-latest.json"
[ -f "$BROADCAST_JSON" ] || fail "expected broadcast artifact at $BROADCAST_JSON"

# Pull a deployed address by contract name. Forge records every CREATE with the
# contract name, so this is more reliable than scraping console output.
address_of() {
  jq -r --arg name "$1" '
    [.transactions[] | select(.contractName == $name and .contractAddress != null)]
    | last | .contractAddress // empty
  ' "$BROADCAST_JSON"
}

POOL_MANAGER="$(address_of PoolManager)"
POLICY_REGISTRY="$(address_of PolicyRegistry)"
POLICY_VERIFIER="$(address_of PolicyVerifier)"
POLICY_AUTHORIZATION="$(address_of PolicyAuthorization)"
MEVSHIELD_HOOK="$(address_of MEVShieldHook)"
MEVSHIELD_ROUTER="$(address_of MEVShieldRouter)"

for pair in \
  "PoolManager:$POOL_MANAGER" \
  "PolicyRegistry:$POLICY_REGISTRY" \
  "PolicyVerifier:$POLICY_VERIFIER" \
  "PolicyAuthorization:$POLICY_AUTHORIZATION" \
  "MEVShieldHook:$MEVSHIELD_HOOK" \
  "MEVShieldRouter:$MEVSHIELD_ROUTER"; do
  name="${pair%%:*}"
  value="${pair#*:}"
  [ -n "$value" ] || fail "could not read $name address from $BROADCAST_JSON"
done

# DeployLocal hard-codes the authorized signer as anvil key 0xA11CE.
AUTHORIZED_SIGNER="$(cast wallet address --private-key 0x00000000000000000000000000000000000000000000000000000000000a11ce)"

log "core contracts deployed"
log "  PoolManager         $POOL_MANAGER"
log "  PolicyRegistry      $POLICY_REGISTRY"
log "  PolicyVerifier      $POLICY_VERIFIER"
log "  PolicyAuthorization $POLICY_AUTHORIZATION"
log "  MEVShieldHook       $MEVSHIELD_HOOK"
log "  MEVShieldRouter     $MEVSHIELD_ROUTER"

# ---------------------------------------------------------------------------
# 3. Pool tokens, pool, liquidity and approvals
# ---------------------------------------------------------------------------
log "running script/SetupBackendSwap.s.sol"
POOL_MANAGER="$POOL_MANAGER" \
MEVSHIELD_HOOK="$MEVSHIELD_HOOK" \
MEVSHIELD_ROUTER="$MEVSHIELD_ROUTER" \
forge script script/SetupBackendSwap.s.sol:SetupBackendSwap \
  --rpc-url "$ANVIL_RPC_URL" \
  --broadcast \
  --skip-simulation >"$DEPLOYMENTS_DIR/setup-swap.log" 2>&1 \
  || { tail -40 "$DEPLOYMENTS_DIR/setup-swap.log" >&2; fail "SetupBackendSwap reverted"; }

SWAP_BROADCAST="broadcast/SetupBackendSwap.s.sol/31337/run-latest.json"
[ -f "$SWAP_BROADCAST" ] || fail "expected broadcast artifact at $SWAP_BROADCAST"

# Both pool tokens are MockERC20, so take them in deployment order.
TOKEN_A="$(jq -r '[.transactions[] | select(.contractName == "MockERC20" and .contractAddress != null)] | .[0].contractAddress // empty' "$SWAP_BROADCAST")"
TOKEN_B="$(jq -r '[.transactions[] | select(.contractName == "MockERC20" and .contractAddress != null)] | .[1].contractAddress // empty' "$SWAP_BROADCAST")"

[ -n "$TOKEN_A" ] || fail "could not read the first mock token address"
[ -n "$TOKEN_B" ] || fail "could not read the second mock token address"

# Uniswap v4 orders currencies by address. Lower address is currency0.
if [ "$(printf '%s\n%s\n' "$TOKEN_A" "$TOKEN_B" | sort -f | head -1)" = "$TOKEN_A" ]; then
  CURRENCY0="$TOKEN_A"
  CURRENCY1="$TOKEN_B"
else
  CURRENCY0="$TOKEN_B"
  CURRENCY1="$TOKEN_A"
fi

POOL_FEE=3000
TICK_SPACING=60

# PoolId = keccak256(abi.encode(poolKey)). Same encoding the frontend uses in
# lib/protectedQuote.ts and the backend in runtimeConfig.ts.
POOL_ID="$(cast keccak "$(cast abi-encode \
  'f((address,address,uint24,int24,address))' \
  "($CURRENCY0,$CURRENCY1,$POOL_FEE,$TICK_SPACING,$MEVSHIELD_HOOK)")")"

log "pool ready"
log "  TokenA       $TOKEN_A"
log "  TokenB       $TOKEN_B"
log "  currency0    $CURRENCY0"
log "  currency1    $CURRENCY1"
log "  PoolId       $POOL_ID"

# Sanity check: the pool must actually be initialized and funded on chain.
#
# slot0's state slot is keccak256(poolId || 6), mirroring poolStateSlots() in
# frontend/src/lib/protectedQuote.ts. In Uniswap v4, sqrtPriceX96 occupies the
# low 160 bits of slot0, so the value is the LAST 40 hex characters of the word.
# A zero sqrtPriceX96 means initialize() was never called for this pool.
#
# Liquidity is checked through token balances rather than the packed Liquidity
# slot: bash cannot add 3 to a 256-bit slot key, and the PoolManager balance is
# a more direct statement of "the pool actually holds funds".
SLOT0_KEY="$(cast keccak "0x${POOL_ID#0x}$(printf '%064x' 6)")"
SLOT0_RAW="$(cast call "$POOL_MANAGER" 'extsload(bytes32)(bytes32)' "$SLOT0_KEY" --rpc-url "$ANVIL_RPC_URL")"
SQRT_PRICE_X96="$(cast to-dec "0x${SLOT0_RAW: -40}")"

if [ "$SQRT_PRICE_X96" = "0" ]; then
  fail "pool $POOL_ID is not initialized on chain (sqrtPriceX96 is zero)"
fi

TOKEN0_BALANCE="$(cast call "$CURRENCY0" 'balanceOf(address)(uint256)' "$POOL_MANAGER" --rpc-url "$ANVIL_RPC_URL" | awk '{print $1}')"
TOKEN1_BALANCE="$(cast call "$CURRENCY1" 'balanceOf(address)(uint256)' "$POOL_MANAGER" --rpc-url "$ANVIL_RPC_URL" | awk '{print $1}')"

if [ "$TOKEN0_BALANCE" = "0" ] || [ "$TOKEN1_BALANCE" = "0" ]; then
  fail "pool $POOL_ID holds no liquidity (token0=$TOKEN0_BALANCE token1=$TOKEN1_BALANCE)"
fi

log "pool initialized, sqrtPriceX96=$SQRT_PRICE_X96"
log "pool funded, token0=$TOKEN0_BALANCE token1=$TOKEN1_BALANCE"

# ---------------------------------------------------------------------------
# 4. Write the artifacts other tools read
# ---------------------------------------------------------------------------
cat >"$OUT_JSON" <<JSON
{
  "chainId": 31337,
  "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "poolManager": "$POOL_MANAGER",
  "policyRegistry": "$POLICY_REGISTRY",
  "policyVerifier": "$POLICY_VERIFIER",
  "policyAuthorization": "$POLICY_AUTHORIZATION",
  "mevShieldHook": "$MEVSHIELD_HOOK",
  "mevShieldRouter": "$MEVSHIELD_ROUTER",
  "authorizedSigner": "$AUTHORIZED_SIGNER",
  "protectedPool": {
    "currency0": "$CURRENCY0",
    "currency1": "$CURRENCY1",
    "fee": $POOL_FEE,
    "tickSpacing": $TICK_SPACING,
    "hooks": "$MEVSHIELD_HOOK",
    "poolId": "$POOL_ID"
  },
  "tokens": {
    "tokenA": "$TOKEN_A",
    "tokenB": "$TOKEN_B"
  }
}
JSON

# Plain env file, sourced by the up script and usable by hand.
cat >"$OUT_ENV" <<ENV
# Generated by script/docker-deploy-local.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Chain 31337 only. Never use these values for a real network.
CHAIN_ID=31337
POOL_MANAGER=$POOL_MANAGER
POLICY_REGISTRY=$POLICY_REGISTRY
POLICY_VERIFIER=$POLICY_VERIFIER
POLICY_AUTHORIZATION=$POLICY_AUTHORIZATION
MEVSHIELD_HOOK=$MEVSHIELD_HOOK
MEVSHIELD_ROUTER=$MEVSHIELD_ROUTER
AUTHORIZED_SIGNER=$AUTHORIZED_SIGNER
CURRENCY0=$CURRENCY0
CURRENCY1=$CURRENCY1
POOL_FEE=$POOL_FEE
TICK_SPACING=$TICK_SPACING
POOL_ID=$POOL_ID
TOKEN_A=$TOKEN_A
TOKEN_B=$TOKEN_B
ENV

# ---------------------------------------------------------------------------
# 5. Verify against the configured expectations
# ---------------------------------------------------------------------------
# The other services pin the deterministic addresses from script/DeployLocal.s.sol
# and script/SetupBackendSwap.s.sol. If a redeploy produced different addresses
# (for example because anvil was not reset), starting the stack would point the
# backend at the wrong contract. Fail loudly instead.
mismatch=""
for pair in \
  "EXPECTED_POOL_MANAGER:$POOL_MANAGER" \
  "EXPECTED_POLICY_REGISTRY:$POLICY_REGISTRY" \
  "EXPECTED_POLICY_VERIFIER:$POLICY_VERIFIER" \
  "EXPECTED_POLICY_AUTHORIZATION:$POLICY_AUTHORIZATION" \
  "EXPECTED_MEVSHIELD_HOOK:$MEVSHIELD_HOOK" \
  "EXPECTED_MEVSHIELD_ROUTER:$MEVSHIELD_ROUTER" \
  "EXPECTED_AUTHORIZED_SIGNER:$AUTHORIZED_SIGNER" \
  "EXPECTED_TOKEN_A:$TOKEN_A" \
  "EXPECTED_TOKEN_B:$TOKEN_B" \
  "EXPECTED_POOL_ID:$POOL_ID"; do
  var="${pair%%:*}"
  actual="${pair#*:}"
  expected="${!var:-}"
  if [ -n "$expected" ] && [ "${expected,,}" != "${actual,,}" ]; then
    mismatch="$mismatch
  $var: expected $expected, deployed $actual"
  fi
done

if [ -n "$mismatch" ]; then
  log "deployed addresses differ from the addresses the other services expect:"
  printf '%s\n' "$mismatch" >&2
  log "The chain was probably not reset. Run 'docker compose down -v' to clear anvil state, then start again."
  log "Addresses written to $OUT_JSON for inspection."
  exit 1
fi

log "deployment matches the expected local addresses"
log "addresses written to $OUT_JSON and $OUT_ENV"
exit 0
