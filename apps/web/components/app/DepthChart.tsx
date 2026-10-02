"use client";
/* Line chart in the template's style: thin dark line for the chosen route, grey lines for the others, dotted
   crosshair, hover card with the values at that order size. Pure SVG, no chart library. */
import { useMemo, useState } from "react";
import type { DepthPoint } from "@/lib/depth";

const COLORS = ["var(--ink)", "#b9b3ab", "var(--muted-2)", "var(--line-3)"];

export function DepthChart({ points, metric, chosen }: { points: DepthPoint[]; metric: "cost" | "premium"; chosen?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 900, H = 380, L = 84, R = 18, T = 16, B = 34;
  const series = useMemo(() => {
    const names = Array.from(new Set(points.flatMap((p) => p.candidates.map((c) => c.symbol))));
    return names.map((name) => ({ name, values: points.map((p) => { const c = p.candidates.find((x) => x.symbol === name); return c ? (metric === "cost" ? c.costPerShareUsd : c.premiumBps) : null; }) }));
  }, [points, metric]);
  const ref = points[0]?.referencePrice ?? null;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  if (metric === "cost" && ref) all.push(ref);
  if (metric === "premium") all.push(0);
  const min = all.length ? Math.min(...all) : 0, max = all.length ? Math.max(...all) : 1;
  const pad = (max - min || 1) * 0.15;
  const y = (v: number) => T + (H - T - B) * (1 - (v - (min - pad)) / (max - min + 2 * pad));
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, points.length - 1);
  const ticks = 5;
  /* compact money on the axis: a four-figure price at twelve pixels does not fit a gutter, it spills out of it */
  const fmt = (v: number) =>
    metric === "cost"
      ? v >= 1000 ? `$${(v / 1000).toFixed(v >= 10_000 ? 0 : 2)}k` : `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 })}`
      : `${v.toFixed(0)} bps`;
  const path = (vals: (number | null)[]) => {
    let d = ""; let pen = false;
    vals.forEach((v, i) => { if (v === null) { pen = false; return; } d += `${pen ? "L" : "M"}${x(i)},${y(v)} `; pen = true; });
    return d;
  };
  // order: others first, chosen on top
  const ordered = [...series].sort((a, b) => (a.name === chosen ? 1 : 0) - (b.name === chosen ? 1 : 0));
  const hv = hover === null ? null : points[hover];
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const i = Math.round(((px - L) / (W - L - R)) * (points.length - 1)); setHover(Math.max(0, Math.min(points.length - 1, i))); }}>
        {Array.from({ length: ticks }).map((_, i) => { const v = min - pad + ((max - min + 2 * pad) * i) / (ticks - 1); return (
          <g key={i}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line-2)" strokeDasharray="2 4" />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" fontSize="12" fill="#8f9194">{fmt(v)}</text>
          </g>
        ); })}
        {metric === "cost" && ref && <line x1={L} x2={W - R} y1={y(ref)} y2={y(ref)} stroke="var(--brand)" strokeOpacity=".5" strokeDasharray="4 4" />}
        {points.map((p, i) => <text key={p.usd} x={x(i)} y={H - 10} textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"} fontSize="12" fill="#8f9194">${p.usd.toLocaleString()}</text>)}
        {ordered.map((s, i) => (
          <path key={s.name} d={path(s.values)} fill="none" stroke={s.name === chosen ? COLORS[0] : COLORS[1 + (i % 3)]} strokeWidth={s.name === chosen ? 2 : 1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="var(--ink)" strokeDasharray="3 3" />
            {ordered.map((s) => s.values[hover] !== null && s.values[hover] !== undefined ? <circle key={s.name} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.name === chosen ? "var(--ink)" : "#fff"} stroke="var(--ink)" strokeWidth="1.5" /> : null)}
          </g>
        )}
      </svg>
      {hv && (
        <div className="absolute panel px-4 py-3 pointer-events-none" style={{ left: `calc(${(x(hover!) / W) * 100}% + 12px)`, top: 24, minWidth: 210, transform: hover! > points.length / 2 ? "translateX(calc(-100% - 24px))" : undefined }}>
          <div className="body-xs muted">Order size · ${hv.usd.toLocaleString()} USDT</div>
          <div className="mt-2 flex flex-col gap-1.5">
            {hv.candidates.map((c) => (
              <div key={c.symbol} className="flex items-center justify-between gap-6 body-sm">
                <span className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: c.symbol === chosen ? "var(--ink)" : "#b9b3ab" }} />{c.symbol}</span>
                <span className="num font-medium">{c.costPerShareUsd === null ? "n/a" : metric === "cost" ? fmt(c.costPerShareUsd) : fmt(c.premiumBps ?? 0)}</span>
              </div>
            ))}
            {metric === "cost" && hv.referencePrice && <div className="flex items-center justify-between body-xs muted pt-1 border-t line"><span>Reference</span><span className="num">{fmt(hv.referencePrice)}</span></div>}
          </div>
        </div>
      )}
    </div>
  );
}
