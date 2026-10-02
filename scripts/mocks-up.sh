#!/usr/bin/env bash
# Plain local anvil (chain 1337, port 8648) with mock USDG, mock stock tokens and a deterministic swap venue.
# Used by integration tests and as the "no funds needed" path. Mirrors what is deployed on Robinhood Chain Testnet.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
PORT="${MOCKS_PORT:-8648}"
RPC="http://127.0.0.1:${PORT}"
export DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d96d4fd05f9}"
# protocol fees go to anvil account #9 (unused by any test), not the deployer, so tests can tell fee flows from refunds
export FEE_RECIPIENT="${FEE_RECIPIENT:-0xa0Ee7A142d267C1f36714E4a8F75612F20a79720}"
DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_PRIVATE_KEY")"
mkdir -p "$ROOT/.fork"
if ! curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1; then
  # base fee as measured on Robinhood Chain (about 0.035 gwei), so gas costs in quotes look like the real chain's
  nohup anvil --chain-id 1337 --port "$PORT" --block-base-fee-per-gas 35000000 --silent > "$ROOT/.fork/anvil-mocks.log" 2>&1 &
  for i in $(seq 1 20); do sleep 0.5; curl -s -X POST "$RPC" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' >/dev/null 2>&1 && break; done
fi
cast rpc anvil_setBalance "$DEPLOYER" 0x21E19E0C9BAB2400000 -r "$RPC" >/dev/null
cd "$ROOT/contracts"
unset USDG_ADDRESS
mkdir -p deployments
rm -f deployments/1337.json
for S in DeployMocks DeployCore ConfigureRegistry CreateBasket; do
  forge script script/Deploy.s.sol:$S --rpc-url "$RPC" --broadcast >/dev/null 2>&1 || { echo "$S failed"; exit 1; }
done
echo "mocks chain ready on $RPC (CHAIN_ID=1337); deployer $DEPLOYER holds 1,000,000 mock USDG"
