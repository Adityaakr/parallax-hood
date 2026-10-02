import "../components.css";
/*
 * Phase 1 review page: every token in app/globals.css rendered once, with the measured source value beside
 * it, so the system can be checked against .recon/shots before any section is built. Sample strings are
 * taken from the reference so the specimens read the way the site does.
 */

const COLORS: [string, string, string][] = [
  ["--color-background", "#f7f5f3", "Background · page canvas"],
  ["--color-card-1", "#eeeae6", "Card 1 · sand cards, footer"],
  ["--color-card-2", "#ffffff", "Card 2 · white cards, UI mocks"],
  ["--color-card-3", "#1a1a1a", "Card 3 · primary buttons, calculator card"],
  ["--color-heading", "#262626", "Heading"],
  ["--color-paragraph", "#262626", "Paragraph"],
  ["--color-paragraph-soft", "#4f4f4f", "lede and descriptions (180 elements)"],
  ["--color-brand", "#f24100", "Brand · checks, barcode glyph, categories"],
  ["--color-brand-hover", "#ff3700", "hover fill on brand elements"],
  ["--color-border-1", "#d6d0c8", "Border V1 · every dashed rule"],
  ["--color-border-2", "rgba(0,0,0,.05)", "Border V2"],
  ["--color-border-3", "rgba(0,0,0,.15)", "Border V3 · overlay tint"],
  ["--color-tag-border", "rgb(209,203,194)", "Section Tag border"],
  ["--color-link-default", "#0000ee", "unstyled rich-text links (legal pages)"],
];

const TYPE: { cls: string; role: string; spec: string; sample: string }[] = [
  { cls: "t-h1", role: "Heading 1", spec: "Libre Caslon Condensed 500 · 76.8/88.32 · -1.6px · 48/55.2 below 1200", sample: "Deploy AI agents that work for you, 24/7." },
  { cls: "t-h2", role: "Heading 2", spec: "Libre Caslon Condensed 500 · 56/61.6 · -1.6px · 40/44 below 1200", sample: "AI Agent Platform that works for you." },
  { cls: "t-metric", role: "Metric number", spec: "Libre Caslon Condensed 500 · 48/48 · -1.92px", sample: "469+" },
  { cls: "t-h3", role: "Heading 3 (large quote)", spec: "Libre Caslon Condensed 400 · 32/41.6 · 0 · 22.4/29.12 below 1200", sample: "\"Syncrun helped us cut average ticket resolution from 8 hours to under 4 minutes\"" },
  { cls: "t-h3b", role: "Calculator figure", spec: "Libre Caslon Condensed 500 · 32/32 · 0", sample: "1,000" },
  { cls: "t-h4", role: "Heading 4 (card title, quote)", spec: "Libre Caslon Condensed 500 · 24/31.2 · 0 · 22.4/29.12 below 1200", sample: "\"Syncrun replaced our automation workflows and gave our team real-time visibility across every customer touch.\"" },
  { cls: "t-h4b", role: "Calculator result", spec: "Libre Caslon Condensed 500 · 22/22", sample: "$ 2,625" },
  { cls: "t-h5", role: "Reviewer name", spec: "Libre Caslon Condensed 500 · 20.8/22.88 · -1px", sample: "Daniel Carter" },
  { cls: "t-logo", role: "Logo wordmark", spec: "Libre Caslon Condensed 500 · 20.8/27.04", sample: "Syncrun" },
  { cls: "t-h6", role: "Avatar name", spec: "Libre Caslon Condensed 500 · 19.2/23.04 · -0.9px", sample: "Mateo Alvarez" },
  { cls: "t-h7", role: "UI mock row", spec: "Libre Caslon Condensed 600 · 15.2/16.72", sample: "New lead in HubSpot" },
  { cls: "t-h7b", role: "Footer column head", spec: "Libre Caslon Condensed 900 (renders 600, heaviest file) · 15.2/16.72", sample: "Navigation" },
  { cls: "t-nav", role: "Nav link", spec: "Inter 600 · 16/19.2 · -0.32px", sample: "Home" },
  { cls: "t-button", role: "Button label", spec: "Public Sans 600 · 16/17.6", sample: "Get started" },
  { cls: "t-main", role: "Text Main", spec: "Public Sans 400 · 16/22.4 · 0.03px", sample: "Syncrun helps teams build chatbots, voice agents, and workflow automations - all in one intelligent platform." },
  { cls: "t-main-soft", role: "Text Main, soft", spec: "same, #4f4f4f", sample: "Purpose-built capabilities that eliminate manual work across your entire operation." },
  { cls: "t-small-b", role: "Text Small B", spec: "Public Sans 500 · 14.4/14.4 · -0.144px", sample: "Automate support. Engage. Convert." },
  { cls: "t-small", role: "Text Small (labels)", spec: "Public Sans 500 · 12.8/10.24 · 0.03px · uppercase", sample: "AI Agent Platform" },
  { cls: "t-badge", role: "Badge", spec: "Public Sans 500 · 12.8/15.36 · uppercase", sample: "-20%" },
  { cls: "t-tiny", role: "Text Tiny", spec: "Public Sans 400 · 11.2/11.2 · 1px · uppercase", sample: "Monthly tasks" },
  { cls: "t-price", role: "Text Price", spec: "Switzer 500 · 40/44 · -1.6px", sample: "$29" },
];

