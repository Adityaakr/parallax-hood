"use client";
/*
 * Navbar: Navigation frame 15px 40px; the pill is 1220 × 62, padding 8, gap 15, radius 50. Its Background
 * (page colour, dashed border, blur 10) sits at opacity 0 until the page scrolls, then fades in over 0.5s.
 * Menu items are Public Sans 600 16/17.6 with 5px dots between them. Below 1024 the menu collapses behind a
 * 38px dashed circle; open, the links stack vertically with dots and a full-width dotted Get started.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { NAV } from "@/content/site";
import { Button, SPRING } from "./ui";

/** `items` / `cta` let the product shell reuse the same navbar with its own links. */
export function Navbar({ items = NAV.items, cta = NAV.cta, logo = NAV.logo }: { items?: { label: string; href: string }[]; cta?: { label: string; href: string } | null; logo?: { src: string; alt: string; text: string; href: string } } = {}) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 10);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const drop = (delay: number) => reduce ? {} : { initial: { opacity: 0, y: -20 }, animate: { opacity: 1, y: 0, transition: { ...SPRING, delay } } };
  return (
    <header className="navwrap">
      <motion.nav {...drop(0)} className={`nav${scrolled ? " scrolled" : ""}${open ? " open" : ""}`} aria-label="Main">
        <span className="bg" aria-hidden />
        {/* wordmark only: the icon tile was dropped 22 Sep 2026 */}
        <Link href={logo.href} className="logo" aria-label={logo.text}>
          <span className="t-logo">{logo.text}</span>
        </Link>
        <div className="menu">
          {items.map((it, i) => (
            <span key={it.label} className="flex items-center gap-[15px]">
              {i > 0 && <i aria-hidden />}
              <Link href={it.href}>{it.label}</Link>
            </span>
          ))}
        </div>
        {cta && <div className="cta"><Button href={cta.href}>{cta.label}</Button></div>}
        <button className="burger" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><i /><i /></button>
        <div className="mobile">
          {items.map((it, i) => (
            <span key={it.label} className="contents">
              {i > 0 && <i aria-hidden />}
              <Link href={it.href} onClick={() => setOpen(false)}>{it.label}</Link>
            </span>
          ))}
          {cta && <Button href={cta.href} full dots>{cta.label}</Button>}
        </div>
      </motion.nav>
    </header>
  );
}
