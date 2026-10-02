#!/usr/bin/env bash
# Deploy Parallax to Robinhood Chain Testnet (46630): the mock stack first (mock USDG, one mock stock token per
# stock, a deterministic venue), then the core contracts, the registry configuration and both indices.
#
# Why mocks: the testnet has no Uniswap deployment and no Chainlink feeds, and only two of the seven stocks exist
# there as faucet tokens (docs/addresses.md, section 7). Every mock carries the multiplier and the Chainlink token
# price its mainnet token had when contracts/script/config/mocks.json was generated, and the app labels them.
#
# Needs DEPLOYER_PRIVATE_KEY (in .env or the environment) funded with test ETH from
# https://faucet.testnet.chain.robinhood.com. Writes contracts/deployments/46630.json.
#   scripts/testnet-up.sh dry    # simulate the first step only (checks the key, the RPC and the config)
#   scripts/testnet-up.sh        # broadcast
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
RPC="${ROBINHOOD_TESTNET_RPC_URL:-https://rpc.testnet.chain.robinhood.com}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY in .env}"
CHAIN="$(cast chain-id -r "$RPC")"
if [ "$CHAIN" != "46630" ]; then echo "refusing: $RPC is chain $CHAIN, not Robinhood Chain Testnet (46630)"; exit 1; fi
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
BAL="$(cast balance "$DEPLOYER" -r "$RPC")"
echo "deployer $DEPLOYER, balance $(cast from-wei "$BAL") test ETH, rpc $RPC"
if [ "$BAL" = "0" ]; then echo "fund $DEPLOYER with test ETH first: https://faucet.testnet.chain.robinhood.com"; exit 1; fi
cd "$ROOT/contracts"
mkdir -p deployments
unset USDG_ADDRESS
MODE="${1:-send}"
EXTRA=""
STEPS="DeployMocks DeployCore ConfigureRegistry CreateBasket"
if [ "$MODE" != "dry" ]; then
  EXTRA="--broadcast --slow"; rm -f deployments/46630.json
else
  # Each later step reads the addresses the one before it deployed, and a simulation deploys nothing, so only
  # the first step can be simulated on its own. The file it writes holds simulated addresses and is removed.
  STEPS="DeployMocks"
  trap 'rm -f "$ROOT/contracts/deployments/46630.json"' EXIT
fi
for S in $STEPS; do
  echo "== $S"
  # shellcheck disable=SC2086
  forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --chain-id 46630 $EXTRA -vv | tail -6
done
if [ "$MODE" != "dry" ]; then
  echo "done: contracts/deployments/46630.json"
  cat deployments/46630.json
  echo
  echo "explorer: https://explorer.testnet.chain.robinhood.com/address/$(python3 -c "import json;print(json.load(open('deployments/46630.json'))['registry'])")"
fi
