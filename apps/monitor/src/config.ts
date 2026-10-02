import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { parseDeployment, chainIdToNetwork, CHAINS, type Deployment, type NetworkKey } from "@parallax-hood/sdk";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");

const Env = z.object({
  CHAIN_ID: z.coerce.number().default(4663),
  RPC_URL: z.string().optional(),
  ROBINHOOD_RPC_URL: z.string().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_TESTNET_RPC_URL: z.string().default("https://rpc.testnet.chain.robinhood.com"),
  FORK_RPC_URL: z.string().default("http://127.0.0.1:8647"),
  MOCKS_RPC_URL: z.string().default("http://127.0.0.1:8648"),
  DEPLOYMENTS_DIR: z.string().default(resolve(REPO_ROOT, "contracts/deployments")),
  UNIVERSE_FILE: z.string().default(resolve(REPO_ROOT, "contracts/script/config/robinhood.json")),
  MONITOR_PORT: z.coerce.number().default(4120),
  MONITOR_INTERVAL_S: z.coerce.number().default(300),
  /** Warn when a stock's direct USDG pools hold less than this many USDG in total. */
  MIN_POOL_USDG: z.coerce.number().default(50_000),
  /** With no registry deployed, judge feed age against the window the deploy script would set. */
  DEFAULT_MAX_PRICE_AGE_S: z.coerce.number().default(5 * 86_400),
});

export type MonitorConfig = z.infer<typeof Env> & {
  network: NetworkKey;
  rpcUrl: string;
  /** null where Parallax is not deployed: the token, feed and pool checks still run. */
  deployment: Deployment | null;
  universe: { ticker: string; token: `0x${string}`; feed: `0x${string}` | null }[];
  usdg: `0x${string}`;
  chain: (typeof CHAINS)[NetworkKey];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MonitorConfig {
  const e = Env.parse(env);
  const network = chainIdToNetwork(e.CHAIN_ID);
  const rpcUrl = e.RPC_URL ?? (network === "robinhood" ? e.ROBINHOOD_RPC_URL : network === "robinhoodTestnet" ? e.ROBINHOOD_TESTNET_RPC_URL : network === "mocks" ? e.MOCKS_RPC_URL : e.FORK_RPC_URL);
  const depPath = resolve(e.DEPLOYMENTS_DIR, `${e.CHAIN_ID}.json`);
  const deployment = existsSync(depPath) ? parseDeployment(JSON.parse(readFileSync(depPath, "utf8"))) : null;
  const file = JSON.parse(readFileSync(e.UNIVERSE_FILE, "utf8")) as { usdg: `0x${string}`; priceFeeds: Record<string, string>; representations: { ticker: string; symbol: string; token: `0x${string}` }[] };
  // on a network of mocks the tokens are the deployment's, and there are no feeds to watch
  const universe = file.representations.map((r) => {
    const mock = deployment?.mocks?.[r.symbol];
    return { ticker: r.ticker, token: (mock ?? r.token) as `0x${string}`, feed: mock ? null : ((file.priceFeeds[r.ticker] as `0x${string}` | undefined) ?? null) };
  });
  return { ...e, network, rpcUrl, deployment, universe, usdg: deployment?.usdg ?? file.usdg, chain: CHAINS[network] };
}
