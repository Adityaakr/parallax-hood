"use client";
/* Pieces shared by the index list and index detail: return figures, the period switch, the allocation ring,
   sparklines and the constituent logo cluster. Everything is drawn from resolver data; nothing here estimates. */
import { useId, useState } from "react";
import type { Allocation, BasketPerformance, Period } from "@/lib/api";
import { StockLogo } from "./StockLogo";

export const PERIOD_LABELS: Record<Period, string> = { d1: "1D", d7: "7D", m1: "1M", m6: "6M", y1: "1Y" };
export const PERIOD_LONG: Record<Period, string> = { d1: "1-day", d7: "7-day", m1: "1-month", m6: "6-month", y1: "1-year" };
export const PERIODS: Period[] = ["d1", "d7", "m1", "m6", "y1"];

/* one colour per slice, the brand first then inks and sands so seven slices stay tellable apart */
export const SLICE_COLORS = ["#F24100", "#1A1A1A", "#8D8781", "#F7A57A", "#4A4A4A", "#C9C2B8", "#B45309"];

export const pct = (bps: number | null | undefined, digits = 2) => (bps === null || bps === undefined ? "n/a" : `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(digits)}%`);
export const signColor = (bps: number | null | undefined) => (bps === null || bps === undefined ? "var(--muted)" : bps < 0 ? "var(--bad)" : "var(--good)");

/** A return figure in the numeral face, coloured by sign. */
export function ReturnValue({ bps, className = "" }: { bps: number | null | undefined; className?: string }) {
  return <span className={`num ${className}`} style={{ color: signColor(bps) }}>{pct(bps)}</span>;
}

export function PeriodSeg({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="seg" role="tablist" aria-label="Return period">
      {PERIODS.map((p) => (
        <button key={p} role="tab" aria-selected={value === p} data-on={value === p} onClick={() => onChange(p)}>{PERIOD_LABELS[p]}</button>
      ))}
    </div>
  );
}

/** What the figure above it rests on: which sources priced it, over how much of the index, and what is missing. */
export function CoverageNote({ perf, period }: { perf: BasketPerformance; period?: Period }) {
  const cov = period ? perf.coverage[period] : perf.coverageBps;
  if (perf.covered === 0) {
    return (
      <span className="body-xs muted">
        No price history for any of the {perf.total} constituents on this network, so no return can be computed.
        The NAV per unit is today&apos;s reference prices.
      </span>
    );
  }
  if (cov >= 10_000) return <span className="body-xs muted">{perf.source}.</span>;
  if (cov === 0) {
    return (
      <span className="body-xs muted">
        No price source reaches back this far for any constituent.
      </span>
    );
  }
  return (
    <span className="body-xs muted">
      Covers {(cov / 100).toFixed(0)}% of NAV: the rest has no price history this far back
      {perf.unpriced.length > 0 ? `, and there is none at all for ${perf.unpriced.join(", ")}` : ""}. {perf.source}.
    </span>
  );
}

/** Overlapping company marks, the way the index cards introduce their constituents. */
export function LogoCluster({ items, size = 28, max = 7 }: { items: Pick<Allocation, "ticker" | "logoUrl">[]; size?: number; max?: number }) {
  const shown = items.slice(0, max);
  return (
    <div className="flex items-center">
      {shown.map((a, i) => (
        <span key={a.ticker} className="inline-flex rounded-full" style={{ marginLeft: i === 0 ? 0 : -Math.round(size * 0.3), zIndex: shown.length - i, boxShadow: "0 0 0 2px var(--color-card-1)" }} title={a.ticker}>
          <StockLogo ticker={a.ticker} src={a.logoUrl} size={size} />
        </span>
      ))}
      {items.length > max && <span className="body-xs muted ml-2">+{items.length - max}</span>}
    </div>
  );
}

/** 7-day price path as a plain polyline; flat segments are real (the feed does not move while the market is closed). */
export function Sparkline({ points, width = 120, height = 36, color }: { points: number[] | null; width?: number; height?: number; color?: string }) {
  if (!points || points.length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden />;
  const min = Math.min(...points), max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - 3 - ((p - min) / span) * (height - 6)).toFixed(1)}`).join(" ");
  const stroke = color ?? (points[points.length - 1]! >= points[0]! ? "var(--good)" : "var(--bad)");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Allocation ring with a legend. Hovering either side lights the same slice; the centre shows the hovered
 * constituent or the total when nothing is.
 */
export function AllocationRing({ allocation, size = 220, center }: { allocation: Allocation[]; size?: number; center: { value: string; label: string } }) {
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const r = size / 2 - 14, cx = size / 2, cy = size / 2, C = 2 * Math.PI * r;
  const total = allocation.reduce((a, x) => a + x.weightBps, 0) || 1;
  let acc = 0;
  const slices = allocation.map((a, i) => {
    const frac = a.weightBps / total;
    const s = { i, a, offset: acc, frac };
    acc += frac;
    return s;
  });
  const focus = hover === null ? null : allocation[hover]!;
  return (
    <div className="flex flex-wrap items-center gap-8">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={id}>
          <title id={id}>Allocation by value per unit</title>
          <g transform={`rotate(-90 ${cx} ${cy})`}>
            {slices.map((s) => (
              <circle
                key={s.a.ticker} cx={cx} cy={cy} r={r} fill="none" stroke={SLICE_COLORS[s.i % SLICE_COLORS.length]}
                strokeWidth={hover === s.i ? 26 : 20} strokeDasharray={`${Math.max(0, s.frac * C - 2)} ${C}`} strokeDashoffset={-s.offset * C}
                style={{ transition: "stroke-width .4s var(--ease), opacity .4s var(--ease)", opacity: hover === null || hover === s.i ? 1 : 0.35, cursor: "pointer" }}
                onMouseEnter={() => setHover(s.i)} onMouseLeave={() => setHover(null)}
              />
            ))}
          </g>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
          <div className="num" style={{ fontFamily: "var(--font-price)", fontSize: 28, lineHeight: "32px", letterSpacing: "-1px", fontWeight: 500 }}>{focus ? `${(focus.weightBps / 100).toFixed(1)}%` : center.value}</div>
          <div className="eyebrow mt-2" style={{ lineHeight: "14px" }}>{focus ? focus.ticker : center.label}</div>
        </div>
      </div>
      <ul className="flex-1 min-w-[220px] flex flex-col">
        {allocation.map((a, i) => (
          <li
            key={a.ticker} className="flex items-center gap-3 py-[10px] body-sm" style={{ borderBottom: i < allocation.length - 1 ? "var(--dash)" : undefined, opacity: hover === null || hover === i ? 1 : 0.45, transition: "opacity .4s var(--ease)", cursor: "default" }}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
          >
            <span className="inline-block w-[10px] h-[10px] rounded-[3px] shrink-0" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
            <StockLogo ticker={a.ticker} src={a.logoUrl} size={22} />
            <span className="font-medium w-14">{a.ticker}</span>
            <span className="muted flex-1 truncate">{a.name ?? ""}</span>
            <span className="num w-14 text-right">{(a.weightBps / 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
