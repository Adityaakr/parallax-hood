import type { Metadata } from "next";
import { PLANS_PAGE } from "@/content/pages";
import { META } from "@/content/site";
import { PlansSection, FaqsSection } from "@/components/sections/shared";
import { Reveal, Tag, Icon } from "@/components/site/ui";

export const metadata: Metadata = { title: PLANS_PAGE.pageTitle, description: META.description };
export default function Plans() {
  const c = PLANS_PAGE.comparison;
  return (
    <>
      <div style={{ paddingTop: 50 }}><PlansSection on={1} /></div>
      <section id="Comparison" className="section">
        <div className="container">
          <Reveal className="head center"><Tag on={2}>{c.tag}</Tag><h2 className="t-h2">{c.title}</h2><p className="t-main-soft" style={{ maxWidth: 420 }}>{c.text}</p></Reveal>
          <Reveal delay={0.2} className="shell w-full">
            <div className="compare">
              <div className="row">{c.head.map((h, i) => <div key={h} className={i === 0 ? "t-h4" : "t-h5"}>{h}</div>)}</div>
              {c.rows.map(([label, ...cells]) => (
                <div key={label} className="row">
                  <div className="t-main">{label}</div>
                  {cells.map((yes, i) => <div key={i}>{yes ? <Icon name="check-small" size={16} /> : <span className="t-main-soft">{c.no}</span>}</div>)}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>
      <FaqsSection on={3} />
    </>
  );
}
