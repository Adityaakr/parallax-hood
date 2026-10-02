import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseDeployment, type Deployment, CHAINS, chainIdToNetwork, type NetworkKey, ROBINHOOD_ADDRESSES } from "@parallax-hood/sdk";

const CHAIN_USDG: Partial<Record<NetworkKey, string>> = { robinhood: ROBINHOOD_ADDRESSES.usdg, fork: ROBINHOOD_ADDRESSES.usdg };

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, "../../..");

const EnvSchema = z.object({
  PORT: z.coerce.number().default(4100),
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().optional(),
  /* The public endpoints from docs.robinhood.com/chain. They are rate-limited and keep about ten minutes of
     state, which is enough for a resolver that only reads the head; an indexer backfill wants a keyed provider. */
  ROBINHOOD_RPC_URL: z.string().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_TESTNET_RPC_URL: z.string().default("https://rpc.testnet.chain.robinhood.com"),
  FORK_RPC_URL: z.string().default("http://127.0.0.1:8647"),
  MOCKS_RPC_URL: z.string().default("http://127.0.0.1:8648"),
  /* Default per chain. Receipts and quote records carry no chain column, so one file for two networks mixes a
     mocks run into a mainnet one — and SQLite locks the second process out anyway. An explicit value still wins. */
  DATABASE_URL: z.string().optional(),
  DEPLOYMENTS_DIR: z.string().default(resolve(REPO_ROOT, "contracts/deployments")),
  INDEXER_FROM_BLOCK: z.coerce.bigint().optional(),
  INDEXER_POLL_MS: z.coerce.number().default(8000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  /** Run without deployed contracts: quote real tokens on real venues, execute nothing. */
  QUOTE_ONLY: z.coerce.boolean().default(false),
  /** Protocol fee shown in quote-only mode (no registry to read); the deployed registry is the source otherwise. */
  PROTOCOL_FEE_BPS: z.coerce.number().int().min(0).max(100).default(50),
  /** Testnet faucet signer (mints mock USDG, tops up test ETH). Never used on mainnet. */
  FAUCET_PRIVATE_KEY: z.string().optional(),
  FAUCET_COOLDOWN_S: z.coerce.number().default(6 * 3600),
  /** Hybrid: market data from Robinhood Chain mainnet, execution on this (mock) network. Default on for the testnet. */
  HYBRID_MARKETS: z.coerce.boolean().optional(),
  /** Daily stock closes for the return figures (display only). Off on the mocks chain and in tests. */
  MARKET_HISTORY: z.coerce.boolean().default(true),
  MARKET_HISTORY_URL: z.string().default("https://query1.finance.yahoo.com"),
  /** The verified token, feed and index list. Defaults to contracts/script/config/robinhood.json. */
  UNIVERSE_FILE: z.string().default(resolve(REPO_ROOT, "contracts/script/config/robinhood.json")),
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
  const rpcUrl = e.RPC_URL ?? (network === "robinhood" ? e.ROBINHOOD_RPC_URL : network === "robinhoodTestnet" ? e.ROBINHOOD_TESTNET_RPC_URL : network === "mocks" ? e.MOCKS_RPC_URL : e.FORK_RPC_URL);
  const depPath = resolve(e.DEPLOYMENTS_DIR, `${e.CHAIN_ID}.json`);
  const deployed = existsSync(depPath);
  // Quote-only: no contracts anywhere, so the registry/router/vault addresses stay zero and every write path is
  // closed. Reads (token ratios, venue quotes, reference prices) need no deployment at all.
  const quoteOnly = e.QUOTE_ONLY || !deployed;
  if (!deployed && !e.QUOTE_ONLY && e.CHAIN_ID !== 4663) throw new Error(`no deployment for chain ${e.CHAIN_ID} at ${depPath}; run the deploy scripts first`);
  const ZERO = "0x0000000000000000000000000000000000000000";
  const deployment = deployed
    ? parseDeployment(JSON.parse(readFileSync(depPath, "utf8")))
    : parseDeployment({ chainId: e.CHAIN_ID, usdg: CHAIN_USDG[network] ?? ZERO, registry: ZERO, router: ZERO, factory: ZERO, mandate: ZERO });
  const dbUrl = e.DATABASE_URL ?? `file:./parallax-${e.CHAIN_ID}.db`;
  const dbPath = dbUrl.startsWith("file:") ? dbUrl.slice(5) : dbUrl;
  const hybrid = e.HYBRID_MARKETS ?? (network === "robinhoodTestnet" && Boolean(deployment.mocks));
  return { ...e, DATABASE_URL: dbUrl, quoteOnly, hybrid, network, rpcUrl, deployment, chain: CHAINS[network], dbPath };
}
