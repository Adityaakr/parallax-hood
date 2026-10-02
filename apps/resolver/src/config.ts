import { copyFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseDeployment, type Deployment, CHAINS, chainIdToNetwork, type NetworkKey, BSC_ADDRESSES } from "@parallax-hood/sdk";

const CHAIN_USDT: Partial<Record<NetworkKey, string>> = { bsc: BSC_ADDRESSES.usdt, fork: BSC_ADDRESSES.usdt };

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4000),
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().optional(),
  BSC_RPC_URL: z.string().default("https://bsc-dataseed.binance.org"),
  BSC_TESTNET_RPC_URL: z.string().default("https://data-seed-prebsc-1-s1.binance.org:8545"),
  FORK_RPC_URL: z.string().default("http://127.0.0.1:8547"),
  MOCKS_RPC_URL: z.string().default("http://127.0.0.1:8548"),
  /* Default per chain. Receipts and quote records carry no chain column, so one file for two networks mixes a
     mocks run into a mainnet one — and SQLite locks the second process out anyway. An explicit value still wins. */
  DATABASE_URL: z.string().optional(),
  BINANCE_WEB3_API_KEY: z.string().optional(),
  BINANCE_WEB3_API_SECRET: z.string().optional(),
  BINANCE_CLIENT_MODE: z.enum(["live", "fixtures", "record"]).optional(),
  DEPLOYMENTS_DIR: z.string().default(resolve(REPO_ROOT, "contracts/deployments")),
  FIXTURES_DIR: z.string().default(resolve(REPO_ROOT, "fixtures/binance")),
  INDEXER_FROM_BLOCK: z.coerce.bigint().optional(),
  INDEXER_POLL_MS: z.coerce.number().default(8000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Run without deployed contracts: quote real tokens on real venues, execute nothing. */
  QUOTE_ONLY: z.coerce.boolean().default(false),
  /** Protocol fee shown in quote-only mode (no registry to read); the deployed registry is the source otherwise. */
  PROTOCOL_FEE_BPS: z.coerce.number().int().min(0).max(100).default(50),
  /** Testnet faucet signer (mints mock USDT, tops up tBNB). Never used on mainnet. */
  FAUCET_PRIVATE_KEY: z.string().optional(),
  FAUCET_COOLDOWN_S: z.coerce.number().default(6 * 3600),
  /** Hybrid demo: market data from BSC mainnet, execution on this (mock) network. Default on for BSC testnet. */
  HYBRID_MARKETS: z.coerce.boolean().optional(),
  /** Daily stock closes for the return figures (display only). Off on the mocks chain and in tests. */
  MARKET_HISTORY: z.coerce.boolean().default(true),
  MARKET_HISTORY_URL: z.string().default("https://query1.finance.yahoo.com"),
  UNIVERSE_FILE: z.string().optional(),
});

export type Config = z.infer<typeof EnvSchema> & {
  quoteOnly: boolean;
  /** true when this network executes on mock tokens twinned with mainnet tokens for every market read */
  hybrid: boolean;
  network: NetworkKey;
  rpcUrl: string;
  deployment: Deployment;
  chain: (typeof CHAINS)[NetworkKey];
  dbPath: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = EnvSchema.parse(env);
  const network = chainIdToNetwork(e.CHAIN_ID);
  const rpcUrl = e.RPC_URL ?? (network === "bsc" ? e.BSC_RPC_URL : network === "bscTestnet" ? e.BSC_TESTNET_RPC_URL : network === "mocks" ? e.MOCKS_RPC_URL : e.FORK_RPC_URL);
  const depPath = resolve(e.DEPLOYMENTS_DIR, `${e.CHAIN_ID}.json`);
  const deployed = existsSync(depPath);
  // Quote-only: no contracts anywhere, so the registry/router/vault addresses stay zero and every write path is
  // closed. Reads (token ratios, venue quotes, reference prices) need no deployment at all.
  const quoteOnly = e.QUOTE_ONLY || !deployed;
  if (!deployed && !e.QUOTE_ONLY && e.CHAIN_ID !== 56) throw new Error(`no deployment for chain ${e.CHAIN_ID} at ${depPath}; run the deploy scripts first`);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const deployment = deployed
    ? parseDeployment(JSON.parse(readFileSync(depPath, "utf8")))
    : parseDeployment({ chainId: e.CHAIN_ID, usdt: CHAIN_USDT[network] ?? ZERO, registry: ZERO, router: ZERO, factory: ZERO, mandate: ZERO });
  const dbUrl = e.DATABASE_URL ?? `file:./parallax-${e.CHAIN_ID}.db`;
  const dbPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
  // one-time move off the old shared file, so an existing index is carried over instead of re-fetched
  if (!e.DATABASE_URL && !existsSync(dbPath) && existsSync("./parallax.db")) {
    for (const ext of ["", "-wal", "-shm"]) {
      if (existsSync(`./parallax.db${ext}`)) copyFileSync(`./parallax.db${ext}`, `${dbPath}${ext}`);
    }
  }
  const hybrid = e.HYBRID_MARKETS ?? (network === "bscTestnet" && Boolean(deployment.mocks));
  return { ...e, DATABASE_URL: dbUrl, quoteOnly, hybrid, network, rpcUrl, deployment, chain: CHAINS[network], dbPath };
}
