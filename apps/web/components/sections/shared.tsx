"use client";
/* Sections that appear on more than one page: FAQs, Plans (pricing), Blog cards. */
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Reveal, Tag, Button, Icon, LogoRail } from "@/components/site/ui";
import { FAQS, PLANS, LOGOS } from "@/content/site";
import type { Post } from "@/content/blog";
import type { BasketCard, BasketPerformance, Period } from "@/lib/api";
import { DEFAULT_CHAIN, resolverUrlOrNull } from "@/lib/config";
import { LogoCluster, PERIODS, PERIOD_LABELS, PERIOD_LONG, pct, signColor } from "@/components/app/index-ui";
import { TokenMark } from "@/components/app/TokenMark";

/** FAQs: heading column (with CTA block) beside the accordion. `centered` is the Contact page variant. */
export function FaqsSection({ on = 8, centered = false, text = FAQS.text, tag = FAQS.tag, title = FAQS.title }: { on?: number; centered?: boolean; text?: string; tag?: string; title?: string }) {
  const list = (
    <div className="faq-shell w-full">
      {FAQS.items.map((f, i) => (
        <details key={f.q} className="faq" open={i === 0}>
          <summary><span className="t-h5">{f.q}</span><span className="pm" aria-hidden /></summary>
          <div className="answer"><div className="t-main">{f.a}</div></div>
        </details>
      ))}
    </div>
  );
  if (centered) {
    return (
      <section id="FAQs" className="section">
        <div className="container">
          <Reveal className="head center"><Tag on={on}>{tag}</Tag><h2 className="t-h2">{title}</h2><p className="t-main-soft">{text}</p></Reveal>
          <Reveal delay={0.2}>{list}</Reveal>
        </div>
      </section>
    );
  }
  return (
    <section id="FAQs" className="section">
      <div className="container row" style={{ gap: 50 }}>
        <Reveal className="flex flex-col justify-between" style={{ width: 585, flex: "none", minHeight: 696 }}>
          <div className="head">
            <div><Tag on={on}>{tag}</Tag></div>
            <h2 className="t-h2">{title}</h2>
            <p className="t-main-soft">{text}</p>
          </div>
          <div className="cta-block">
            <div className="content">
              <span className="icon50"><Icon name="headset" size={25} /></span>
              <div className="flex flex-col gap-[10px] pb-[10px]"><div className="t-h5">{FAQS.cta.title}</div><div className="t-small" style={{ color: "var(--color-heading)" }}>{FAQS.cta.text}</div></div>
              <Button href={FAQS.cta.button.href} full>{FAQS.cta.button.label}</Button>
            </div>
          </div>
        </Reveal>
        <Reveal delay={0.2} className="flex-1 min-w-0 w-full">{list}</Reveal>
      </div>
    </section>
  );
}

/** Plans: Monthly / Yearly tab then three cards; `logos` appends the trusted-clients rail (home only). */
/**
 * Indices, in the Plans frame: the three curated indices as index cards (constituent marks, thesis, return over
 * the chosen period, minimum, NAV). Figures come from the resolver on the default network; when it is not
 * reachable the cards keep the definitions and say the figures are unavailable rather than showing stale ones.
 */
