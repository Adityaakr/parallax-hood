#!/usr/bin/env bash
# The resolver on Robinhood Chain Testnet (46630) with live market data: reference prices, pool depth and
# multipliers read from Robinhood Chain mainnet, quotes and corporate actions from Robinhood's API, and the
# mirror keeping the test venue, the registry reference and the test tokens' multipliers on mainnet's numbers.
#
# Needs .env with DEPLOYER_PRIVATE_KEY (the key `pnpm testnet:up` deployed with: it owns the test venue and the
# test tokens and is the registry's keeper) and FAUCET_PRIVATE_KEY for the /faucet route. The mirror signs with
# MIRROR_PRIVATE_KEY when that is set, and with the deployer key otherwise. Testnet only.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
export CHAIN_ID=46630
export HYBRID_MARKETS=true
export MIRROR_PRIVATE_KEY="${MIRROR_PRIVATE_KEY:-${DEPLOYER_PRIVATE_KEY:-}}"
[ -n "$MIRROR_PRIVATE_KEY" ] || echo "no MIRROR_PRIVATE_KEY or DEPLOYER_PRIVATE_KEY: prices are read live, but the test venue stays on its last mirrored price"
cd "$ROOT"
exec pnpm --filter @parallax-hood/resolver "${1:-dev}"
