"use client";
/*
 * Product shell: a left rail that stays put, a toolbar across the top of the page, then the page.
 *
 * The app moved off the marketing navbar because a product is navigated, not read: six destinations in a
 * horizontal strip make you re-read the row every time, while a column holds its order and shows where you
 * are. The rail collapses to icons for anyone who already knows the shape, and the choice is remembered.
 * Everything else is the site's own language, the sand field, the dashed rules and the same type.
 *
 * Three things are on every product page because the shell owns them: which network this is and what kind
 * (from the resolver's own label), a standing banner when anything on that network is a mock, and the
 * eligibility notice. The first visit also has to pass the eligibility dialog before the app can be used.
 */
import "./app.css";
import "../../app/components.css";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNetworkLabel } from "@/lib/api";
import { Ic } from "./icons";
import { ELIGIBILITY_NOTICE, EligibilityDialog, useEligibility } from "./Eligibility";
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
  const { label, fromResolver } = useNetworkLabel();
  const { confirmed, confirm } = useEligibility();
  const locked = confirmed !== true;
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
      <aside className="rail" inert={locked}>
        <Link href="/" className="rail-brand" title="Parallax on Robinhood Chain, home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/parallax-icon.svg" alt="" width={26} height={26} />
          <span className="rail-word">Parallax<span className="rail-sub">on Robinhood Chain</span></span>
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

      <div className="app-body" inert={locked}>
        <div className="toolbar">
          {/* the network, named by the resolver that answers for it, and its kind in capitals so a test chain is never mistaken for the real one */}
          <span className="ws net" data-kind={label.kind} title={fromResolver ? `Chain id ${label.chainId}, as reported by the resolver` : `Chain id ${label.chainId}. The resolver is not answering, so this label comes from the app's own configuration.`}>
            <span className="net-dot" aria-hidden />
            <span className="body-sm font-medium truncate">{label.name}</span>
            <span className="tag net-kind">{label.kind}</span>
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

        {label.mocked.length > 0 && (
          <div className="mock-banner" role="note">
            <span className="tag net-kind">Mock data</span>
            <span>
              <b>Test network.</b> Mocked here: {label.mocked.join(", ")}. Nothing on this screen is a real market.
            </span>
          </div>
        )}

        <main className="app-main">{children}</main>

        <footer className="app-foot">
          <span>Parallax on Robinhood Chain</span>
          <span>{ELIGIBILITY_NOTICE}</span>
        </footer>
      </div>

      {confirmed === false && <EligibilityDialog onConfirm={confirm} />}
    </div>
  );
}
