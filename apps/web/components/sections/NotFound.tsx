import { NOT_FOUND } from "@/content/pages";
import { Reveal, Button } from "@/components/site/ui";
/** Error 404: centred heading and button in a section that stays tall (≈900px) above the footer. */
export function NotFoundContent() {
  return (
    <section id="Header" className="section">
      <div className="container" style={{ minHeight: 900, justifyContent: "center", alignItems: "center" }}>
        <div className="head center">
          <Reveal mount delay={0.2}><h1 className="t-h1">{NOT_FOUND.title}</h1></Reveal>
          <Reveal mount delay={0.4}><p className="t-main-soft" style={{ maxWidth: 330 }}>{NOT_FOUND.text}</p></Reveal>
          <Reveal mount delay={0.6} className="buttons justify-center"><Button href={NOT_FOUND.button.href}>{NOT_FOUND.button.label}</Button></Reveal>
        </div>
      </div>
    </section>
  );
}
