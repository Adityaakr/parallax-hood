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
  /**
   * Price a mock network against the live mainnet market instead of its own posted snapshot: Chainlink feeds,
   * Uniswap pool depth and the issuer's quotes are read from Robinhood Chain mainnet, and execution stays here.
   * Run it together with the mirror below, which keeps the mock venue and the registry on the same prices.
   * Without the mirror the mock venue stays on its deploy-time snapshot and every quote reads as a premium that
   * is only the age of that snapshot, which is why this is off by default.
   */
  HYBRID_MARKETS: z.coerce.boolean().default(false),
  /**
   * The mirror's signer on a mock network: the venue's owner or keeper, the registry's keeper and the owner of
   * the mock stock tokens (the deployer holds all three after `pnpm testnet:up`). With it set and
   * HYBRID_MARKETS on, the resolver copies mainnet's pool prices, Chainlink reference prices and multipliers
   * onto the mocks. Refused on any network that is not a mock deployment.
   */
  MIRROR_PRIVATE_KEY: z.string().optional(),
  MIRROR_INTERVAL_S: z.coerce.number().default(120),
  /** A price is re-posted once it has moved this far from mainnet. */
  MIRROR_THRESHOLD_BPS: z.coerce.number().default(10),
  /** And at least this often, so the registry's reference never ages out over a weekend. */
  MIRROR_HEARTBEAT_S: z.coerce.number().default(12 * 3600),
  /** Robinhood's read-only Stock Token API: issuer quotes, trading sessions, corporate actions. Empty turns it off. */
  ROBINHOOD_API_URL: z.string().default("https://api.robinhood.com/rhj"),
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
  /** Robinhood's API base, or null where it must not be called: a mock network priced from its own snapshot. */
  issuerApi: string | null;
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
  const hybrid = e.HYBRID_MARKETS && Boolean(deployment.mocks);
  // The issuer's quotes describe the mainnet tokens. A mock network on its own snapshot has nothing to do with
  // them, and the local mocks chain must stay offline for the tests.
  const issuerApi = e.ROBINHOOD_API_URL && (!deployment.mocks || hybrid) && network !== "mocks" ? e.ROBINHOOD_API_URL.replace(/\/$/, "") : null;
  return { ...e, DATABASE_URL: dbUrl, quoteOnly, hybrid, issuerApi, network, rpcUrl, deployment, chain: CHAINS[network], dbPath };
}
