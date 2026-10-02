import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseDeployment, mockTwins, CHAINS, chainIdToNetwork } from "@parallax-hood/sdk";

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

const Env = z.object({
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().optional(),
  BSC_RPC_URL: z.string().default("https://bsc-dataseed.binance.org"),
  BSC_TESTNET_RPC_URL: z.string().default("https://data-seed-prebsc-1-s1.binance.org:8545"),
  FORK_RPC_URL: z.string().default("http://127.0.0.1:8547"),
  MOCKS_RPC_URL: z.string().default("http://127.0.0.1:8548"),
  KEEPER_PRIVATE_KEY: z.string().optional(),
  RESOLVER_URL: z.string().default("http://127.0.0.1:4000"),
  BINANCE_WEB3_API_KEY: z.string().optional(),
  BINANCE_WEB3_API_SECRET: z.string().optional(),
  BINANCE_CLIENT_MODE: z.enum(["live", "fixtures", "record"]).optional(),
  FIXTURES_DIR: z.string().default(resolve(REPO_ROOT, "fixtures/binance")),
  DEPLOYMENTS_DIR: z.string().default(resolve(REPO_ROOT, "contracts/deployments")),
  KEEPER_PORT: z.coerce.number().default(4020),
  KEEPER_DRY_RUN: z.coerce.boolean().default(false),
  RATIO_INTERVAL_MS: z.coerce.number().default(10 * 60_000),
  /* What the keeper is responsible for. "baskets": only the underlyings a deployed vault actually holds — the
     rest of the registry is quotable without a keeper post and costs gas to maintain. "registry": everything. */
  KEEPER_SCOPE: z.enum(["baskets", "registry"]).default("baskets"),
  /* Gas guards. Below the floor the keeper stops sending and says what it would have sent; the daily cap is a
     circuit breaker against a job that re-posts in a loop. Both are measured, never assumed. */
  KEEPER_MIN_BALANCE_BNB: z.coerce.number().default(0.0005),
  KEEPER_MAX_TX_PER_DAY: z.coerce.number().default(250),
  /* A ratio is re-posted when it moves at least this much, or when it reaches half the registry's own max age. */
  RATIO_POST_MIN_BPS: z.coerce.number().default(1),
  ATTESTATION_INTERVAL_MS: z.coerce.number().default(60 * 60_000),
  MARKET_INTERVAL_MS: z.coerce.number().default(5 * 60_000),
  /* Posting market state costs a transaction per underlying at every open and close. Nothing onchain reads it,
     and off the mocks chain the resolver takes market status from Binance with an exchange-calendar fallback,
     so it is posted only where it is actually read. */
  POST_MARKET_STATE: z.coerce.boolean().optional(),
  MIGRATION_INTERVAL_MS: z.coerce.number().default(5 * 60_000),
  MIGRATION_MIN_GAIN_BPS: z.coerce.number().default(30),
  CHECKPOINT_DRIFT_BPS: z.coerce.number().default(10),
  PRICE_INTERVAL_MS: z.coerce.number().default(5 * 60_000),
  /* The posted price is an execution floor for agent buys, not a feed: it is re-posted on a 1% move or at half
     the registry's max age, not on every tick the market makes. */
  PRICE_DRIFT_BPS: z.coerce.number().default(100),
  /** Hybrid demo (mock network, markets from mainnet): mirror twin prices/multipliers onto the mocks. */
  HYBRID_MARKETS: z.coerce.boolean().optional(),
  MIRROR_INTERVAL_MS: z.coerce.number().default(60_000),
  MIRROR_DRIFT_BPS: z.coerce.number().default(5),
});

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = Env.parse(env);
  const network = chainIdToNetwork(e.CHAIN_ID);
  const rpcUrl = e.RPC_URL ?? (network === "bsc" ? e.BSC_RPC_URL : network === "bscTestnet" ? e.BSC_TESTNET_RPC_URL : network === "mocks" ? e.MOCKS_RPC_URL : e.FORK_RPC_URL);
  const depPath = resolve(e.DEPLOYMENTS_DIR, `${e.CHAIN_ID}.json`);
  if (!existsSync(depPath)) throw new Error(`no deployment for chain ${e.CHAIN_ID} at ${depPath}`);
  const deployment = parseDeployment(JSON.parse(readFileSync(depPath, "utf8")));
  const hybrid = e.HYBRID_MARKETS ?? (network === "bscTestnet" && Boolean(deployment.mocks));
  const universe = JSON.parse(readFileSync(resolve(REPO_ROOT, "contracts/script/config/bsc.json"), "utf8")) as { representations: { symbol: string; token: string; ticker: string; platform: string }[] };
  return { ...e, network, rpcUrl, hybrid, postMarketState: e.POST_MARKET_STATE ?? network === "mocks", chain: CHAINS[network], deployment, twins: hybrid ? mockTwins(deployment, universe.representations) : new Map() };
}
export type Config = ReturnType<typeof loadConfig>;
