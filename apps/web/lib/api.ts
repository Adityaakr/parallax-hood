"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNetwork } from "./network";
import { resolverUrl, resolverUrlOrNull, NETWORKS, type NetworkId } from "./config";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

/** One call to the resolver. Exported so a component can run a tool per turn rather than per hook. */
export async function apiRequest<T>(base: string, path: string, init?: RequestInit): Promise<T> {
  if (!base) throw new ApiError("no resolver is configured for this network yet (set NEXT_PUBLIC_RESOLVER_URLS)", -1);
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  } catch (e) {
    throw new ApiError(`resolver unreachable at ${base} (${(e as Error).message})`, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

export function useApiBase() {
  const { chainId } = useNetwork();
  return resolverUrl(chainId);
}
/** True when the selected network has a resolver URL. */
export function useResolverConfigured() {
  const { chainId } = useNetwork();
  return { configured: resolverUrlOrNull(chainId) !== null, network: NETWORKS[chainId as NetworkId]?.name ?? String(chainId), chainId };
}

export function useApi<T>(path: string | null, opts: { refetchInterval?: number; enabled?: boolean } = {}) {
  const base = useApiBase();
  return useQuery<T, ApiError>({
    queryKey: ["api", base, path],
    queryFn: () => apiRequest<T>(base, path!),
    enabled: path !== null && (opts.enabled ?? true),
    refetchInterval: opts.refetchInterval,
    retry: 1,
  });
}

export function useApiPost<TIn, TOut>(path: string | ((v: TIn) => string)) {
  const base = useApiBase();
  return useMutation<TOut, ApiError, TIn>({
    mutationFn: (v) => apiRequest<TOut>(base, typeof path === "function" ? path(v) : path, { method: "POST", body: JSON.stringify(v) }),
  });
}

// ---- shapes (subset of the resolver's responses) ----
export type Rep = {
  token: `0x${string}`; symbol: string; platform: string; ratio: string; ratioSource: "KEEPER" | "ERC8056"; ratioUpdatedAt: number;
  pendingMultiplier: { multiplier: string; effectiveAt: number } | null; attestedAt: number; buyEligible: boolean; sellEligible: boolean; active: boolean;
  binance: { tokenPrice: string | null; referencePrice: string | null; tokenToShareRatio: string | null; volume24h: string | null } | null;
};
export type Stock = {
  ticker: string; id: string; active: boolean; name?: string | null; logoUrl?: string | null; referencePrice: string | null; referenceSource: string; referenceUpdatedAt: number | null;
  market: { open: boolean; nextOpenTime: number | null; nextCloseTime: number | null; source: string; reason?: string }; representations: Rep[];
};
export type StocksResponse = { dataSource: "live" | "fixture"; binance: { mode: string; available: boolean }; stocks: Stock[] };
export type Candidate = {
  platform: string; token: string; symbol: string; ratio: string; ratioSource: string; venue: string; tokensOut: string; sharesOut: string; effectiveCostUsd: string;
  costPerShareUsd: string; premiumBps: number; pricePremiumBps?: number; slippageBps: number; attestationAgeHours: number | null; marketOpen: boolean; registryEligible: boolean; eligible: boolean; reasons: string[];
};
export type ResolveResponse = {
  underlying: string; side: "buy" | "sell"; usdAmount: string; timestamp: number; referencePrice: string; referenceSource: string; marketOpen: boolean; marketSource?: string; nextOpenTime: number | null;
  executable?: boolean; candidates: Candidate[]; chosen: { legs: unknown[]; sharesOut: string; minShares: string; usdtIn: string; split: { token: string; bps: number }[]; why: string } | null;
  status: "ok" | "queued_until_open" | "no_route"; policy: Record<string, unknown>; dataSource: "live" | "fixture"; gasUsd: string; router: `0x${string}`;
  fee?: { bps: number; usdt: string; totalUsdtIn?: string; netUsdtOut?: string; recipient: `0x${string}` | null; onInKindRedeem: false };
  tx: { to: `0x${string}`; data: `0x${string}`; value: string; gas?: string; chainId: number } | null; simulation: { ok: boolean; gasUsed?: string; error?: string } | null; quoteHash: string; approvalNeeded?: boolean;
};
/** What one address holds, priced: stock positions in underlying shares, index positions in units and NAV. */
export type WalletView = {
  address: `0x${string}`; usdt: string;
  holdings: { ticker: string; name: string | null; logoUrl: string | null; symbol: string; platform: string; token: `0x${string}`;
    tokens: string; shares: string; ratio: string; ratioSource: "KEEPER" | "ERC8056"; sellEligible: boolean;
    priceUsd: string | null; priceSource: string | null; valueUsd: string | null }[];
  baskets: { basket: `0x${string}`; symbol: string; name: string; units: string; navPerUnitUsd: string | null; valueUsd: string | null; constituents: string[] }[];
  totals: { indicesUsd: string; stocksUsd: string; usdtUsd: string; portfolioUsd: string; unpricedPositions: number };
};
export type SellResponse = {
  underlying: string; side: "sell"; status: "ok" | "no_route"; executable?: boolean; referencePrice: string; referenceSource: string;
  fee?: { bps: number; usdt: string; netUsdtOut?: string; recipient: `0x${string}` | null; onInKindRedeem: false };
  candidates: { platform: string; token: `0x${string}`; symbol: string; ratio: string; tokenAmount: string; venue: string; usdtOut: string;
    shares: string; usdPerShare: string; premiumBps: number; eligible: boolean; reasons: string[] }[];
  chosen: { representation: `0x${string}`; tokenAmount: string; usdtOut: string; minUsdtOut: string; legs: unknown[]; why: string } | null;
  router: `0x${string}`; quoteHash: string; gasUsd?: string;
  tx: { to: `0x${string}`; data: `0x${string}`; value: string; gas?: string; chainId: number } | null;
  simulation: { ok: boolean; gasUsed?: string; error?: string } | null;
};
export type Period = "d1" | "d7" | "m1" | "m6" | "y1";
/**
 * Price return of one unit per period (bps). Three sources, per constituent and per period, whichever can price
 * both ends of it: a Chainlink feed on BSC, the underlying's daily closes, or the deepest PancakeSwap v3 pool's
 * TWAP oracle. `coverage[p]` is the share of NAV priced at both ends of that period, so a partial figure carries
 * its own caveat; `unpriced` names the constituents no source reaches.
 */
export type BasketPerformance = {
  returns: Record<Period, number | null>;
  coverage: Record<Period, number>;
  coverageBps: number; covered: number; total: number; unpriced: string[]; source: string | null;
};
/** What Binance publishes about the company behind a constituent. */
export type Fundamentals = {
  high52W: number | null; low52W: number | null; marketCapUsd: number | null;
  peRatioTtm: number | null; pbRatio: number | null; dividendYield: number | null; volumeShares24h: number | null;
};
export type Allocation = {
  ticker: string; name: string | null; logoUrl: string | null; weightBps: number; valuePerUnitUsd: string;
  priceUsd: string | null; change24hBps: number | null; sparkline: number[] | null;
  priceSource: "chainlink" | "market" | "pool" | null; fundamentals: Fundamentals | null;
};
/** Index card: the curated definition priced live, deployed on this network or not. */
export type BasketCard = {
  symbol: string; name: string; deployed: boolean; address: `0x${string}` | null; thesis: string | null; navPerUnitUsd: string | null; minUsd: number;
  performance: BasketPerformance; allocation: Allocation[];
};
export type BasketSummary = BasketCard & {
  totalSupply: string; usdtBalance: string; navSource: string; backingOk: boolean;
  issuerMix: { platform: string; bps: number }[];
  constituents: {
    ticker: string; sharesPerUnit: string; weightBps?: number | null; requiredShares: string; heldShares: string; backingRatio: number | null;
    maxIssuerBps: number; capActive: boolean; singleIssuer: boolean; referencePrice: string | null; valuePerUnitUsd?: string | null;
    representations: {
      token: string; symbol: string; platform: string; tokens: string; shares: string; shareBps: number; buyEligible: boolean;
      ratio: string | null; ratioSource: string | null;
      /** USDT sitting in this token's PancakeSwap pools, and which fee tiers hold it; `route` is how a mint would fill. */
      poolUsdt?: string; poolFees?: number[]; route?: "pool" | "desk";
    }[];
  }[];
};
export type SplitRow = { symbol: string; platform: string; shares: string; sharesAfter: string };
export type Migration = { basket: string; symbol: string; ticker: string; from: string; to: string; fractionBps: number; gain: string; gainBps: number; minShareGain: string; why: string; quoteHash: string; heldSharesBefore?: string; heldSharesAfter?: string; split?: SplitRow[]; tx: { to: `0x${string}`; data: `0x${string}` } };
/** One executed `BasketVault.Migrated`, joined to the scoring record its quote hash points at. */
export type Rebalance = {
  txHash: string; blockNumber: number; timestamp: number; caller: string; quoteHash: string; ticker: string; shareGain: string;
  fromVersion: number; toVersion: number; from: string | null; to: string | null; fractionBps: number | null; gainBps: number | null;
  why: string | null; sellTokens: string | null; sharesOut: string | null; sharesIn: string | null;
  heldSharesBefore: string | null; heldSharesAfter: string | null; split: SplitRow[] | null; quoteRecord: boolean;
};
export type RebalanceTrail = { basket: string; symbol: string; minGainBps: number; version: number; executed: Rebalance[]; liveSince: { block: number; timestamp: number } | null };
export type BasketDetail = BasketSummary & { why: Record<string, string | null>; dataSource: string };
export type MintQuote = {
  status: string; basket: `0x${string}`; symbol: string; units: string; navPerUnitUsd: string | null; expectedUsdt: string; maxUsdtIn: string; problems: string[]; usdt: `0x${string}`;
  fee?: { bps: number; usdt: string; recipient: `0x${string}` | null; onInKindRedeem: false };
  breakdown: { ticker: string; neededShares: string; capActive: boolean; maxIssuerBps: number; unfilledShares: string; fills: { symbol: string; platform: string; venue: string; shares: string; usdtIn: string; costPerShareUsd: string; premiumBps: number | null }[]; candidates: { symbol: string; platform: string; costPerShareUsd: string | null; liquidity: boolean }[] }[];
  tx: { to: `0x${string}`; data: `0x${string}`; gas?: string } | null; simulation: { ok: boolean; gasUsed?: string; error?: string; approvalNeeded?: boolean } | null; quoteHash: string;
};
export type RedeemQuote = {
  kind: string; units: string; usdtOut: string; minUsdtOut: string; usdtSlice: string; fee?: { bps: number; usdt: string; recipient: `0x${string}` | null; onInKindRedeem: false }; slices: { ticker: string; symbol: string; platform: string; tokens: string; shares: string; valueUsd: string | null; sold: { venue: string; usdtOut: string } | null; deliveredInKind: boolean }[];
  tx: { to: `0x${string}`; data: `0x${string}`; gas?: string } | null; simulation: { ok: boolean; error?: string } | null; quoteHash: string;
};
export type Receipt = { tx_hash: string; log_index: number; block_number: number; emitter: string; quote_hash: string; actor: string; underlying: string; token_in: string; amount_in: string; representation: string; tokens_out: string; shares_out: string; ratio: string; attested_at: number; action: string; timestamp: number; quote: boolean };
export type Health = { ok: boolean; block: string | null; chainId: number; quoteOnly?: boolean; hybrid?: { markets: string; execution: string } | null; faucet?: boolean; binance: { mode: string; available: boolean }; deployment: { usdt: `0x${string}`; registry: `0x${string}`; router: `0x${string}`; factory: `0x${string}`; mandate: `0x${string}`; venue?: string } };
