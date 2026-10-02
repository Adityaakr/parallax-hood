#!/usr/bin/env bash
# Deploy the mock stack (mock USDT, one mock per index-constituent representation, deterministic venue) + Parallax
# core to BSC testnet (97), configure the registry, create pxDEMO3 and the three indices. Every mock is twinned
# with its mainnet token (mocks.json `mainnetToken`) for the hybrid demo. Needs DEPLOYER_PRIVATE_KEY funded with
# tBNB (~0.02 is plenty at 0.1 gwei).
# Writes contracts/deployments/97.json, which the resolver (CHAIN_ID=97) and keeper read.
#   scripts/testnet-up.sh dry    # simulate only
#   scripts/testnet-up.sh        # broadcast
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
RPC="${BSC_TESTNET_RPC_URL:-https://bsc-testnet-rpc.publicnode.com}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY in .env}"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
BAL="$(cast balance "$DEPLOYER" -r "$RPC")"
echo "deployer $DEPLOYER · balance $(cast from-wei "$BAL") tBNB · rpc $RPC"
if [ "$BAL" = "0" ]; then echo "fund $DEPLOYER with tBNB first: https://www.bnbchain.org/en/testnet-faucet"; exit 1; fi
cd "$ROOT/contracts"
unset USDT_ADDRESS
MODE="${1:-send}"
EXTRA=""
if [ "$MODE" != "dry" ]; then EXTRA="--broadcast --slow"; fi
for S in DeployMocks DeployCore ConfigureRegistry CreateBasket; do
  echo "== $S"
  # shellcheck disable=SC2086
  forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --chain-id 97 $EXTRA -vv | tail -6
done
echo "== indices (pxMAG7, pxAI, pxNEW)"
cd "$ROOT/scripts" && CHAIN_ID=97 npx tsx create-indices.mts
echo "done: contracts/deployments/97.json"
cat "$ROOT/contracts/deployments/97.json"
