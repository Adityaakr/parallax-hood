"use client";
/*
 * Product shell: a left rail that stays put, a toolbar across the top of the page, then the page.
 *
 * The app moved off the marketing navbar because a product is navigated, not read: six destinations in a
 * horizontal strip make you re-read the row every time, while a column holds its order and shows where you
 * are. The rail collapses to icons for anyone who already knows the shape, and the choice is remembered.
 * Everything else is the site's own language, the sand field, the dashed rules and the same type.
 */
import "./app.css";
import "../../app/components.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNetwork } from "@/lib/network";
import { NETWORKS } from "@/lib/config";
import { Ic } from "./icons";
import { Faucet } from "./Faucet";
import { WalletRow } from "./Wallet";

const NAV: { label: string; icon: keyof typeof Ic; href: string; match: string[] }[] = [
  { label: "Search stocks", icon: "search", href: "/stocks", match: ["/stocks", "/buy"] },
  { label: "Indices", icon: "layers", href: "/baskets", match: ["/baskets"] },
  { label: "Portfolio", icon: "pie", href: "/portfolio", match: ["/portfolio"] },
  { label: "Activity", icon: "file", href: "/receipts", match: ["/receipts"] },
  { label: "Agents", icon: "spark", href: "/mandates", match: ["/mandates"] },
  { label: "In detail", icon: "info", href: "/how-it-works", match: ["/how-it-works"] },
];

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const { chainId } = useNetwork();
  const [q, setQ] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("parallax:rail") === "icons");
    } catch {
      /* private window: the rail just starts open */
    }
  }, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); search.current?.focus(); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);
  const toggle = () => {
    setCollapsed((v) => {
      try { localStorage.setItem("parallax:rail", v ? "labels" : "icons"); } catch { /* ignore */ }
      return !v;
    });
  };

  return (
    <div className="app-canvas app-shell" data-collapsed={collapsed || undefined}>
      <aside className="rail">
        <Link href="/" className="rail-brand" title="Parallax home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/parallax-icon.svg" alt="" width={26} height={26} />
          <span className="rail-word">Parallax</span>
        </Link>

        <nav className="rail-nav">
          {NAV.map((item) => {
            const Icon = Ic[item.icon];
            const on = item.match.some((m) => path === m || path.startsWith(`${m}/`));
            return (
              <Link key={item.href} href={item.href} className="rail-item" data-on={on || undefined} title={item.label}>
                <span className="rail-icon"><Icon width={17} height={17} /></span>
                <span className="rail-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="rail-foot">
          <Link href="/blog" className="rail-item" title="Build notes">
            <span className="rail-icon"><Ic.chart width={17} height={17} /></span>
            <span className="rail-label">Build notes</span>
          </Link>
          <button className="rail-item" onClick={toggle} title={collapsed ? "Expand" : "Collapse"} type="button">
            <span className="rail-icon" style={{ transform: collapsed ? "rotate(180deg)" : undefined }}><Ic.chevrons width={17} height={17} style={{ transform: "rotate(90deg)" }} /></span>
            <span className="rail-label">Collapse</span>
          </button>
        </div>
      </aside>

      <div className="app-body">
        <div className="toolbar">
          {/* one network: the contracts are on BSC mainnet, so there is nothing to switch between */}
          <span className="ws" title="Parallax runs on BNB Smart Chain">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/badge-bnb.svg" alt="" width={26} height={26} className="ws-tile" style={{ background: "transparent" }} />
            <span className="body-sm font-medium truncate">{NETWORKS[chainId].name}</span>
          </span>
          <form className="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) { router.push(`/buy/${q.trim().toUpperCase()}`); setQ(""); } }}>
            <span className="muted"><Ic.search /></span>
            <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a stock…" aria-label="Search a stock" />
            <kbd>⌘K</kbd>
          </form>
          <Faucet />
          <WalletRow />
        </div>

        {/* the rail is a column on a desktop and a scrolling strip under the toolbar on a phone */}
        <nav className="rail-strip">
          {NAV.map((item) => {
            const on = item.match.some((m) => path === m || path.startsWith(`${m}/`));
            return <Link key={item.href} href={item.href} className="preset" data-on={on || undefined}>{item.label}</Link>;
          })}
        </nav>

        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
