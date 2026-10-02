"use client";
import { useState } from "react";
import { stockLogo } from "@/lib/logos";

/**
 * Company mark for a ticker: the resolver's `logoUrl` when it sends one, else the local mark for that ticker
 * (lib/logos.ts), else a lettered tile. Robinhood's asset list gives its own feather for every token, so the
 * resolver sends none and the local marks are what is normally shown.
 */
export function StockLogo({ ticker, src, size = 28 }: { ticker: string; src?: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) } as const;
  src = src ?? stockLogo(ticker);
  if (!src || failed) {
    return (
      <span className="rounded-full inline-flex items-center justify-center text-white shrink-0 font-semibold" style={{ ...style, background: "var(--brand)" }}>
        {ticker.slice(0, 1)}
      </span>
    );
  }
  return (
    // a plain <img>: a local static file, or a remote one next/image would need a pattern for
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" width={size} height={size} onError={() => setFailed(true)} className="rounded-full shrink-0 object-cover bg-white" style={{ width: size, height: size, border: "0.5px solid var(--line)" }} />
  );
}
