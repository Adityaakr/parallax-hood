"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiBase, type ResolveResponse } from "./api";

export type BestRoute = { ticker: string; symbol: string; platform: string; costPerShareUsd: number; premiumBps: number; venue: string; eligible: boolean };

/** The order size the stock list quotes every ticker at, in USDG. */
export const LIST_QUOTE_USD = "500";

/**
 * The stock list's price column: for every ticker, resolve one standard order and keep the cheapest priced
 * candidate, in dollars per underlying share. Sequential on purpose (one quoter call at a time keeps a forked
 * chain responsive); results are cached for a minute.
 */
export function useBestRoutes(tickers: string[], usdAmount = LIST_QUOTE_USD) {
  const base = useApiBase();
  const key = tickers.join(",");
  const q = useQuery({
    queryKey: ["best", base, key, usdAmount],
    enabled: Boolean(base) && tickers.length > 0,
    staleTime: 60_000,
    retry: 0,
    queryFn: async (): Promise<Record<string, BestRoute>> => {
      const out: Record<string, BestRoute> = {};
      for (const ticker of tickers) {
        try {
          const res = await fetch(`${base}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, side: "buy", usdAmount, policy: { allowClosedMarket: true, maxClosedMarketPremiumBps: 10_000, maxPremiumBps: 10_000 } }) });
          if (!res.ok) continue;
          const r = (await res.json()) as ResolveResponse;
          const best = r.candidates.filter((c) => c.costPerShareUsd !== "0").sort((a, b) => Number(a.costPerShareUsd) - Number(b.costPerShareUsd))[0];
          if (!best) continue;
          out[ticker] = { ticker, symbol: best.symbol, platform: best.platform, costPerShareUsd: Number(best.costPerShareUsd), premiumBps: best.premiumBps, venue: best.venue, eligible: best.eligible };
        } catch {
          // a ticker that cannot be quoted right now simply has no price in the table
        }
      }
      return out;
    },
  });
  return { best: q.data ?? {}, loading: q.isLoading, error: q.error as Error | null };
}
