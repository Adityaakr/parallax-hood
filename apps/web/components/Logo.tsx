/* Wordmark in the template's logo layout: a square ink tile carrying the mark, then the name. The three
   descending bars are the same stock seen through three issuers, which is what the product is about. */
export function Logo({ light = false, size = 34 }: { light?: boolean; size?: number }) {
  return (
    <span className="inline-flex items-center gap-3 font-medium" style={{ color: light ? "#fff" : "var(--fg)", fontSize: 17, letterSpacing: "-0.025em" }}>
      <span className="inline-flex items-center justify-center shrink-0" style={{ width: size, height: size, borderRadius: size * 0.22, background: "var(--ink)" }}>
        <svg width={size * 0.5} height={size * 0.45} viewBox="0 0 28 24" aria-hidden>
          <rect x="1" y="2" width="6" height="20" rx="1" fill="var(--brand)" />
          <rect x="11" y="6" width="6" height="12" rx="1.5" fill="#fff" opacity=".85" />
          <rect x="21" y="9" width="6" height="6" rx="1.5" fill="#fff" opacity=".5" />
        </svg>
      </span>
      Parallax
    </span>
  );
}
