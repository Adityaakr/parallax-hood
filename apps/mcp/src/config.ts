import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Hex } from "viem";
import { parseDeployment, chainIdToNetwork, ROBINHOOD_ADDRESSES } from "@parallax-hood/sdk";
import type { McpConfig } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, "../../..");

const Env = z.object({
  CHAIN_ID: z.coerce.number().default(31337),
  RPC_URL: z.string().optional(),
  ROBINHOOD_RPC_URL: z.string().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_TESTNET_RPC_URL: z.string().default("https://rpc.testnet.chain.robinhood.com"),
  FORK_RPC_URL: z.string().default("http://127.0.0.1:8647"),
  MOCKS_RPC_URL: z.string().default("http://127.0.0.1:8648"),
  RESOLVER_URL: z.string().default("http://127.0.0.1:4100"),
  AGENT_PRIVATE_KEY: z.string().optional(),
  DEPLOYMENTS_DIR: z.string().default(resolve(REPO_ROOT, "contracts/deployments")),
  MCP_PORT: z.coerce.number().default(4110),
  /** Where the HTTP transport listens. Loopback by default: the endpoint has no authentication and the process
   *  may hold the agent key, so exposing it is a decision to make deliberately, behind something that does. */
  MCP_HOST: z.string().default("127.0.0.1"),
  MCP_MAX_PREMIUM_BPS: z.coerce.number().default(100),
  MCP_MAX_CLOSED_MARKET_PREMIUM_BPS: z.coerce.number().default(50),
  MCP_MAX_SLIPPAGE_BPS: z.coerce.number().default(50),
  MCP_PREFER_PLATFORMS: z.string().default(""),
  MCP_EXCLUDE_PLATFORMS: z.string().default(""),
});

export function loadMcpConfig(env: NodeJS.ProcessEnv = process.env): McpConfig & { port: number; host: string } {
  const e = Env.parse(env);
  const network = chainIdToNetwork(e.CHAIN_ID);
  const rpcUrl = e.RPC_URL ?? (network === "robinhood" ? e.ROBINHOOD_RPC_URL : network === "robinhoodTestnet" ? e.ROBINHOOD_TESTNET_RPC_URL : network === "mocks" ? e.MOCKS_RPC_URL : e.FORK_RPC_URL);
  const depPath = resolve(e.DEPLOYMENTS_DIR, `${e.CHAIN_ID}.json`);
  // mainnet before the contracts are deployed: quote-only, like the resolver. Reads and quotes work, the
  // mandate/router/vault addresses are zero and every execution path refuses
  const ZERO = "0x0000000000000000000000000000000000000000";
  if (!existsSync(depPath) && e.CHAIN_ID !== 4663) throw new Error(`no deployment for chain ${e.CHAIN_ID} at ${depPath}`);
  const d = existsSync(depPath)
    ? parseDeployment(JSON.parse(readFileSync(depPath, "utf8")))
    : parseDeployment({ chainId: 4663, usdg: ROBINHOOD_ADDRESSES.usdg, registry: ZERO, router: ZERO, factory: ZERO, mandate: ZERO });
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  return {
    resolverUrl: e.RESOLVER_URL, chainId: e.CHAIN_ID, rpcUrl, mandateAddress: d.mandate, routerAddress: d.router, usdg: d.usdg,
    agentPrivateKey: e.AGENT_PRIVATE_KEY as Hex | undefined, port: e.MCP_PORT, host: e.MCP_HOST,
    softPolicy: { maxPremiumBps: e.MCP_MAX_PREMIUM_BPS, maxClosedMarketPremiumBps: e.MCP_MAX_CLOSED_MARKET_PREMIUM_BPS, maxSlippageBps: e.MCP_MAX_SLIPPAGE_BPS, preferPlatforms: list(e.MCP_PREFER_PLATFORMS), excludePlatforms: list(e.MCP_EXCLUDE_PLATFORMS) },
  };
}
