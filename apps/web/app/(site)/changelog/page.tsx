import type { Metadata } from "next";
import Image from "next/image";
import { CHANGELOG_PAGE } from "@/content/pages";
import { CHANGELOG } from "@/content/changelog";
import { META } from "@/content/site";
import { Reveal, Tag } from "@/components/site/ui";

export const metadata: Metadata = { title: CHANGELOG_PAGE.pageTitle, description: META.description };
export default function Changelog() {
  const c = CHANGELOG_PAGE;
  return (
    <section id="Header" className="section">
      <div className="container" style={{ paddingTop: 150 }}>
        <div className="head center">
          <Reveal mount delay={0.2}><Tag on={1}>{c.tag}</Tag></Reveal>
          <Reveal mount delay={0.3}><h1 className="t-h1">{c.title}</h1></Reveal>
          <Reveal mount delay={0.5}><p className="t-main-soft" style={{ maxWidth: 430 }}>{c.text}</p></Reveal>
        </div>
        <Reveal mount delay={0.7} className="shell w-full"><div className="card-2 rounded-[10px] overflow-hidden" style={{ background: "var(--color-background)", border: "var(--dash)", borderRadius: 10 }}>
          {CHANGELOG.map((e, i) => (
            <div key={e.version} className="entry" style={i === 0 ? { borderTop: 0 } : undefined}>
              <div><div className="t-h5 sticky" style={{ top: 120 }}>{e.version}</div></div>
              <div>
                <div className="flex flex-col gap-[10px]">
                  <span className="t-small" style={{ color: "var(--color-brand)" }}>{e.date}</span>
                  <h3 className="t-h4">{e.title}</h3>
                  <div className="rich t-main-soft" dangerouslySetInnerHTML={{ __html: e.body }} />
                </div>
                <Image src={`/assets/images/${e.image}`} alt="Changelog Image" width={520} height={320} style={{ width: "100%", height: 310, objectFit: "cover", borderRadius: 10, marginTop: 30 }} />
              </div>
            </div>
          ))}
        </div></Reveal>
      </div>
    </section>
  );
}
