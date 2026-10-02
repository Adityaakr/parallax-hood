#!/usr/bin/env bash
# One uninterrupted pass: fresh fork at head -> deploy -> warm every index constituent -> create the indices.
# Warming is sequential on purpose: parallel first-touch reads against a public archive RPC wedge anvil's
# fork backend, which is the failure mode recorded in .prism/project-model.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="$HOME/.foundry/bin:$PATH"
set -a; [ -f "$ROOT/.env" ] && . "$ROOT/.env"; set +a
cd "$ROOT"
FORK_FRESH=1 ./scripts/fork-up.sh
echo "== warming index constituents (sequential)"
pnpm --filter @parallax-hood/scripts warm-fork
echo "== creating indices"
CHAIN_ID=31337 pnpm --filter @parallax-hood/scripts create-indices
echo "== warming through the resolver (prices, feeds, pools)"
if curl -s -m 5 -o /dev/null "${RESOLVER:-http://127.0.0.1:4001}/health"; then
  for T in $(node -e 'const c=require("../contracts/script/config/bsc.json");console.log([...new Set(c.indices.flatMap(i=>i.constituents.map(x=>x.ticker)))].join(" "))' 2>/dev/null || python3 -c "
import json;c=json.load(open('contracts/script/config/bsc.json'));print(' '.join(sorted({x['ticker'] for i in c['indices'] for x in i['constituents']})))"); do
    printf '  %-6s ' "$T"; curl -s -m 300 -o /dev/null -w '%{http_code} %{time_total}s\n' "${RESOLVER:-http://127.0.0.1:4001}/stocks/$T"
  done
else
  echo "  (resolver not running on ${RESOLVER:-http://127.0.0.1:4001}; skip)"
fi
