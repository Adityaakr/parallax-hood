"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiBase, type ResolveResponse } from "./api";

export type BestRoute = { ticker: string; symbol: string; platform: string; costPerShareUsd: number; premiumBps: number; venue: string; alternatives: number; spreadBps: number | null };

/**
 * The search engine's price column: for every ticker, resolve one standard order and keep the winning
 * representation plus how far the next-best issuer sat. Sequential on purpose (one quoter call at a time keeps a
 * forked chain responsive); results are cached for a minute.
 */
export function useBestRoutes(tickers: string[], usdAmount = "500") {
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
          const res = await fetch(`${base}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, usdAmount, policy: { allowClosedMarket: true, maxClosedMarketPremiumBps: 10_000, maxPremiumBps: 10_000 } }) });
          if (!res.ok) continue;
          const r = (await res.json()) as ResolveResponse;
          const priced = r.candidates.filter((c) => c.costPerShareUsd !== "0").sort((a, b) => Number(a.costPerShareUsd) - Number(b.costPerShareUsd));
          const best = priced[0];
          if (!best) continue;
          const second = priced[1];
          out[ticker] = {
            ticker,
            symbol: best.symbol,
            platform: best.platform,
            costPerShareUsd: Number(best.costPerShareUsd),
            premiumBps: best.premiumBps,
            venue: best.venue,
            alternatives: r.candidates.length,
            spreadBps: second ? second.premiumBps - best.premiumBps : null,
          };
        } catch {
          // a ticker that cannot be quoted right now simply has no price in the table
        }
      }
      return out;
    },
  });
  return { best: q.data ?? {}, loading: q.isLoading, error: q.error as Error | null };
}
