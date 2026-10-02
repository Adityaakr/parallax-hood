"use client";
/*
 * Footer: full-bleed Card 1 background, 1300 container, three dashed-ruled blocks.
 *   Top       padding 80px 40px, gap 20; H2 + Text Main + two buttons over a blurred orange wash
 *   Content   Newsletter 670 wide (80/40/40) | Navigation 630 wide (80/40), three columns gap 40, links gap 15
 *   Bottom    the reference's row ("©2026 Syncrun. Designed By Marso" | "Built in Framer"), padding 20px 40px;
 *             ours carries the eligibility and non-affiliation notices and a link to the terms
 * Column heads are Heading H6 (serif, declared 900 → renders 600). Links are Inter 600 16/19.2 -0.32, #4f4f4f.
 */
import { CTA, FOOTER, REPO } from "@/content/site";
import { A, Button, Icon } from "./ui";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="top">
          <div className="head center" style={{ gap: 15 }}>
            <h2 className="t-h2" style={{ maxWidth: 600 }}>{CTA.title}</h2>
            <p className="t-main-soft" style={{ maxWidth: 430 }}>{CTA.text}</p>
          </div>
          <div className="buttons">
            <Button href={CTA.primary.href}>{CTA.primary.label}</Button>
            <Button href={CTA.secondary.href} secondary>{CTA.secondary.label}</Button>
          </div>
        </div>
        <div className="content">
          <div className="newsletter">
            <form className="flex flex-col gap-[25px]" onSubmit={(e) => { e.preventDefault(); window.open(REPO, "_blank", "noreferrer"); }}>
              <div className="flex flex-col gap-[10px]">
                <div className="t-h7b">{FOOTER.newsletter.title}</div>
                <p className="t-main">{FOOTER.newsletter.text}</p>
              </div>
              <div className="email">
                <input type="email" name={FOOTER.newsletter.inputName} placeholder={FOOTER.newsletter.placeholder} aria-label={FOOTER.newsletter.placeholder} />
                <button type="submit">{FOOTER.newsletter.button}<Icon name="arrow-right" size={20} /></button>
              </div>
            </form>
          </div>
          <div className="navigation">
            {FOOTER.columns.map((c) => (
              <div key={c.title}>
                <div className="t-h7b">{c.title}</div>
                {c.links.map(([label, href]) => <A key={label} href={href}>{label}</A>)}
              </div>
            ))}
          </div>
        </div>
        <div className="bottom">
          <p className="t-small" style={{ color: "var(--color-heading)", textTransform: "none", lineHeight: "18px", maxWidth: 900 }}>{FOOTER.bottom.notice}</p>
          <A className="t-small" href={FOOTER.bottom.link.href} style={{ color: "var(--color-heading)", flex: "none" }}>{FOOTER.bottom.link.label}</A>
        </div>
      </div>
    </footer>
  );
}