const SPACING: [string, string, string][] = [
  ["--container", "1300px", "section content width (13 elements measured at exactly 1300)"],
  ["--container-nav", "1220px", "navbar and footer boxes"],
  ["--page-gutter", "40px → 20px", "horizontal page padding; 20px at 390"],
  ["--section-y", "100px", "Container padding top and bottom"],
  ["--hero-top", "150px", "home header top padding (150px 40px 100px)"],
  ["--stack-gap", "50px", "heading block → content"],
  ["--heading-gap", "15px", "tag → heading → lede"],
  ["--card-gap", "10px", "between sibling cards (144 elements)"],
  ["--shell-pad", "7px", "dashed shell inset"],
  ["--nav-pad-y", "15px", "navigation frame vertical padding"],
];

const RADII: [string, string, string][] = [
  ["--radius-card", "10px", "cards (262)"], ["--radius-shell", "15px", "dashed shells (104)"], ["--radius-tag", "30px", "section tags, small badges (171)"],
  ["--radius-pill", "35px", "buttons (64)"], ["--radius-badge", "31px", "button icon badge (46)"], ["--radius-round", "50px", "avatars, navbar (90)"],
  ["--radius-input", "40px", "email input (15)"], ["--radius-icon", "20px", "check circles (75)"], ["--radius-8", "8px", "UI mock chips (41)"], ["--radius-11", "11px", "(30)"],
];

const SHADOWS: [string, string][] = [
  ["--shadow-inset-1", "1px inset ring, black (30 elements: UI mock chips)"],
  ["--shadow-float", "three-layer soft float (15: calculator, contact form)"],
  ["--shadow-card", "2/6/15px stack (2: hero UI card)"],
  ["--shadow-badge", "0 2px 6px rgba(0,0,0,.3) (2)"],
];

const MOTION: [string, string][] = [
  ["--ease", "cubic-bezier(0.44, 0, 0.56, 1), the only curve in the CSS"],
  ["--duration-color", "0.4s (35 elements: nav links, text colour)"],
  ["--duration-bg", "0.5s (15 elements: button background + box-shadow)"],
  ["appear", "spring: stiffness 320, damping 60, mass 1; y 40px → 0, opacity 0 → 1; hero stagger 0.2 / 0.3 / 0.5 / 0.7 / 0.9s; scroll sections 0.2s, once"],
  ["backdrop", "blur(10px) navbar · blur(5px) glass chips · blur(2.5px) soft"],
];

const Swatch = ({ v }: { v: string }) => <span className="inline-block w-12 h-12 rounded-[10px] shrink-0" style={{ background: `var(${v})`, border: "1px solid var(--color-border-3)" }} />;

