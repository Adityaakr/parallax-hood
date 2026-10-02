"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ApiError } from "@/lib/api";

export const Dot = ({ kind }: { kind: "good" | "warn" | "bad" | "muted" }) => <span className={`dot dot-${kind}`} />;
export const Tag = ({ children }: { children: ReactNode }) => <span className="tag">{children}</span>;

export function Banner({ kind = "info", children }: { kind?: "info" | "warn" | "bad" | "good"; children: ReactNode }) {
  return <div className={`banner ${kind === "info" ? "" : `banner-${kind}`}`}>{children}</div>;
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-5" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: ApiError | Error | null; retry?: () => void }) {
  if (!error) return null;
  const status = (error as ApiError).status;
  const unreachable = status === 0;
  const unconfigured = status === -1;
  return (
    <Banner kind={unconfigured ? "warn" : "bad"}>
      <div className="font-medium">{unconfigured ? "No resolver for this network yet" : unreachable ? "Resolver unreachable" : "Request failed"}</div>
      <div className="muted mt-1 break-words">{unconfigured ? "This network has no resolver deployment configured. Switch to a network that does (sidebar, top-left) or configure NEXT_PUBLIC_RESOLVER_URLS." : error.message}</div>
      {unreachable && <div className="muted mt-1">Start it with <code className="mono">pnpm --filter @parallax-hood/resolver dev</code> or switch network in the sidebar.</div>}
      {retry && (
        <button className="btn mt-2" onClick={retry}>
          Retry
        </button>
      )}
    </Banner>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="card p-6 text-center muted text-sm">{children}</div>;
}

export function Stat({ label, value, sub, mono = true }: { label: string; value: ReactNode; sub?: ReactNode; mono?: boolean }) {
  return (
    <div className="kpi">
      <div className="kpi-label">{label}</div>
      <div className={`kpi-value ${mono ? "num" : ""}`}>{value}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </div>
  );
}

export function PlatformTag({ platform }: { platform: string }) {
  return <Tag>{platform === "bstock" ? "bStocks" : platform === "ondo" ? "Ondo" : platform}</Tag>;
}

export function AttestationDot({ hours }: { hours: number | null }) {
  const kind = hours === null ? "muted" : hours <= 24 ? "good" : hours <= 36 ? "warn" : "bad";
  return <Dot kind={kind} />;
}

export function Disclaimer() {
  return (
    <p className="text-xs muted leading-relaxed">
      Not investment advice. Tokenized stock availability depends on your jurisdiction and each issuer&apos;s terms; you are responsible for your eligibility.
      Prices, premiums and NAV are informational. Backing is measured in underlying shares, never in USD.
    </p>
  );
}

export const A = ({ href, children }: { href: string; children: ReactNode }) =>
  href.startsWith("http") ? (
    <a className="link" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <Link className="link" href={href}>
      {children}
    </Link>
  );
