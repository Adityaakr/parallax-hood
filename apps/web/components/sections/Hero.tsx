"use client";
/*
 * Home Header. Container 150px 40px 100px, gap 50. Heading stack on the project's 0.2/0.3/0.5/0.7 stagger;
 * the Cards Wrapper (1220 × 363, shell 7/7) lands at 0.9 holding the UI-Card (802 × 349, padding 50 50 0,
 * chat mock with a typewriter over the mountain photo) beside the testimonial card (397 × 349, padding 30).
 * Then "[ 1000+ Trusted Clients ]" and the logo rail.
 */
import Image from "next/image";
import { useEffect, useState } from "react";
import { HOME } from "@/content/home";
import { BACKGROUND_IMAGE } from "@/content/site";
import { Reveal, Tag, Button, Icon, LogoRail } from "@/components/site/ui";

/** The search panel's typewriter: types each ticker, holds, deletes, moves on (the reference's chat mock). */
export function Typewriter({ phrases }: { phrases: string[] }) {
  const [i, setI] = useState(0);
  const [n, setN] = useState(0);
  const [del, setDel] = useState(false);
  useEffect(() => {
    const full = phrases[i]!;
    const t = setTimeout(() => {
      if (!del && n < full.length) setN(n + 1);
      else if (!del && n === full.length) setDel(true);
      else if (del && n > 0) setN(n - 1);
      else { setDel(false); setI((i + 1) % phrases.length); }
    }, del ? 30 : n === full.length ? 1600 : 55);
    return () => clearTimeout(t);
  }, [n, del, i, phrases]);
  return <span className="t-small-b" style={{ textTransform: "none", letterSpacing: "-0.144px", lineHeight: "22px", maxWidth: 560, display: "block" }}><span className="caret" />{phrases[i]!.slice(0, n)}</span>;
}

export function ChatMock({ phrases, model }: { phrases: string[]; model: string }) {
  return (
    <div className="ui-panel">
      <div className="flex flex-col gap-[20px]">
        <div className="flex items-center justify-between">
          <span className="ui-chip t-small" style={{ textTransform: "none", letterSpacing: 0.03, lineHeight: "12.8px" }}>{model}</span>
          <span className="ui-round"><Icon name="globe" size={16} /></span>
        </div>
        <Typewriter phrases={phrases} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-[8px]"><span className="ui-round"><Icon name="plus" size={16} /></span><span className="ui-round"><Icon name="sliders" size={16} /></span></div>
        <div className="flex gap-[8px]"><span className="ui-round dark"><Icon name="send" size={16} /></span></div>
      </div>
    </div>
  );
}

export function Hero() {
  const h = HOME.header;
  return (
    <section id="Header" className="section">
      <div className="container" style={{ paddingTop: 150, alignItems: "center" }}>
        <div className="head center">
          <Reveal mount delay={0.2}><Tag on={1}>{h.tag}</Tag></Reveal>
          <Reveal mount delay={0.3}><h1 className="t-h1">{h.title}</h1></Reveal>
          <Reveal mount delay={0.5}><p className="t-main-soft">{h.text}</p></Reveal>
          <Reveal mount delay={0.7} className="buttons"><Button href={h.primary.href}>{h.primary.label}</Button><Button href={h.secondary.href} secondary>{h.secondary.label}</Button></Reveal>
        </div>
        <Reveal mount delay={0.9} className="shell w-full">
          <div className="flex gap-[7px] max-lg:flex-col">
            <div className="ui-card flex-1 min-w-0" style={{ minHeight: 349 }}>
              <Image className="photo" src={BACKGROUND_IMAGE} alt="" fill sizes="802px" priority />
              <ChatMock phrases={h.ui.phrases} model={h.ui.model} />
            </div>
            <div className="card hero-side flex flex-col justify-between gap-[30px]" style={{ width: 397, flex: "none", padding: 30 }}>
              <div className="flex flex-col gap-[20px]">
                <span className="rating flex items-center gap-[6px] t-small" style={{ color: "var(--color-heading)" }}><span style={{ color: "var(--color-brand)" }}>{h.review.rating}</span>{h.review.ratingLabel}</span>
                <p className="t-h4">{h.review.quote}</p>
              </div>
              <div className="avatar-row">
                <Image className="av" src={h.review.avatar} alt="" width={50} height={50} style={{ width: 50, height: 50, borderRadius: 50, objectFit: "cover" }} unoptimized />
                <div className="flex flex-col gap-[8px] flex-1 min-w-0"><span className="t-h6">{h.review.name}</span><span className="t-small" style={{ color: "var(--color-heading)" }}>{h.review.role}</span></div>
                <a className="social" href={h.review.social} target="_blank" rel="noreferrer" aria-label="Open the source"><i className="arrow-mask" aria-hidden /></a>
              </div>
            </div>
          </div>
        </Reveal>
        <Reveal className="w-full"><LogoRail items={h.logos.items} caption={h.logos.caption} /></Reveal>
      </div>
    </section>
  );
}
