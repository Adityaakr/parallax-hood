# Deploying Parallax

Four processes. The web app is a Next.js server; the resolver, keeper and MCP server are long-running Node
processes, and the resolver holds a SQLite file and polls the chain, so it needs a persistent disk. Two images
cover all of it: `Dockerfile` runs the resolver, keeper or MCP depending on `PROCESS`, and `Dockerfile.web`
runs the app. Railway and Fly both work.

Nothing here is required to judge the project: the README's local quick start runs the whole stack against
mainnet data in under ten commands.

## Why the resolver cannot be serverless

- It keeps a **SQLite file**: the receipt index, the quote records each `quoteHash` resolves to, and the daily
  price bars behind the return figures. An ephemeral filesystem means re-indexing from the deploy block on
  every cold start: ~440,000 blocks in 2,000-block chunks, which a public BSC RPC will rate-limit.
- It runs a **background indexer** on a timer, which a request-scoped runtime will kill between requests.
- Quotes take **seconds**, not milliseconds: seven constituents, each priced across PancakeSwap fee tiers and,
  for the desk-only names, an RFQ round trip. A 10-second function limit is not enough.

## Railway: two services

One project, two services, both from this repository. They differ only in which Dockerfile they build and what
is in their variables. Deploy the **resolver first**: the web app's resolver URL is baked into its bundle at
build time, so it needs the resolver's public domain before it builds.

### Service 1: resolver

Settings: Dockerfile build, **volume mounted at `/data`**, health check path `/health`.

```
RAILWAY_DOCKERFILE_PATH=Dockerfile
PROCESS=resolver
CHAIN_ID=56
PORT=4000
BSC_RPC_URL=https://bsc-dataseed1.bnbchain.org
BINANCE_WEB3_API_KEY=<key>
BINANCE_WEB3_API_SECRET=<secret>
BINANCE_CLIENT_MODE=live
LOG_LEVEL=info
```

`DATABASE_URL` is derived as `file:/data/parallax-56.db`, so the volume is used as soon as it is mounted. Set
it only to move the file. Without the volume the receipt index is rebuilt from the deploy block on every
restart, and a public RPC will rate-limit that.

Then generate a public domain and check it: `GET /health` should answer `{"ok":true,"chainId":56,…}` and
`POST /baskets/pxMAG7/quote-mint {"budgetUsdt":"50"}` should come back with seven legs and no problems.

### Service 2: web

Settings: Dockerfile build, no volume, no health check path (the app has no `/health` route).

```
RAILWAY_DOCKERFILE_PATH=Dockerfile.web
NEXT_PUBLIC_RESOLVER_URLS={"56":"https://<resolver public domain>"}
NEXT_PUBLIC_DEFAULT_CHAIN=56
NEXT_PUBLIC_PRIVY_APP_ID=<privy app id>
PORT=3100
```

Three things to get right:

- **Allowlist the domain in Privy.** Connect is Privy with external wallets only, and Privy refuses to
  initialise on a domain the app does not list. Add the Railway domain under Settings &rarr; Domains in the
  Privy dashboard, or the connect button opens a modal that cannot log anyone in.

- **Use the resolver's public domain, not `*.railway.internal`.** The browser makes these calls, so private
  networking is not reachable. The resolver sends permissive CORS headers already.
- **`NEXT_PUBLIC_*` is inlined at build.** Changing either variable needs a redeploy of the web service, not
  just a restart. Without `NEXT_PUBLIC_DEFAULT_CHAIN=56` the app opens on the local mocks chain and every page
  reports no resolver.

### Optional third and fourth services

Same image as the resolver, `PROCESS` selects the process:

- **keeper**: the heartbeat that keeps ratios and attestations inside their windows. Without it they age out and
  buys stop, which is the designed behaviour but not a product. No volume, no health check.

  ```
  RAILWAY_DOCKERFILE_PATH=Dockerfile
  PROCESS=keeper
  CHAIN_ID=56
  KEEPER_PRIVATE_KEY=<key>
  RESOLVER_URL=http://<resolver service>.railway.internal:4000
  BSC_RPC_URL=https://bsc-dataseed1.bnbchain.org
  BINANCE_WEB3_API_KEY=<key>
  BINANCE_WEB3_API_SECRET=<secret>
  ```

  It holds a hot key that can only post to the registry and call the permissionless `migrate`; it cannot move a
  vault's funds. Run `keeper plan` first: it prints what a pass would send, what is about to expire and the
  daily gas bill, and sends nothing. With both windows at seven days it posts roughly five transactions a day,
  about 0.00001 BNB, so 0.01 BNB is months of runway.
- **mcp**: `PROCESS=mcp`, `CHAIN_ID=56`, `RESOLVER_URL`, `PORT=4010`, and `AGENT_PRIVATE_KEY` if the one write
  tool should be live. Without that key the fifteen read tools work and `execute_with_mandate` refuses.

### Things that will bite

- **The build context.** `.dockerignore` keeps it to a few MB; without it the builder is handed 1.4 GB of
  `node_modules` and reference screenshots.
- **`contracts/out` is not in the repository.** It is Foundry build output, so the SDK's ABI generator skips
  regeneration when it is absent and the committed `packages/sdk/src/abis.ts` is used. Regenerate locally with
  `forge build && pnpm --filter @parallax-hood/sdk build` whenever a contract changes, and commit the result.
- **Public RPCs rate-limit shared datacenter IPs** harder than they rate-limit a laptop. A keyed endpoint is
  worth it for the resolver, which reads constantly.
- **The Binance Web3 API** is signed per request and rate-limited; a 429 degrades the catalogue to labeled
  fixtures rather than failing the request, which is visible in `/health` as `binance.mode`.
- **Node 22+**: the resolver uses the `node:sqlite` builtin. Both images pin `node:22-slim`.

## Vercel, if you would rather host the web app there

`apps/web/vercel.json` sets the monorepo install and build. Set the root directory to `apps/web` and give it
the same `NEXT_PUBLIC_RESOLVER_URLS` and `NEXT_PUBLIC_DEFAULT_CHAIN`. The resolver still has to live somewhere
with a disk.

## Fly

`fly.toml` is equivalent: `PROCESS` in `[env]`, a `parallax_data` volume at `/data`, `/health` as the check,
and `min_machines_running = 1` so the indexer is never suspended.
