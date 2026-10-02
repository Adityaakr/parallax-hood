#!/usr/bin/env bash
# Starts a local fork of Robinhood Chain mainnet on :8647 (chain id 31337), deploys Parallax to it, registers the
# seven real stock tokens with their Chainlink feeds, creates both indices and gives the local dev account ETH
# and 5,000 real USDG (moved out of the deepest USDG pool).
#
# The public RPC keeps about ten minutes of state, so a fork of it goes dark soon after it starts. For anything
# longer, point ROBINHOOD_FORK_RPC_URL at an archive endpoint (the docs recommend Alchemy) and the block is pinned
# so the state cache survives restarts.
#   ./scripts/fork-up.sh                 # anvil log at .fork/anvil.log
#   FORK_FRESH=1 ./scripts/fork-up.sh    # re-pin at the current head
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
FORK_URL="${ROBINHOOD_FORK_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
PORT="${FORK_PORT:-8647}"
RPC="http://127.0.0.1:${PORT}"
# A local fork always deploys with the repository's local dev key, never a real-network key: an inherited
# DEPLOYER_PRIVATE_KEY would make the fork's admin an account whose key should not be used here, one RPC
# misconfiguration away from signing somewhere real. Override deliberately with FORK_PRIVATE_KEY.
export DEPLOYER_PRIVATE_KEY="${FORK_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9}"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
CFG="$ROOT/contracts/script/config/robinhood.json"
USDG="$(python3 -c "import json;print(json.load(open('$CFG'))['usdg'])")"
WETH="$(python3 -c "import json;print(json.load(open('$CFG'))['weth'])")"
V3_FACTORY=0x1f7d7550B1b028f7571E69A784071F0205FD2EfA   # docs/addresses.md, section 5
rpc_up() { curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; }

mkdir -p "$ROOT/.fork"
if [ "${FORK_FRESH:-0}" = "1" ] && rpc_up; then
  echo "FORK_FRESH=1: stopping the fork already on $RPC so it can be re-pinned at head"
  lsof -ti:"$PORT" | xargs -r kill -9 2>/dev/null || true
  sleep 2
fi
if rpc_up; then
  echo "anvil already listening on $RPC"
else
  if [ "$(cast chain-id -r "$FORK_URL")" != "4663" ]; then echo "refusing: $FORK_URL is not Robinhood Chain (4663)"; exit 1; fi
  if [ -z "${FORK_BLOCK:-}" ]; then
    if [ -f "$ROOT/.fork/block" ] && [ "${FORK_FRESH:-0}" != "1" ] && [ -n "${ROBINHOOD_FORK_RPC_URL:-}" ]; then FORK_BLOCK="$(cat "$ROOT/.fork/block")"; else FORK_BLOCK="$(( $(cast block-number -r "$FORK_URL") - 20 ))"; fi
  fi
  echo "$FORK_BLOCK" > "$ROOT/.fork/block"
  echo "starting anvil fork of $FORK_URL at block $FORK_BLOCK on $RPC"
  nohup anvil --fork-url "$FORK_URL" --fork-block-number "$FORK_BLOCK" --chain-id 31337 --port "$PORT" --no-rate-limit --timeout 45000 --retries 8 > "$ROOT/.fork/anvil.log" 2>&1 &
  for _ in $(seq 1 30); do sleep 1; rpc_up && break; done
fi

POOL="$(cast call "$V3_FACTORY" 'getPool(address,address,uint24)(address)' "$USDG" "$WETH" 100 -r "$RPC")"
cast rpc anvil_setBalance "$DEPLOYER" 0x21E19E0C9BAB2400000 -r "$RPC" >/dev/null
cast rpc anvil_impersonateAccount "$POOL" -r "$RPC" >/dev/null
cast rpc anvil_setBalance "$POOL" 0x21E19E0C9BAB2400000 -r "$RPC" >/dev/null
cast send "$USDG" 'transfer(address,uint256)' "$DEPLOYER" 5000000000 --from "$POOL" --unlocked -r "$RPC" >/dev/null
cast rpc anvil_stopImpersonatingAccount "$POOL" -r "$RPC" >/dev/null
echo "funded $DEPLOYER with ETH and 5,000 USDG"

cd "$ROOT/contracts"
mkdir -p deployments
export USDG_ADDRESS="$USDG"
rm -f deployments/31337.json
for S in DeployCore ConfigureRegistry CreateBasket; do
  forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --broadcast >/dev/null 2>&1 || { echo "$S failed"; forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --broadcast | tail -20; exit 1; }
  echo "$S done"
done
cat deployments/31337.json
echo
echo "fork ready. CHAIN_ID=31337 for resolver, mcp and web. anvil log: $ROOT/.fork/anvil.log"
