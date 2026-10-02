import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { POSTS } from "@/content/blog";
import { MORE_INSIGHTS } from "@/content/pages";
import { META, REPO } from "@/content/site";
import { Reveal, Tag, Icon } from "@/components/site/ui";
import { PostCard } from "@/components/sections/shared";

export function generateStaticParams() { return POSTS.map((p) => ({ slug: p.slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; const p = POSTS.find((x) => x.slug === slug);
  return { title: p?.pageTitle ?? META.title, description: META.description };
}
export default async function Article({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const p = POSTS.find((x) => x.slug === slug);
  if (!p) notFound();
  const related = p.related.map((s) => POSTS.find((x) => x.slug === s)!).filter(Boolean);
  return (
    <>
      <section id="Header" className="section">
        <div className="container" style={{ paddingTop: 150, alignItems: "center" }}>
          <div className="head center wide">
            <Reveal mount delay={0.2}><Tag on={1}>{p.date}</Tag></Reveal>
            <Reveal mount delay={0.3}><h1 className="t-h1">{p.title}</h1></Reveal>
            <Reveal mount delay={0.5}><p className="t-main-soft" style={{ maxWidth: 430 }}>{p.lede}</p></Reveal>
          </div>
          <Reveal mount delay={0.7} className="shell w-full"><Image src={`/assets/images/${p.image}`} alt="Articles Image" width={1206} height={640} style={{ width: "100%", height: 640, objectFit: "cover", borderRadius: 10, display: "block" }} priority /></Reveal>
        </div>
      </section>
      <section id="header-1" className="section">
        <div className="container row">
          <Reveal mount delay={0.1} className="rich article-body t-main-soft" style={{ width: 640, flex: "none" }} >
            <div dangerouslySetInnerHTML={{ __html: p.body }} />
          </Reveal>
          <Reveal delay={0.2} className="flex-1 flex justify-end">
            <div className="avatar-row sticky" style={{ top: 120, width: 380, background: "var(--color-card-1)" }}>
              <Image className="av" src={p.author.avatar} alt="" width={50} height={50} unoptimized />
              <div className="flex flex-col gap-[4px] flex-1"><span className="t-h6">{p.author.name}</span><span className="t-small" style={{ color: "var(--color-heading)" }}>{p.author.role}</span></div>
              <a className="social" href={REPO} target="_blank" rel="noreferrer" aria-label="Open the repository"><i className="arrow-mask" aria-hidden /></a>
            </div>
          </Reveal>
        </div>
      </section>
      <section id="blog" className="section">
        <div className="container">
          <Reveal className="head"><div><Tag on={3}>{MORE_INSIGHTS.tag}</Tag></div><h2 className="t-h2">{MORE_INSIGHTS.title}</h2></Reveal>
          <Reveal delay={0.2} className="shell w-full"><div className="grid gap-[7px] lg:grid-cols-3">{related.map((r) => <PostCard key={r.slug} post={r} />)}</div></Reveal>
        </div>
      </section>
    </>
  );
}
