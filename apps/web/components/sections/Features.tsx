"use client";
/*
 * Features: centred heading, then three Feature Cards (1220 × 514, shell 7) stacked 10px apart, each
 * sticky at 125px. Copy panel 603 × 500, padding 30, label / H3 / Text Main on top, three checks at the
 * bottom. Visual 603 × 500: the mountain photo with a white mock workflow list (450 × 250, rows 434 × 54),
 * the chat mock, or the efficiency chart. Card 2 is the Secondary variant with the visual on the left.
 */
import Image from "next/image";
import { HOME } from "@/content/home";
import { BACKGROUND_IMAGE } from "@/content/site";
import { Reveal, Tag, Feat } from "@/components/site/ui";
import { ResolveFrame, RouterFrame, ReceiptFrame } from "@/components/app/frames";

export function Features() {
  const f = HOME.features;
  return (
    <section id="features" className="section">
      <div className="container">
        <Reveal className="head center"><Tag on={2}>{f.tag}</Tag><h2 className="t-h2">{f.title}</h2><p className="t-main-soft">{f.text}</p></Reveal>
        <div className="flex flex-col gap-[10px]">
          {f.cards.map((c, i) => (
            <Reveal key={c.label} delay={0.2} className={`feature${i === 1 ? " flip" : ""}`} style={{ top: 125 + i * 10 }}>
              <div className="copy">
                <div className="flex flex-col gap-[15px]">
                  <span className="t-small" style={{ color: "var(--color-heading)" }}>{c.label}</span>
                  <div className="flex flex-col gap-[10px]"><h3 className="t-h4" style={{ fontSize: 24, lineHeight: "31.2px" }}>{c.title}</h3><p className="t-main-soft">{c.text}</p></div>
                </div>
                <div className="flex flex-col gap-[15px]">{c.items.map((it) => <Feat key={it}>{it}</Feat>)}</div>
              </div>
              <div className="visual">
                <Image className="photo" src={BACKGROUND_IMAGE} alt="" fill sizes="603px" />
                <div className="mock overflow-hidden w-full" style={{ maxWidth: 520 }}>
                  {c.visual === "resolve" && <ResolveFrame compact venue />}
                  {c.visual === "router" && <RouterFrame />}
                  {c.visual === "receipt" && <ReceiptFrame />}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
