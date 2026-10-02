"use client";
import { useState } from "react";

/**
 * Company mark from the Binance RWA catalogue, with a lettered fallback while it loads or when the catalogue
 * has no logo for that ticker.
 */
export function StockLogo({ ticker, src, size = 28 }: { ticker: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) } as const;
  if (!src || failed) {
    return (
      <span className="rounded-full inline-flex items-center justify-center text-white shrink-0 font-semibold" style={{ ...style, background: "var(--brand)" }}>
        {ticker.slice(0, 1)}
      </span>
    );
  }
  return (
    // the catalogue serves these from bnbstatic; next/image would need a remote pattern per host
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} className="rounded-full shrink-0 object-cover bg-white" style={{ width: size, height: size, border: "0.5px solid var(--line)" }} />
  );
}
