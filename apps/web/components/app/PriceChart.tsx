"use client";
/*
 * What the share itself has done, over a period you pick.
 *
 * The other chart on this page answers "what does a share cost me at this order size"; this one answers "what
 * is the share worth, and what has it done", which is the question anyone opens a stock page with. The source
 * is named because it differs by name: BSC has Chainlink feeds for the Magnificent 7 and nothing else, so
 * everything else is priced from the underlying's daily closes. A ticker no source reaches says so.
 */
import { useMemo, useState } from "react";
import { useApi } from "@/lib/api";
import { usd } from "@/lib/format";
import { Loading } from "@/components/ui";

type History = { ticker: string; source: string | null; series: { t: number; price: string }[]; returns: Record<string, number | null> | null };
const RANGES: { key: string; label: string; days: number; points: number }[] = [
  { key: "d1", label: "1D", days: 1, points: 24 },
  { key: "d7", label: "7D", days: 7, points: 28 },
  { key: "m1", label: "1M", days: 30, points: 30 },
  { key: "m6", label: "6M", days: 182, points: 40 },
  { key: "y1", label: "1Y", days: 365, points: 52 },
];

export function PriceChart({ ticker }: { ticker: string }) {
  const [range, setRange] = useState(RANGES[4]!);
  const h = useApi<History>(`/stocks/${ticker}/history?days=${range.days}&points=${range.points}`, { refetchInterval: 120_000 });
  const pts = useMemo(() => (h.data?.series ?? []).map((p) => ({ t: p.t, v: Number(p.price) / 1e18 })).filter((p) => p.v > 0), [h.data]);
  const ret = h.data?.returns?.[range.key] ?? null;

  const W = 900, H = 300, L = 8, R = 8, T = 14, B = 26;
  const vals = pts.map((p) => p.v);
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 1;
  const pad = (max - min || max || 1) * 0.12;
  const y = (v: number) => T + (H - T - B) * (1 - (v - (min - pad)) / (max - min + 2 * pad));
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, pts.length - 1);
  const up = ret === null ? null : ret >= 0;
  const stroke = up === null ? "var(--ink)" : up ? "var(--good)" : "var(--bad)";
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.v)}`).join(" ");
  const area = pts.length ? `${line} L${x(pts.length - 1)},${H - B} L${x(0)},${H - B} Z` : "";
  const day = (t: number) => new Date(t * 1000).toLocaleDateString("en-GB", range.days <= 1 ? { hour: "2-digit", minute: "2-digit" } : { day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          {ret !== null && <span className="num" style={{ fontSize: 22, color: stroke }}>{ret >= 0 ? "+" : ""}{(ret / 100).toFixed(2)}%</span>}
          <span className="body-xs muted">{range.label} · {h.data?.source ?? (h.isLoading ? "loading" : "no price history for this name")}</span>
        </div>
        <div className="seg">
          {RANGES.map((r) => <button key={r.key} data-on={r.key === range.key} onClick={() => setRange(r)}>{r.label}</button>)}
        </div>
      </div>

      {h.isLoading && pts.length === 0 ? (
        <Loading rows={4} />
      ) : pts.length < 2 ? (
        <div className="body-sm muted py-8">
          No source reaches back {range.label} for {ticker}. Chainlink covers the Magnificent 7 on BSC; everything
          else is priced from the underlying&apos;s daily closes, which a name listed this year may not have.
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${ticker} price over ${range.label}`}>
          <defs>
            <linearGradient id={`g-${ticker}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity="0.16" />
              <stop offset="100%" stopColor={stroke} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((f) => {
            const v = min - pad + (max - min + 2 * pad) * (1 - f);
            return (
              <g key={f}>
                <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-2)" strokeDasharray="2 5" />
                <text x={L + 2} y={y(v) - 6} fontSize="12" fill="#8f9194">{usd(v)}</text>
              </g>
            );
          })}
          <path d={area} fill={`url(#g-${ticker})`} />
          <path d={line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          <text x={L} y={H - 6} fontSize="12" fill="#8f9194">{day(pts[0]!.t)}</text>
          <text x={W - R} y={H - 6} fontSize="12" fill="#8f9194" textAnchor="end">{day(pts[pts.length - 1]!.t)}</text>
        </svg>
      )}
    </div>
  );
}
