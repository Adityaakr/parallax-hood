import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LEGALS } from "@/content/legals";
import { META } from "@/content/site";
import { Reveal } from "@/components/site/ui";

export function generateStaticParams() { return Object.keys(LEGALS).map((slug) => ({ slug })); }
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params; return { title: LEGALS[slug]?.pageTitle ?? META.title, description: META.description };
}
export default async function Legal({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const l = LEGALS[slug]; if (!l) notFound();
  return (
    <section id="Header" className="section">
      <div className="container" style={{ paddingTop: 150, alignItems: "center" }}>
        <Reveal mount delay={0.2}><h1 className="t-h1 text-center">{l.title}</h1></Reveal>
        <Reveal mount delay={0.4} className="rich t-main" style={{ width: 740, maxWidth: "100%" }}><div dangerouslySetInnerHTML={{ __html: l.body }} /></Reveal>
      </div>
    </section>
  );
}