export default function DesignSystem() {
  return (
    <div style={{ maxWidth: 1300, margin: "0 auto", padding: "60px var(--page-gutter) 120px" }}>
      <p className="t-small" style={{ color: "var(--color-brand)" }}>Phase 1 · design tokens</p>
      <h1 className="t-h1" style={{ marginTop: 15 }}>Every token, rendered.</h1>
      <p className="t-main-soft" style={{ marginTop: 15, maxWidth: 640 }}>Values are computed styles from the reference at 1440, 768 and 390. Sample strings are the reference's own copy. Compare against .recon/shots.</p>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Colour</h2>
      <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", marginTop: 50 }}>
        {COLORS.map(([v, hex, note]) => (
          <div key={v} className="flex items-center gap-4 rounded-[10px] p-4" style={{ background: "var(--color-card-1)", border: "var(--dash)" }}>
            <Swatch v={v} />
            <div><div className="t-small-b">{v}</div><div className="t-small" style={{ marginTop: 6, color: "var(--color-paragraph-soft)" }}>{hex}</div><div className="t-main-soft" style={{ fontSize: 13, lineHeight: "18px", marginTop: 4 }}>{note}</div></div>
          </div>
        ))}
      </div>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Type</h2>
      <div className="flex flex-col" style={{ marginTop: 50, borderTop: "var(--dash)" }}>
        {TYPE.map((t) => (
          <div key={t.cls} className="grid gap-6 py-6" style={{ gridTemplateColumns: "260px 1fr", borderBottom: "var(--dash)" }}>
            <div><div className="t-small-b">{t.role}</div><div className="t-main-soft" style={{ fontSize: 13, lineHeight: "18px", marginTop: 6 }}>{t.spec}</div><div className="t-small" style={{ marginTop: 6, color: "var(--color-brand)" }}>.{t.cls}</div></div>
            <div className={t.cls}>{t.sample}</div>
          </div>
        ))}
      </div>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Fonts on disk</h2>
      <p className="t-main-soft" style={{ marginTop: 15 }}>46 files in public/assets/fonts, declared with the reference's own unicode ranges. Faces the reference actually renders:</p>
      <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", marginTop: 30 }}>
        {[["Libre Caslon Condensed", "400 · 500 · 600", "serif"], ["Public Sans", "400 · 500 · 600 · 700 (+ italics, 900)", "sans"], ["Switzer", "500", "price"], ["Inter", "400 · 500 · 600 · 700", "nav"]].map(([f, w, v]) => (
          <div key={f} className="rounded-[10px] p-5" style={{ background: "var(--color-card-2)", border: "var(--dash)" }}>
            <div style={{ fontFamily: `var(--font-${v})`, fontSize: 28, lineHeight: "32px", color: "var(--color-heading)" }}>{f}</div>
            <div className="t-small" style={{ marginTop: 10, color: "var(--color-paragraph-soft)" }}>{w}</div>
            <div style={{ fontFamily: `var(--font-${v})`, marginTop: 12, fontSize: 16, lineHeight: "22px" }}>The quick brown fox jumps over the lazy dog 0123456789</div>
          </div>
        ))}
      </div>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Spacing and container</h2>
      <table className="w-full" style={{ marginTop: 50, borderTop: "var(--dash)" }}>
        <tbody>{SPACING.map(([v, val, note]) => (
          <tr key={v} style={{ borderBottom: "var(--dash)" }}><td className="t-small-b py-4 pr-6" style={{ width: 220 }}>{v}</td><td className="t-main py-4 pr-6" style={{ width: 140 }}>{val}</td><td className="t-main-soft py-4">{note}</td></tr>
        ))}</tbody>
      </table>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Radii</h2>
      <div className="flex flex-wrap gap-[10px]" style={{ marginTop: 50 }}>
        {RADII.map(([v, val, note]) => (
          <div key={v} className="flex items-center gap-4 p-4" style={{ background: "var(--color-card-1)", border: "var(--dash)", borderRadius: `var(${v})`, minWidth: 280 }}>
            <span className="inline-block w-12 h-12 shrink-0" style={{ background: "var(--color-card-3)", borderRadius: `var(${v})` }} />
            <div><div className="t-small-b">{v}</div><div className="t-main-soft" style={{ fontSize: 13, lineHeight: "18px", marginTop: 4 }}>{val} · {note}</div></div>
          </div>
        ))}
      </div>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Borders, shadows, blur</h2>
      <div className="grid gap-[10px]" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", marginTop: 50 }}>
        <div className="rounded-[15px] p-[7px]" style={{ border: "var(--dash)" }}><div className="rounded-[10px] p-5" style={{ background: "var(--color-card-1)", border: "var(--dash)" }}><div className="t-small-b">--dash</div><div className="t-main-soft" style={{ fontSize: 13, lineHeight: "18px", marginTop: 4 }}>1px dashed #d6d0c8 · shell 15px / 7px / card 10px</div></div></div>
        {SHADOWS.map(([v, note]) => (
          <div key={v} className="rounded-[10px] p-5" style={{ background: "var(--color-card-2)", boxShadow: `var(${v})` }}><div className="t-small-b">{v}</div><div className="t-main-soft" style={{ fontSize: 13, lineHeight: "18px", marginTop: 4 }}>{note}</div></div>
        ))}
        <div className="relative rounded-[10px] overflow-hidden" style={{ minHeight: 120 }}>
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, #f24100, #1a1a1a)" }} />
          <div className="absolute inset-4 rounded-[10px] p-4" style={{ backdropFilter: "blur(var(--blur-nav))", background: "rgba(247,245,243,.6)" }}><div className="t-small-b">--blur-nav</div><div className="t-main-soft" style={{ fontSize: 13, lineHeight: "18px", marginTop: 4 }}>blur(10px) · navbar after scroll</div></div>
        </div>
      </div>

      <h2 className="t-h2" style={{ marginTop: 100 }}>Motion</h2>
      <table className="w-full" style={{ marginTop: 50, borderTop: "var(--dash)" }}>
        <tbody>{MOTION.map(([v, note]) => (
          <tr key={v} style={{ borderBottom: "var(--dash)" }}><td className="t-small-b py-4 pr-6 align-top" style={{ width: 220 }}>{v}</td><td className="t-main-soft py-4">{note}</td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}
