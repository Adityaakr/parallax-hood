#!/usr/bin/env bash
# The whole flow against real Robinhood Chain mainnet state: real stock tokens, Chainlink feeds, USDG and
# Uniswap v3 pools (contracts/test/fork/RobinhoodChain.t.sol). Read-only towards the chain: everything is
# deployed and executed inside forge's local fork.
#
# The block is pinned a few blocks behind the head so all eight tests share one state cache. The public
# endpoint keeps about ten minutes of state and the run takes about a minute and a half, so it fits; pass
# ROBINHOOD_FORK_BLOCK to re-run an older block against an archive endpoint.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
export ROBINHOOD_RPC_URL="${ROBINHOOD_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
if [ "$(cast chain-id --rpc-url "$ROBINHOOD_RPC_URL")" != "4663" ]; then echo "refusing: $ROBINHOOD_RPC_URL is not Robinhood Chain (4663)"; exit 1; fi
export ROBINHOOD_FORK_BLOCK="${ROBINHOOD_FORK_BLOCK:-$(( $(cast block-number --rpc-url "$ROBINHOOD_RPC_URL") - 5 ))}"
echo "fork test at block $ROBINHOOD_FORK_BLOCK of chain 4663"
cd "$ROOT/contracts"
forge test --match-path 'test/fork/*' --no-match-path none -vv "$@"
