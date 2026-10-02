import type { Metadata } from "next";
import { META } from "@/content/site";
import { HOME } from "@/content/home";
import { POSTS } from "@/content/blog";
import { Hero } from "@/components/sections/Hero";
import { Features } from "@/components/sections/Features";
import { Integrations, Metrics, Process, Reviews } from "@/components/sections/Middle";
import { PlansSection, FaqsSection, PostCard } from "@/components/sections/shared";
import { Reveal, Tag, Button } from "@/components/site/ui";

export const metadata: Metadata = { title: META.title, description: META.description };

export default function Home() {
  const b = HOME.blog;
  const posts = b.slugs.map((s) => POSTS.find((p) => p.slug === s)!);
  return (
    <>
      <Hero />
      <Features />
      <Integrations />
      <Metrics />
      <Process />
      <Reviews />
      <PlansSection on={7} logos />
      <FaqsSection on={8} />
      <section id="blog" className="section">
        <div className="container">
          <Reveal className="head center"><Tag on={9}>{b.tag}</Tag><h2 className="t-h2">{b.title}</h2><p className="t-main-soft" style={{ maxWidth: 420 }}>{b.text}</p></Reveal>
          <Reveal delay={0.2} className="shell w-full"><div className="grid gap-[7px] lg:grid-cols-3">{posts.map((p) => <PostCard key={p.slug} post={p} />)}</div></Reveal>
          <Reveal className="flex justify-center"><Button href={b.viewAll.href}>{b.viewAll.label}</Button></Reveal>
        </div>
      </section>
    </>
  );
}
