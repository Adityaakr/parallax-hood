"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useNetwork } from "./network";
import { resolverUrl, resolverUrlOrNull, NETWORKS, type NetworkId, type NetworkKind } from "./config";

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

/**
 * True when a quote mutation's result answers exactly these inputs: nothing in flight, and the last request was
 * made with them. Quotes are re-requested a moment after an input changes, so for that moment the result on
 * screen still belongs to the old inputs; a transaction must never be offered for signing from it.
 * `inputs` has to be built the way the request was, key for key.
 */
export function quoteIsCurrent(m: { isPending: boolean; data: unknown; variables: unknown }, inputs: unknown): boolean {
  return !m.isPending && m.data !== undefined && JSON.stringify(m.variables) === JSON.stringify(inputs);
}

// ---- shapes (subset of the resolver's responses) ----
// Every field named `usdg…` is a raw 6-decimal integer string. Shares, ratios, units and stock-token amounts are 1e18-scaled.

/**
 * Which network the resolver serves, what on it is a stand-in and what is read live from the real market.
 * `mocked` is empty on mainnet and on a fork of it. `live` is empty on a mock network priced from its own
 * snapshot, and `liveFrom` names the network the live figures come from when that is not this one.
 */
export type NetworkLabel = { name: string; kind: NetworkKind; chainId: number; explorer: string | null; mocked: string[]; live?: string[]; liveFrom?: string | null };
type Session = { whole: boolean; fractional: boolean };
/** What the issuer says about a stock, read by the resolver from Robinhood's Stock Token API. Prices are decimal USD strings. */
export type Issuer = {
  source: string; token: `0x${string}`; status: string | null; isin: string | null; multiplier: string;
  pendingMultiplier: { multiplier: string; effectiveAt: number | null } | null;
  sessions: { market: Session; extended: Session; overnight: Session } | null;
  /** bid, ask and mid are per underlying share; null when the quote route did not answer */
  quote: { bid: string; ask: string; mid: string; tokenBid: string | null; tokenAsk: string | null; dailyHigh: string | null; dailyLow: string | null; dailyVolume: string | null; halted: boolean; generatedAt: number } | null;
};
export type CorporateAction = { id: string; type: string; status: string; processDate: string | null; symbol: string; summary: string; details: Record<string, string> };
/** `actions` is null when the issuer's API is off on this network or not answering; an empty list means it answered with none. */
export type CorporateActions = { ticker: string; source: string | null; actions: CorporateAction[] | null };
/** The mirror that keeps a test network on mainnet's prices: who signs, and when every stock last matched. */
export type MirrorBrief = { operator: `0x${string}` | null; intervalS: number; thresholdBps: number; lastRunAt: number | null; lastInSyncAt: number | null; lastWriteAt: number | null; writes: number; error: string | null };
export type Rep = {
  token: `0x${string}`; symbol: string; platform: string; ratio: string; ratioSource: "KEEPER" | "ERC8056"; ratioUpdatedAt: number;
  pendingMultiplier: { multiplier: string; effectiveAt: number } | null; buyEligible: boolean; sellEligible: boolean; active: boolean;
  /** raw USDG sitting in this token's direct Uniswap v3 pools, and the fee tiers that hold it */
  poolUsdg: string; poolFees: number[];
};
export type Stock = {
  ticker: string; id: string; active: boolean; name?: string | null; logoUrl?: string | null; referencePrice: string | null; referenceSource: string; referenceUpdatedAt: number | null;
  market: { open: boolean; nextOpenTime: number | null; nextCloseTime: number | null; source: string; reason?: string }; issuer?: Issuer | null; representations: Rep[];
};
export type StocksResponse = { dataSource: "live" | "fixture"; stocks: Stock[]; hybrid?: { markets: string; execution: string } | null };
export type Candidate = {
  platform: string; token: string; symbol: string; ratio: string; ratioSource: string; venue: string; tokensOut: string; sharesOut: string; effectiveCostUsd: string;
  costPerShareUsd: string; premiumBps: number; pricePremiumBps?: number; slippageBps: number; priceImpactBps?: number; marketOpen: boolean; registryEligible: boolean; eligible: boolean; reasons: string[];
};
export type ResolveResponse = {
  underlying: string; side: "buy" | "sell"; usdAmount: string; timestamp: number; referencePrice: string; referenceSource: string; marketOpen: boolean; marketSource?: string; nextOpenTime: number | null;
  executable?: boolean; candidates: Candidate[]; chosen: { legs: unknown[]; sharesOut: string; minShares: string; usdgIn: string; split: { token: string; bps: number }[]; why: string } | null;
  status: "ok" | "queued_until_open" | "no_route"; policy: Record<string, unknown>; dataSource: "live" | "fixture"; gasUsd: string; router: `0x${string}`;
  fee?: { bps: number; usdg: string; totalUsdgIn?: string; netUsdgOut?: string; recipient: `0x${string}` | null; onInKindRedeem: false };
  tx: { to: `0x${string}`; data: `0x${string}`; value: string; gas?: string; chainId: number } | null; simulation: { ok: boolean; gasUsed?: string; error?: string } | null; quoteHash: string; approvalNeeded?: boolean;
};
/** What one address holds, priced: stock positions in underlying shares, index positions in units and NAV. */
export type WalletView = {
  address: `0x${string}`; usdg: string;
  holdings: { ticker: string; name: string | null; logoUrl: string | null; symbol: string; platform: string; token: `0x${string}`;
    tokens: string; shares: string; ratio: string; ratioSource: "KEEPER" | "ERC8056"; sellEligible: boolean;
    priceUsd: string | null; priceSource: string | null; valueUsd: string | null }[];
  baskets: { basket: `0x${string}`; symbol: string; name: string; units: string; navPerUnitUsd: string | null; valueUsd: string | null; constituents: string[] }[];
  totals: { indicesUsd: string; stocksUsd: string; usdgUsd: string; portfolioUsd: string; unpricedPositions: number };
};
export type SellResponse = {
  underlying: string; side: "sell"; status: "ok" | "no_route"; executable?: boolean; referencePrice: string; referenceSource: string;
  fee?: { bps: number; usdg: string; netUsdgOut?: string; recipient: `0x${string}` | null; onInKindRedeem: false };
  candidates: { platform: string; token: `0x${string}`; symbol: string; ratio: string; tokenAmount: string; venue: string; usdgOut: string;
    shares: string; usdPerShare: string; premiumBps: number; eligible: boolean; reasons: string[] }[];
  chosen: { representation: `0x${string}`; tokenAmount: string; usdgOut: string; minUsdgOut: string; legs: unknown[]; why: string } | null;
  router: `0x${string}`; quoteHash: string; gasUsd?: string;
  tx: { to: `0x${string}`; data: `0x${string}`; value: string; gas?: string; chainId: number } | null;
  simulation: { ok: boolean; gasUsed?: string; error?: string } | null;
};
export type Period = "d1" | "d7" | "m1" | "m6" | "y1";
/**
 * Price return of one unit per period (bps), from whichever source can price both ends of it for a constituent;
 * on Robinhood Chain that is the stock's Chainlink feed. `coverage[p]` is the share of NAV priced at both ends of
 * that period, so a partial figure carries its own caveat; `unpriced` names the constituents no source reaches.
 */
