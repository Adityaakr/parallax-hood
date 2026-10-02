"use client";
/* About page sections: Header (left-aligned, buttons right), Logos, Manifesto (scroll-linked word fill), Benefits (3 × 2), Team (4 portraits). */
import { useEffect, useRef, useState } from "react";
import { ABOUT } from "@/content/pages";
import { Reveal, Tag, Button, Icon, Bars, LogoRail } from "@/components/site/ui";
import { ResolveFrame, RouterFrame, BasketFrame, MandateFrame } from "@/components/app/frames";

const VISUAL: Record<string, React.ReactNode> = { resolve: <ResolveFrame mini />, router: <RouterFrame />, basket: <BasketFrame rows={4} />, mandate: <MandateFrame /> };

export function AboutHeader() {
  const h = ABOUT.header;
  return (
    <section id="Header" className="section">
      <div className="container" style={{ paddingTop: 150 }}>
        <div className="flex items-end justify-between gap-[50px] max-lg:flex-col max-lg:items-start">
          <div className="head" style={{ maxWidth: 800 }}>
            <Reveal mount delay={0.2}><Tag on={1}>{h.tag}</Tag></Reveal>
            <Reveal mount delay={0.3}><h1 className="t-h1">{h.title}</h1></Reveal>
            <Reveal mount delay={0.5}><p className="t-main-soft">{h.text}</p></Reveal>
          </div>
          <Reveal mount delay={0.7} className="buttons"><Button href={h.primary.href}>{h.primary.label}</Button><Button href={h.secondary.href} secondary>{h.secondary.label}</Button></Reveal>
        </div>
      </div>
    </section>
  );
}

export function LogosSection() {
  return (
    <section id="Logos" className="section">
      <div className="container" style={{ paddingTop: 50, paddingBottom: 50 }}>
        <Reveal className="w-full"><LogoRail items={ABOUT.logos.items} caption={ABOUT.logos.caption} /></Reveal>
      </div>
    </section>
  );
}

/** Manifesto: each word switches from 20% to full opacity as the paragraph crosses the viewport. */
export function Manifesto() {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lit, setLit] = useState(0);
  const words = ABOUT.manifesto.words;
  useEffect(() => {
    const on = () => {
      const el = ref.current; if (!el) return;
      const r = el.getBoundingClientRect(); const vh = window.innerHeight;
      const t = Math.min(1, Math.max(0, (vh * 0.8 - r.top) / (r.height + vh * 0.3)));
      setLit(Math.round(t * words.length));
    };
    on(); window.addEventListener("scroll", on, { passive: true }); return () => window.removeEventListener("scroll", on);
  }, [words.length]);
  return (
    <section id="Manifesto" className="section">
      <div className="container" style={{ alignItems: "center" }}>
        <div className="head center" style={{ gap: 30 }}>
          <Reveal><Tag on={2}>{ABOUT.manifesto.tag}</Tag></Reveal>
          <p ref={ref} className="manifesto">{words.map((w, i) => <span key={i} className={i < lit ? "on" : ""}>{w}{" "}</span>)}</p>
        </div>
      </div>
    </section>
  );
}

export function Benefits() {
  const b = ABOUT.benefits;
  return (
    <section id="benefits" className="section">
      <div className="container">
        <Reveal className="head center"><Tag on={3}>{b.tag}</Tag><h2 className="t-h2">{b.title}</h2><p className="t-main-soft">{b.text}</p></Reveal>
        <Reveal delay={0.2} className="shell w-full"><div className="grid gap-[7px] lg:grid-cols-3">
          {b.cards.map((c) => (
            <div key={c.title} className="step">
              <div className="top"><span className="icon50"><Icon name={c.icon} size={25} /></span><Bars on={c.dots} /></div>
              <div className="flex flex-col gap-[10px]"><h3 className="t-h4">{c.title}</h3><p className="t-main-soft">{c.text}</p></div>
            </div>
          ))}
        </div></Reveal>
      </div>
    </section>
  );
}

export function Team() {
  const t = ABOUT.team;
  return (
    <section id="benefits-1" className="section">
      <div className="container">
        <Reveal className="head center"><Tag on={4}>{t.tag}</Tag><h2 className="t-h2">{t.title}</h2><p className="t-main-soft">{t.text}</p></Reveal>
        <Reveal delay={0.2} className="shell w-full"><div className="grid gap-[7px] lg:grid-cols-4">
          {t.members.map((m) => (
            <div key={m.name} className="member">
              <div className="flex items-start p-[10px]" style={{ height: 310, background: "var(--color-card-2)", overflow: "hidden" }}><div className="w-full rounded-[8px] overflow-hidden" style={{ border: "var(--dash)" }}>{VISUAL[m.visual]}</div></div>
              <div className="info"><span className="t-h5">{m.name}</span><span className="t-small" style={{ color: "var(--color-heading)" }}>{m.role}</span></div>
            </div>
          ))}
        </div></Reveal>
      </div>
    </section>
  );
}
