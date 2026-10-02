"use client";
import { useQuery } from "@tanstack/react-query";
import { useApiBase, type ResolveResponse } from "./api";

/** Order sizes (USDG) for the depth curve: cost per share of every representation as the order grows. */
export const DEPTH_SIZES = [100, 250, 500, 1000, 2500, 5000] as const;

export type DepthPoint = { usd: number; candidates: { symbol: string; platform: string; costPerShareUsd: number | null; premiumBps: number | null; eligible: boolean }[]; referencePrice: number | null };

/**
 * Resolves the same order at several sizes, one after another (a forked anvil wedges under parallel quoter
 * bursts), so the chart shows how each route's cost per share moves with size.
 */
export function useDepth(ticker: string, policy: Record<string, unknown>, enabled = true) {
  const base = useApiBase();
  const q = useQuery({
    queryKey: ["depth", base, ticker, policy],
    enabled,
    staleTime: 60_000,
    retry: 0,
    queryFn: async (): Promise<DepthPoint[]> => {
      const out: DepthPoint[] = [];
      for (const usd of DEPTH_SIZES) {
        const res = await fetch(`${base}/resolve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, usdAmount: String(usd), policy }) });
        const r = (await res.json()) as ResolveResponse & { error?: string };
        if (!res.ok) throw new Error(r.error ?? `HTTP ${res.status}`);
        out.push({
          usd,
          referencePrice: r.referencePrice ? Number(r.referencePrice) : null,
          candidates: r.candidates.map((c) => ({ symbol: c.symbol, platform: c.platform, costPerShareUsd: c.costPerShareUsd === "0" ? null : Number(c.costPerShareUsd), premiumBps: c.costPerShareUsd === "0" ? null : c.premiumBps, eligible: c.eligible })),
        });
      }
      return out;
    },
  });
  return { points: q.data ?? [], loading: q.isLoading, error: q.error as Error | null };
}