export type BasketPerformance = {
  returns: Record<Period, number | null>;
  coverage: Record<Period, number>;
  coverageBps: number; covered: number; total: number; unpriced: string[]; source: string | null;
};
export type Allocation = {
  ticker: string; name: string | null; logoUrl: string | null; weightBps: number; valuePerUnitUsd: string;
  priceUsd: string | null; change24hBps: number | null; sparkline: number[] | null;
  priceSource: "chainlink" | "market" | "pool" | null;
};
/** Index card: the curated definition priced live, deployed on this network or not. */
export type BasketCard = {
  symbol: string; name: string; deployed: boolean; address: `0x${string}` | null; thesis: string | null; navPerUnitUsd: string | null; minUsd: number;
  performance: BasketPerformance; allocation: Allocation[];
};
export type BasketSummary = BasketCard & {
  totalSupply: string; usdgBalance: string; navSource: string; backingOk: boolean;
  issuerMix: { platform: string; bps: number }[];
  constituents: {
    ticker: string; sharesPerUnit: string; weightBps?: number | null; requiredShares: string; heldShares: string; backingRatio: number | null;
    maxIssuerBps: number; capActive: boolean; singleIssuer: boolean; referencePrice: string | null; valuePerUnitUsd?: string | null;
    representations: {
      token: string; symbol: string; platform: string; tokens: string; shares: string; shareBps: number; buyEligible: boolean;
      ratio: string | null; ratioSource: string | null;
      /** raw USDG in this token's direct Uniswap v3 pools, and which fee tiers hold it; `route` is how a mint would fill */
      poolUsdg?: string; poolFees?: number[]; route?: "pool" | "none";
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
  status: string; basket: `0x${string}`; symbol: string; units: string; navPerUnitUsd: string | null; expectedUsdg: string; maxUsdgIn: string; problems: string[]; usdg: `0x${string}`;
  fee?: { bps: number; usdg: string; recipient: `0x${string}` | null; onInKindRedeem: false };
  breakdown: { ticker: string; neededShares: string; capActive: boolean; maxIssuerBps: number; unfilledShares: string; fills: { symbol: string; platform: string; venue: string; shares: string; usdgIn: string; costPerShareUsd: string; premiumBps: number | null }[]; candidates: { symbol: string; platform: string; costPerShareUsd: string | null; liquidity: boolean }[] }[];
  tx: { to: `0x${string}`; data: `0x${string}`; gas?: string } | null; simulation: { ok: boolean; gasUsed?: string; error?: string; approvalNeeded?: boolean } | null; quoteHash: string;
};
export type RedeemQuote = {
  kind: string; units: string; usdgOut: string; minUsdgOut: string; usdgSlice: string; fee?: { bps: number; usdg: string; recipient: `0x${string}` | null; onInKindRedeem: false }; slices: { ticker: string; symbol: string; platform: string; tokens: string; shares: string; valueUsd: string | null; sold: { venue: string; usdgOut: string } | null; deliveredInKind: boolean }[];
  tx: { to: `0x${string}`; data: `0x${string}`; gas?: string } | null; simulation: { ok: boolean; error?: string } | null; quoteHash: string;
};
/** `amount_in` is in the units of `token_in`: raw USDG (6 decimals) on a buy or a mint, stock tokens (18) on a sell. */
export type Receipt = { tx_hash: string; log_index: number; block_number: number; emitter: string; quote_hash: string; actor: string; underlying: string; token_in: string; amount_in: string; representation: string; tokens_out: string; shares_out: string; ratio: string; action: string; timestamp: number; quote: boolean };
export type Health = { ok: boolean; block: string | null; chainId: number; label: NetworkLabel; quoteOnly?: boolean; hybrid?: { markets: string; execution: string } | null; mirror?: MirrorBrief | null; faucet?: boolean; deployment: { usdg: `0x${string}`; registry: `0x${string}`; router: `0x${string}`; factory: `0x${string}`; mandate: `0x${string}`; venue?: string } };

/**
 * The network as the resolver describes it, which is what the shell prints on every screen. When the resolver
 * does not answer, the label falls back to lib/config.ts for the selected chain and says that it did.
 */
export function useNetworkLabel(): { label: NetworkLabel; fromResolver: boolean; health: Health | undefined } {
  const { chainId } = useNetwork();
  const health = useApi<Health>("/health", { refetchInterval: 60_000 });
  const fromResolver = Boolean(health.data?.label);
  const local = NETWORKS[chainId as NetworkId];
  const label: NetworkLabel = health.data?.label ?? { name: local.name, kind: local.kind, chainId, explorer: local.explorer, mocked: local.mocked };
  return { label, fromResolver, health: health.data };
}
