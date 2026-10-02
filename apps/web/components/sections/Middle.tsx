"use client";
/* Integrations, Metrics, Process and Reviews. Frames from .recon/styles/home-1440.json. */
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { HOME } from "@/content/home";
import { BACKGROUND_IMAGE } from "@/content/site";
import { Reveal, Tag, Feat, Icon, Bars, Counter, Button } from "@/components/site/ui";
import { BasketFrame } from "@/components/app/frames";

/* ---------- Integrations: heading + three dashed rows (578) beside a 4 × 4 grid (592 shell) ---------- */
type Mark = { src: string; label: string };
function Tile({ marks, offset }: { marks: Mark[]; offset: number }) {
  // LogoSlider: each tile crossfades to the next mark on a staggered cadence, 0.8s fade
  const [i, setI] = useState(offset % marks.length);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % marks.length), 2000 * 4 + (offset % 4) * 100); return () => clearInterval(t); }, [marks.length, offset]);
  const mk = marks[i]!;
  return (
    <div key={i} style={{ animation: "fadein 0.8s var(--ease)" }}>
      {mk.src ? <Image src={mk.src} alt={mk.label} width={48} height={48} unoptimized style={{ borderRadius: 10 }} /> : <span className="t-h6 text-center px-2">{mk.label}</span>}
    </div>
  );
}
export function Integrations() {
  const s = HOME.integrations;
  return (
    <section id="Integrations" className="section">
      <div className="container row">
        <Reveal className="flex flex-col" style={{ width: 578, flex: "none" }}>
          <div className="head"><div><Tag on={3}>{s.tag}</Tag></div><h2 className="t-h2">{s.title}</h2><p className="t-main-soft">{s.text}</p></div>
          <div className="feat-rows mt-auto pt-[100px]">{s.items.map((it) => <Feat key={it}>{it}</Feat>)}</div>
        </Reveal>
        <Reveal delay={0.2} className="shell flex-1 min-w-0 w-full">
          <div className="igrid">{Array.from({ length: 16 }, (_, i) => <Tile key={i} marks={s.marks} offset={i} />)}</div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Metrics: wrapper 1220 (shell 7, gap 7): 377 | calculator | 377 ---------- */
type Metric = { label: string; end: number; decimals: number; symbol: string; prefix?: string; text: string; dots: number };
function MetricCard({ m }: { m: Metric }) {
  return (
    <div className="metric">
      <div className="top"><span className="t-small" style={{ color: "var(--color-heading)" }}>{m.label}</span><Bars on={m.dots} /></div>
      <div className="flex flex-col gap-[20px]"><span className="t-metric">{m.prefix ?? ""}<Counter end={m.end} decimals={m.decimals} symbol={m.symbol} /></span><p className="t-main-soft">{m.text}</p></div>
    </div>
  );
}
function Calculator() {
  const c = HOME.metrics.calculator;
  const [usd, setUsd] = useState(c.defaultTasks);
  const [bps, setBps] = useState(c.defaultLevel);
  const perOrder = (usd * bps) / 10_000;
  // the bars: the same fee rate applied to seven order sizes, so nothing on the chart is invented
  const sizes = useMemo(() => [1_000, 2_500, 5_000, 10_000, 25_000, 50_000, 100_000], []);
  const bars = sizes.map((n) => (n * bps) / 10_000);
  const max = Math.max(...bars, 1);
  return (
    <div className="calc">
      <Image className="photo" src={BACKGROUND_IMAGE} alt="" fill sizes="437px" />
      <div className="panel flex flex-col gap-[6px]">
        <label>{c.label1}</label>
        <div className="t-h3b">${usd.toLocaleString("en-US")}</div>
        <input type="range" min={1000} max={250_000} step={1000} value={usd} onChange={(e) => setUsd(Number(e.target.value))} aria-label={c.label1} />
        <label>{c.label2}</label>
        <div className="t-h3b">{(bps / 100).toFixed(2)} %</div>
        <input type="range" min={1} max={c.maxLevel} step={1} value={bps} onChange={(e) => setBps(Number(e.target.value))} aria-label={c.label2} />
        <div className="flex items-center justify-between"><label>{c.tasksLabel}</label><span style={{ fontSize: 11, fontWeight: 700 }}>${perOrder.toLocaleString("en-US", { maximumFractionDigits: 0 })} {c.perMonth}</span></div>
        <div className="bars mt-[30px]">{bars.map((b, i) => <div key={i}><b style={{ height: `${8 + (b / max) * 42}px` }} /><span>{sizes[i]! >= 1000 ? `${sizes[i]! / 1000}k` : sizes[i]}</span></div>)}</div>
        <div className="rule mt-[20px] mb-[6px]" />
        <div className="results">
          <div><div className="t-h4b">$ {perOrder.toLocaleString("en-US", { maximumFractionDigits: 0 })}</div><div style={{ fontSize: 11, letterSpacing: "0.55px", textTransform: "uppercase", marginTop: 6 }}>{c.result1}</div></div>
          <div><div className="t-h4b">$ {(perOrder * 10).toLocaleString("en-US", { maximumFractionDigits: 0 })}</div><div style={{ fontSize: 11, letterSpacing: "0.55px", textTransform: "uppercase", marginTop: 6 }}>{c.result2}</div></div>
        </div>
      </div>
    </div>
  );
}
export function Metrics() {
  const m = HOME.metrics;
  return (
    <section id="Metrics" className="section">
      <div className="container">
        <Reveal className="head center"><Tag on={4}>{m.tag}</Tag><h2 className="t-h2">{m.title}</h2><p className="t-main-soft">{m.text}</p></Reveal>
        <Reveal delay={0.2} className="shell w-full">
          <div className="metrics">
            <div className="col">{m.left.map((x) => <MetricCard key={x.label} m={x} />)}</div>
            <Calculator />
            <div className="col">{m.right.map((x) => <MetricCard key={x.label} m={x} />)}</div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Process: sticky heading (578) beside three Main Cards (592 shell) ---------- */
export function Process() {
  const p = HOME.process;
  return (
    <section id="Process" className="section">
      <div className="container row">
        <Reveal style={{ width: 578, flex: "none" }}>
          <div className="head sticky">
            <div><Tag on={5}>{p.tag}</Tag></div>
            <h2 className="t-h2">{p.title}</h2>
            <p className="t-main-soft">{p.text}</p>
            <div className="buttons"><Button href={p.button.href}>{p.button.label}</Button></div>
          </div>
        </Reveal>
        <Reveal delay={0.2} className="shell flex-1 min-w-0 w-full flex flex-col gap-[7px]">
          {p.steps.map((s) => (
            <div key={s.title} className="step">
              <div className="top"><span className="icon50"><Icon name={s.icon} size={25} /></span><Bars on={s.dots} /></div>
              <div className="flex flex-col gap-[10px]"><h3 className="t-h4">{s.title}</h3><p className="t-main-soft" style={{ maxWidth: 330 }}>{s.text}</p></div>
            </div>
          ))}
        </Reveal>
      </div>
    </section>
  );
}

/* ---------- Reviews: large card (402 image | 804 card, 450 tall) then a 470-wide card ticker ---------- */
export function Reviews() {
  const r = HOME.reviews;
  return (
    <section id="Reviews" className="section">
      <div className="container">
        <Reveal className="head center"><Tag on={6}>{r.tag}</Tag><h2 className="t-h2">{r.title}</h2><p className="t-main-soft">{r.text}</p></Reveal>
        <Reveal delay={0.2} className="shell w-full flex flex-col gap-[7px]">
          <div className="review-large">
            <div className="img flex items-center p-[20px]" style={{ background: "var(--color-card-2)" }}><div className="w-full rounded-[10px] overflow-hidden" style={{ border: "var(--dash)" }}><BasketFrame rows={4} /></div></div>
            <div className="card">
              <div className="details"><p className="t-h3">{r.large.quote}</p></div>
              <div className="who">
                <div className="flex flex-col gap-[7px]"><span className="t-h5">{r.large.name}</span><span className="t-small" style={{ color: "var(--color-heading)" }}>{r.large.role}</span></div>
                <a className="social" href={r.large.social} target="_blank" rel="noreferrer" aria-label="Open the source"><i className="arrow-mask" aria-hidden /></a>
              </div>
            </div>
          </div>
          <div className="ticker-wrap">
            <div className="ticker">
              {[...r.ticker, ...r.ticker].map((t, i) => (
                <div key={i} className="review">
                  <div className="flex flex-col gap-[50px]">
                    <span className="rating t-small" style={{ color: "var(--color-brand)" }}>{t.rating}{r.ratingLabel}</span>
                    <p className="t-h4">{t.quote}</p>
                  </div>
                  <div className="avatar-row">
                    <Image className="av" src={t.avatar} alt="" width={50} height={50} unoptimized />
                    <div className="flex flex-col gap-[8px] flex-1 min-w-0"><span className="t-h5">{t.name}</span><span className="t-small" style={{ color: "var(--color-heading)" }}>{t.role}</span></div>
                    <a className="social" href={t.social} target="_blank" rel="noreferrer" aria-label="Open the source"><i className="arrow-mask" aria-hidden /></a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
