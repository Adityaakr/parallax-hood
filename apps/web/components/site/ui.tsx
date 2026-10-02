"use client";
/*
 * Primitives shared by every reconstructed section. Each maps to a component in the Framer project and
 * carries that component's measured frame (see app/components.css). Motion values are the project's own
 * appear effect: opacity 0 + y 40 on spring-physics stiffness 320, damping 60, mass 1.
 */
import Link from "next/link";
import Image from "next/image";
import { useEffect, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { motion, useInView, useReducedMotion, animate } from "framer-motion";

export const SPRING = { type: "spring", stiffness: 320, damping: 60, mass: 1 } as const;

/** Appear effect. `mount` = trigger onMount (hero); otherwise onScrollTarget once, at threshold 0.5. */
export function Reveal({ children, delay = 0, mount = false, className, style, as = "div" }: { children: ReactNode; delay?: number; mount?: boolean; className?: string; style?: CSSProperties; as?: "div" | "section" }) {
  const reduce = useReducedMotion();
  const M = as === "section" ? motion.section : motion.div;
  if (reduce) return as === "section" ? <section className={className} style={style}>{children}</section> : <div className={className} style={style}>{children}</div>;
  const anim = { opacity: 1, y: 0, transition: { ...SPRING, delay } };
  // onMount reveals run as a CSS animation (see .appear in components.css) so they start the moment the
  // stylesheet lands, before hydration; the curve approximates the same overdamped spring
  if (mount) {
    const Tag = as;
    return <Tag className={`appear ${className ?? ""}`} style={{ ...style, animationDelay: `${delay}s` }}>{children}</Tag>;
  }
  return <M className={className} style={style} initial={{ opacity: 0, y: 40 }} whileInView={anim} viewport={{ once: true, amount: 0.5 }}>{children}</M>;
}

/** Section Tag: a barcode of nine 2×9 bars, the first `on` of them brand-orange, then the label. */
export function Tag({ children, on = 1 }: { children: ReactNode; on?: number }) {
  return (
    <span className="tag">
      <span className="bars" aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} className={i < on ? "on" : ""} />)}</span>
      <span className="t-small" style={{ color: "var(--color-heading)" }}>{children}</span>
    </span>
  );
}

const isExternal = (href: string) => /^(https?:|mailto:)/.test(href);
const A = ({ href, className, children, ...rest }: { href: string; className?: string; children: ReactNode; [k: string]: unknown }) =>
  isExternal(href) ? <a href={href} className={className} target="_blank" rel="noreferrer" {...rest}>{children}</a> : <Link href={href} className={className} {...rest}>{children}</Link>;

/** Button Primary. `dots` swaps the arrow for the 3×3 matrix the full-width variants carry. */
export function Button({ href, children, secondary = false, full = false, dots = false, type, onClick }: { href?: string; children: ReactNode; secondary?: boolean; full?: boolean; dots?: boolean; type?: "submit" | "button"; onClick?: () => void }) {
  const cls = `btn${secondary ? " secondary" : ""}${full ? " full" : ""}`;
  const inner = (
    <>
      <span className="label"><span>{children}</span><span aria-hidden>{children}</span></span>
      <span className="space" />
      <span className="iconwrap" aria-hidden>{dots ? <span className="dots">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</span> : <><i /><i /></>}</span>
    </>
  );
  if (!href) return <button type={type ?? "button"} className={cls} onClick={onClick}>{inner}</button>;
  return <A href={href} className={cls}>{inner}</A>;
}

export const Icon = ({ name, size = 20, alt = "" }: { name: string; size?: number; alt?: string }) => (
  <Image src={`/assets/icons/${name}.svg`} alt={alt} width={size} height={size} style={{ width: size, height: size }} unoptimized />
);

/** Features Item: check + text. `ring` puts the check in the 22px dashed circle (plans / feature lists). */
export const Feat = ({ children }: { children: ReactNode }) => (
  <div className="feat"><Icon name="check" size={16} /><span className="t-main">{children}</span></div>
);

export const Bars = ({ on = 1 }: { on?: number }) => (
  <span className="bars" style={{ display: "inline-flex", gap: 2 }} aria-hidden>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ display: "block", width: 2, height: 9, background: i < on ? "var(--color-brand)" : "rgba(0,0,0,0.15)" }} />)}</span>
);

/** Metrics Card counter: counts from 0 to `end` when the card scrolls into view. */
export function Counter({ end, decimals = 0, symbol = "" }: { end: number; decimals?: number; symbol?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduce = useReducedMotion();
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    if (reduce) { setV(end); return; }
    const c = animate(0, end, { duration: 1, ease: "easeOut", onUpdate: setV }); // reference settles in ~1s
    return () => c.stop();
  }, [inView, end, reduce]);
  return <span ref={ref}>{v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{symbol}</span>;
}

/** Logos: 200×100 tiles, duplicated for a seamless loop. */
export function LogoRail({ items, caption }: { items: { src: string; w: number; h: number; label?: string }[]; caption: string }) {
  return (
    <div className="flex flex-col items-center gap-[30px] w-full">
      <span className="t-small" style={{ color: "var(--color-heading)" }}>{caption}</span>
      <div className="shell w-full overflow-hidden">
        <div className="logos">
          {[...items, ...items].map((l, i) => (
            <div key={i} className="flex items-center gap-[12px]">
              {l.src ? <Image src={l.src} alt="" width={l.w} height={l.h} unoptimized style={{ borderRadius: 8 }} /> : null}
              {l.label ? <span className="t-logo">{l.label}</span> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { A };
