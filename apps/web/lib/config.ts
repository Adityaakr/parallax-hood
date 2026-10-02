export type NetworkId = 56 | 97 | 31337 | 1337;
export const NETWORKS: Record<NetworkId, { name: string; short: string; explorer: string | null }> = {
  56: { name: "BSC mainnet", short: "mainnet", explorer: "https://bscscan.com" },
  97: { name: "BSC testnet · mainnet prices", short: "testnet", explorer: "https://testnet.bscscan.com" },
  31337: { name: "Local fork of BSC", short: "fork", explorer: null },
  1337: { name: "Local mocks", short: "mocks", explorer: null },
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
  const u = urls[String(chainId)] ?? (Object.keys(urls).length === 0 ? process.env.NEXT_PUBLIC_RESOLVER_URL ?? "http://127.0.0.1:4000" : null);
  return u && !/example\.com/.test(u) ? u : null;
};
export const resolverUrl = (chainId: number) => resolverUrlOrNull(chainId) ?? "";
export const DEFAULT_CHAIN: NetworkId = (Number(process.env.NEXT_PUBLIC_DEFAULT_CHAIN ?? 1337) as NetworkId) || 1337;
export const explorerTx = (chainId: number, hash: string) => (NETWORKS[chainId as NetworkId]?.explorer ? `${NETWORKS[chainId as NetworkId].explorer}/tx/${hash}` : null);
export const explorerAddr = (chainId: number, a: string) => (NETWORKS[chainId as NetworkId]?.explorer ? `${NETWORKS[chainId as NetworkId].explorer}/address/${a}` : null);
