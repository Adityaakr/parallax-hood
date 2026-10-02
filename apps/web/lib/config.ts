import { CHAINS, NETWORK_LABEL, chainIdToNetwork } from "@parallax-hood/sdk";

export type NetworkId = 4663 | 46630 | 31337 | 1337;
export type NetworkKind = "mainnet" | "testnet" | "local";
export const NETWORK_IDS: readonly NetworkId[] = [4663, 46630, 31337, 1337];

/** What stands in for the real thing on a network whose tokens and venue are mocks, as the resolver words it. */
const ALL_MOCKED = ["stock tokens", "USDG", "swap venue", "reference prices"];

/**
 * Names, kinds and explorers come from the SDK's chain definitions, so the web app cannot drift from them.
 * `mocked` is only the fallback shown when the resolver is unreachable: the resolver's own `/health` label is
 * what the shell prints when it answers.
 */
const network = (id: NetworkId, short: string, mocked: string[]) => {
  const key = chainIdToNetwork(id);
  return { name: NETWORK_LABEL[key].name, kind: NETWORK_LABEL[key].kind as NetworkKind, short, explorer: CHAINS[key].blockExplorers?.default.url ?? null, mocked };
};
export const NETWORKS: Record<NetworkId, { name: string; kind: NetworkKind; short: string; explorer: string | null; mocked: string[] }> = {
  4663: network(4663, "mainnet", []),
  46630: network(46630, "testnet", ALL_MOCKED),
  31337: network(31337, "fork", []),
  1337: network(1337, "mocks", ALL_MOCKED),
};

const urls: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.NEXT_PUBLIC_RESOLVER_URLS ?? "{}");
  } catch {
    return {};
  }
})();
/** Resolver base URL for a chain, or null when none is configured (the UI then says so instead of guessing). */
export const resolverUrlOrNull = (chainId: number): string | null => {
  const u = urls[String(chainId)] ?? (Object.keys(urls).length === 0 ? process.env.NEXT_PUBLIC_RESOLVER_URL ?? "http://127.0.0.1:4100" : null);
  return u && !/example\.com/.test(u) ? u : null;
};
export const resolverUrl = (chainId: number) => resolverUrlOrNull(chainId) ?? "";
const envChain = Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN ?? 1337);
export const DEFAULT_CHAIN: NetworkId = (NETWORK_IDS as readonly number[]).includes(envChain) ? (envChain as NetworkId) : 1337;
/** Blockscout-style explorer links; null on a local chain, which has no explorer. */
export const explorerTx = (chainId: number, hash: string) => (NETWORKS[chainId as NetworkId]?.explorer ? `${NETWORKS[chainId as NetworkId].explorer}/tx/${hash}` : null);
export const explorerAddr = (chainId: number, a: string) => (NETWORKS[chainId as NetworkId]?.explorer ? `${NETWORKS[chainId as NetworkId].explorer}/address/${a}` : null);
