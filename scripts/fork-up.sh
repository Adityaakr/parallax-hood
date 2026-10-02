#!/usr/bin/env bash
# Starts a local BSC mainnet fork on :8547, deploys Parallax to it, registers the real Mag 7 representations,
# creates pxMAG7 and funds the default dev account with BNB + 5,000 USDT (impersonated whale transfer).
# Usage: ./scripts/fork-up.sh            (keeps anvil in the foreground log at .fork/anvil.log)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
FORK_URL="${BSC_FORK_RPC_URL:-https://bsc-mainnet.public.blastapi.io}"
PORT="${FORK_PORT:-8547}"
RPC="http://127.0.0.1:${PORT}"
# A local fork always deploys with anvil's well-known dev key #0. Never a real-network key: an inherited
# DEPLOYER_PRIVATE_KEY from .env would make the fork's admin an account whose key we would rather not use here,
# and one RPC misconfiguration away from signing somewhere real. Override deliberately with FORK_PRIVATE_KEY.
export DEPLOYER_PRIVATE_KEY="${FORK_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9}"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
USDT=0x55d398326f99059fF775485246999027B3197955
WHALE=0x8894E0a0c962CB723c1976a4421c95949bE2D4E3   # Binance hot wallet, large USDT balance on BSC

mkdir -p "$ROOT/.fork"
# FORK_FRESH=1 means "re-pin at head", which is worthless if it silently no-ops on a fork that is already up —
# that is precisely the stale fork you are trying to replace. Stop the old one first.
if [ "${FORK_FRESH:-0}" = "1" ] && curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  echo "FORK_FRESH=1: stopping the fork already on $RPC so it can be re-pinned at head"
  lsof -ti:"$PORT" | xargs -r kill -9 2>/dev/null || true
  sleep 2
fi
if curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  echo "anvil already listening on $RPC"
else
  # Pin the fork block so anvil persists its upstream state cache on disk (~/.foundry/cache/rpc) between runs.
  if [ -z "${FORK_BLOCK:-}" ]; then
    if [ -f "$ROOT/.fork/block" ] && [ "${FORK_FRESH:-0}" != "1" ]; then FORK_BLOCK="$(cat "$ROOT/.fork/block")"; else FORK_BLOCK="$(( $(cast block-number -r "$FORK_URL") - 10 ))"; fi
  fi
  echo "$FORK_BLOCK" > "$ROOT/.fork/block"
  echo "starting anvil fork of $FORK_URL at block $FORK_BLOCK on $RPC (FORK_FRESH=1 to re-pin)"
  nohup anvil --fork-url "$FORK_URL" --fork-block-number "$FORK_BLOCK" --chain-id 31337 --port "$PORT" --no-rate-limit --gas-price 0 --timeout 45000 --retries 5 > "$ROOT/.fork/anvil.log" 2>&1 &
  for i in $(seq 1 30); do sleep 1; curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1 && break; done
fi

cast rpc anvil_setBalance "$DEPLOYER" 0x21E19E0C9BAB2400000 -r "$RPC" >/dev/null
cast rpc anvil_impersonateAccount "$WHALE" -r "$RPC" >/dev/null
cast rpc anvil_setBalance "$WHALE" 0x21E19E0C9BAB2400000 -r "$RPC" >/dev/null
cast send "$USDT" 'transfer(address,uint256)' "$DEPLOYER" 5000000000000000000000 --from "$WHALE" --unlocked -r "$RPC" >/dev/null
echo "funded $DEPLOYER with BNB and 5,000 USDT"

cd "$ROOT/contracts"
export USDT_ADDRESS="$USDT"
rm -f deployments/31337.json
for S in DeployCore ConfigureRegistry CreateBasket; do
  forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --broadcast >/dev/null 2>&1 || { echo "$S failed"; forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --broadcast | tail -20; exit 1; }
  echo "$S done"
done
cat deployments/31337.json
echo
echo "fork ready. CHAIN_ID=31337 for resolver/keeper/mcp/web. anvil log: $ROOT/.fork/anvil.log"
