# Resolver + keeper + MCP (HTTP) in one image. Select the process with CMD or PROCESS env.
FROM node:22-slim AS base
RUN corepack enable && corepack prepare pnpm@11.23.0 --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps/resolver ./apps/resolver
COPY apps/keeper ./apps/keeper
COPY apps/mcp ./apps/mcp
# the deployment addresses and the curated universe are read at runtime; contracts/out is build output and is
# not in the repository, so the SDK falls back to its committed ABIs (see packages/sdk/scripts/gen-abis.ts)
COPY contracts/deployments ./contracts/deployments
COPY contracts/script/config ./contracts/script/config
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile --filter '!@parallax-hood/web'
RUN pnpm --filter @parallax-hood/sdk build && pnpm --filter @parallax-hood/binance-client build \
 && pnpm --filter @parallax-hood/resolver build && pnpm --filter @parallax-hood/keeper build && pnpm --filter @parallax-hood/mcp build
# The SQLite index belongs on a mounted volume: without one the receipt index is rebuilt from the deploy block
# on every restart, which a public RPC will rate-limit. No VOLUME instruction here — Railway rejects the image
# if it finds one, and both Railway and Fly mount the volume from their own config instead.
ENV NODE_ENV=production PROCESS=resolver PORT=4000
EXPOSE 4000 4010 4020
# one database per chain, on the volume — receipts and quote records carry no chain column
CMD ["sh", "-c", "export DATABASE_URL=${DATABASE_URL:-file:/data/parallax-${CHAIN_ID:-56}.db}; case \"$PROCESS\" in keeper) node apps/keeper/dist/cli.js run ;; mcp) node apps/mcp/dist/index.js --http ;; *) node apps/resolver/dist/server.js ;; esac"]
