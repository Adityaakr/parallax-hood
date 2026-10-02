import type { Metadata } from "next";
import { BLOG_INDEX } from "@/content/pages";
import { POSTS } from "@/content/blog";
import { META } from "@/content/site";
import { Reveal, Tag } from "@/components/site/ui";
import { PostCard } from "@/components/sections/shared";

export const metadata: Metadata = { title: BLOG_INDEX.pageTitle, description: META.description };
export default function Blog() {
  return (
    <section id="blog" className="section">
      <div className="container" style={{ paddingTop: 150 }}>
        <div className="head center">
          <Reveal mount delay={0.2}><Tag on={1}>{BLOG_INDEX.tag}</Tag></Reveal>
          <Reveal mount delay={0.3}><h1 className="t-h1">{BLOG_INDEX.title}</h1></Reveal>
          <Reveal mount delay={0.5}><p className="t-main-soft" style={{ maxWidth: 430 }}>{BLOG_INDEX.text}</p></Reveal>
        </div>
        <Reveal mount delay={0.7} className="shell w-full"><div className="grid gap-[7px] lg:grid-cols-3">{POSTS.map((p) => <PostCard key={p.slug} post={p} />)}</div></Reveal>
      </div>
    </section>
  );
}
