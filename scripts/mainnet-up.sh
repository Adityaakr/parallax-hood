#!/usr/bin/env bash
# Deploy Parallax to BSC mainnet (chain 56): core contracts, the registry filled from
# contracts/script/config/$MAINNET_CONFIG (default bsc-indices.json: the 19 underlyings the three indices hold,
# 36 representations; bsc.json is the full 42-underlying universe) and the pxMAG7 basket; then pxAI and pxNEW.
# Real tokens, real PancakeSwap pools. Measured on testnet with the same contracts: core 10.4M gas, registry
# 14.7M, each basket ~4M -> about 37M gas, 0.0019 BNB at 0.05 gwei.
#
#   scripts/mainnet-up.sh dry     # simulate, costs nothing
#   scripts/mainnet-up.sh         # broadcast
#   VERIFY=1 scripts/mainnet-up.sh   # also verify on BscScan (needs BSCSCAN_API_KEY)
#   MAINNET_CONFIG=bsc.json scripts/mainnet-up.sh   # full universe (about 0.0025 BNB)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
RPC="${BSC_RPC_URL:-https://bsc-dataseed.binance.org}"
: "${DEPLOYER_PRIVATE_KEY:?set DEPLOYER_PRIVATE_KEY in .env}"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
BAL="$(cast balance "$DEPLOYER" -r "$RPC")"
GAS="$(cast gas-price -r "$RPC")"
echo "deployer $DEPLOYER"
echo "balance  $(cast from-wei "$BAL") BNB · gas $(python3 -c "print($GAS/1e9)") gwei · rpc $RPC"
MODE="${1:-send}"
export MAINNET_CONFIG="${MAINNET_CONFIG:-bsc-indices.json}"
# 37M gas at the current price, plus a fifth for headroom
NEED="$(python3 -c "print(int(37_000_000 * $GAS * 1.2))")"
if [ "$MODE" != "dry" ] && [ "$BAL" -lt "$NEED" ]; then
  echo "fund $DEPLOYER with at least $(cast from-wei "$NEED") BNB first (deploy needs ~37M gas at $(python3 -c "print($GAS/1e9)") gwei)"; exit 1
fi
echo "config   $MAINNET_CONFIG · deploy needs about $(cast from-wei "$NEED") BNB incl. headroom"
cd "$ROOT/contracts"
# mainnet uses the real USDT and the real issuer tokens: never deploy mocks here
export USDT_ADDRESS=0x55d398326f99059fF775485246999027B3197955
EXTRA=""
if [ "$MODE" != "dry" ]; then EXTRA="--broadcast --slow"; fi
if [ "${VERIFY:-0}" = "1" ] && [ "$MODE" != "dry" ]; then EXTRA="$EXTRA --verify"; fi
for S in DeployCore ConfigureRegistry CreateBasket; do
  echo "== $S"
  # shellcheck disable=SC2086
  forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --chain-id 56 $EXTRA -vv | tail -6
done
echo "== indices (pxAI, pxNEW)"
if [ "$MODE" != "dry" ]; then (cd "$ROOT/scripts" && CHAIN_ID=56 npx tsx create-indices.mts); fi
echo
echo "done: contracts/deployments/56.json"
cat "$ROOT/contracts/deployments/56.json"
echo
echo "next: CHAIN_ID=56 PORT=4056 pnpm --filter @parallax-hood/resolver dev"
