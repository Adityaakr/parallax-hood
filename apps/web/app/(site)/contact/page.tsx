import type { Metadata } from "next";
import { ContactForm } from "@/components/sections/ContactForm";
import Image from "next/image";
import { CONTACT } from "@/content/pages";
import { META, BACKGROUND_IMAGE } from "@/content/site";
import { Reveal, Tag, Icon, Bars } from "@/components/site/ui";
import { FaqsSection } from "@/components/sections/shared";

export const metadata: Metadata = { title: CONTACT.pageTitle, description: META.description };
export default function Contact() {
  const c = CONTACT;
  return (
    <>
      <section id="contact" className="section">
        <div className="container row" style={{ paddingTop: 150 }}>
          <div className="flex flex-col justify-between" style={{ width: 578, flex: "none", minHeight: 620 }}>
            <div className="head">
              <Reveal mount delay={0.2}><Tag on={1}>{c.tag}</Tag></Reveal>
              <Reveal mount delay={0.3}><h1 className="t-h1">{c.title}</h1></Reveal>
              <Reveal mount delay={0.5}><p className="t-main-soft" style={{ maxWidth: 330 }}>{c.text}</p></Reveal>
            </div>
            <Reveal mount delay={0.7} className="grid lg:grid-cols-2 gap-[10px]">
              {c.cards.map((k) => (
                <div key={k.label} className="info-card"><div className="content">
                  <div className="flex justify-between"><Icon name="paper-plane" size={25} /><Bars on={k.dots} /></div>
                  <div className="flex flex-col gap-[8px]"><span className="t-small" style={{ color: "var(--color-heading)" }}>{k.label}</span><a className="t-main" style={{ fontWeight: 600, color: "var(--color-heading)" }} href={k.href}>{k.email}</a></div>
                </div></div>
              ))}
            </Reveal>
          </div>
          <Reveal mount delay={0.9} className="form-card flex-1 min-w-0 w-full">
            <Image className="photo" src={BACKGROUND_IMAGE} alt="Background Image" fill sizes="600px" />
            <ContactForm />
          </Reveal>
        </div>
      </section>
      <FaqsSection on={2} centered tag={c.faqs.tag} title={c.faqs.title} text={c.faqs.text} />
    </>
  );
}