export function PlansSection({ on = 7, logos = false }: { on?: number; logos?: boolean }) {
  const [period, setPeriod] = useState<Period>("y1");
  const [live, setLive] = useState<Record<string, BasketCard> | null | undefined>(undefined);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const [bg, setBg] = useState({ left: 5, width: 0 });
  useEffect(() => {
    const base = resolverUrlOrNull(DEFAULT_CHAIN);
    if (!base) { setLive(null); return; }
    const ctl = new AbortController();
    fetch(`${base}/baskets`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { baskets: BasketCard[] }) => setLive(Object.fromEntries(d.baskets.map((b) => [b.symbol, b]))))
      .catch(() => setLive(null));
    return () => ctl.abort();
  }, []);
  useEffect(() => {
    const el = tabs.current[PERIODS.indexOf(period)];
    if (el) setBg({ left: el.offsetLeft, width: el.offsetWidth });
  }, [period]);
  return (
    <section id="Plans" className="section">
      <div className="container">
        <Reveal className="head center"><Tag on={on}>{PLANS.tag}</Tag><h2 className="t-h2">{PLANS.title}</h2><p className="t-main-soft" style={{ maxWidth: 500 }}>{PLANS.text}</p></Reveal>
        <Reveal delay={0.2} className="flex flex-col items-center gap-[25px] w-full">
          <div className="ptab" role="tablist" aria-label="Return period">
            <span className="bg" aria-hidden style={{ left: bg.left, width: bg.width }} />
            {PERIODS.map((p, i) => (
              <button key={p} ref={(el) => { tabs.current[i] = el; }} role="tab" aria-selected={period === p} data-on={period === p} onClick={() => setPeriod(p)}>{PERIOD_LABELS[p]}</button>
            ))}
          </div>
          <div className="shell w-full">
            <div className="grid gap-[7px] lg:grid-cols-3">
              {PLANS.cards.map((c) => {
                const b = live?.[c.symbol];
                const ret = b?.performance.returns[period];
                const marks = b?.allocation ?? c.tickers.map((t) => ({ ticker: t, logoUrl: null }));
                return (
                  <Link key={c.symbol} href={`/baskets/${c.symbol}`} className="icard">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3"><TokenMark symbol={c.symbol} size={28} /><span aria-hidden className="w-px self-stretch my-1" style={{ background: "var(--line-2)" }} /><LogoCluster items={marks} /></div>
                      <span className="ichip">{b ? (b.deployed ? "live" : "not deployed yet") : live === undefined ? "loading" : "offline"}</span>
                    </div>
                    <div className="flex flex-col gap-[8px]">
                      <div className="flex items-baseline gap-3"><span className="t-h5">{c.name}</span><span className="isym">{c.symbol}</span></div>
                      <p className="t-main-soft">{c.thesis}</p>
                    </div>
                    <div className="ifigs">
                      <div><div className="t-small ilabel">{PERIOD_LONG[period]} return</div><div className="ivalue" style={{ color: signColor(ret) }}>{b ? pct(ret) : "n/a"}</div></div>
                      <div><div className="t-small ilabel">Minimum</div><div className="ivalue">{b ? `$${b.minUsd}` : "n/a"}</div></div>
                      <div><div className="t-small ilabel">NAV / unit</div><div className="ivalue">{b?.navPerUnitUsd ? `$${Number(b.navPerUnitUsd).toFixed(2)}` : "n/a"}</div></div>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inote">{b ? coverageText(b.performance) : live === null ? PLANS.offline : "Fetching live figures…"}</span>
                      <span className="igo">View index<Icon name="arrow-up-right" size={14} alt="" /></span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </Reveal>
        {logos && <Reveal delay={0.2} className="w-full"><LogoRail items={LOGOS.items} caption={LOGOS.caption} /></Reveal>}
      </div>
    </section>
  );
}

/** The coverage sentence the product cards use, as plain text. */
function coverageText(perf: BasketPerformance) {
  if (perf.coverageBps >= 10_000) return "Price return from Chainlink rounds on BSC, dividends excluded.";
  if (perf.covered === 0) return `No return history yet: none of the ${perf.total} constituents has a Chainlink feed on BSC.`;
  return `Covers ${(perf.coverageBps / 100).toFixed(0)}% of NAV: ${perf.covered} of ${perf.total} constituents have a Chainlink feed on BSC.`;
}

export function PostCard({ post, base = "/blog/" }: { post: Post; base?: string }) {
  return (
    <Link href={`${base}${post.slug}`} className="post">
      <div className="img"><Image src={`/assets/images/${post.image}`} alt="Articles Image" width={377} height={230} /></div>
      <div className="body">
        <span className="t-small" style={{ color: "var(--color-brand)" }}>{post.category}</span>
        <span className="t-h4">{post.title}</span>
      </div>
    </Link>
  );
}
