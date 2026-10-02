"use client";
/* The search engine: one box, every tokenized stock on BSC, and the best price across all of its issuers. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, type StocksResponse } from "@/lib/api";
import { Loading, ErrorState, Dot, PlatformTag } from "@/components/ui";
import { usd, bps } from "@/lib/format";
import { Ic } from "@/components/app/icons";
import { StockLogo } from "@/components/app/StockLogo";

const issuerName = (p: string) => (p === "bstock" ? "bStocks" : p === "ondo" ? "Ondo" : p === "xstock" ? "xStocks" : p);

export default function Stocks() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const stocks = useApi<StocksResponse>("/stocks", { refetchInterval: 30_000 });
  const tickers = useMemo(() => stocks.data?.stocks.map((s) => s.ticker) ?? [], [stocks.data]);
  /**
   * Indicative price per underlying share, straight from the catalogue: each issuer's live token price divided
   * by its shares-per-token ratio. Instant for the whole list; the executable quote lives on the stock page.
   */
  const indicative = useMemo(() => {
    const out: Record<string, { symbol: string; platform: string; perShare: number; spreadBps: number | null; quoted: number }> = {};
    for (const s of stocks.data?.stocks ?? []) {
      const priced = s.representations
        .map((r) => {
          const px = Number(r.binance?.tokenPrice ?? 0);
          const ratio = Number(r.ratio) / 1e18;
          return px > 0 && ratio > 0 ? { symbol: r.symbol, platform: r.platform, perShare: px / ratio } : null;
        })
        .filter((x): x is { symbol: string; platform: string; perShare: number } => x !== null)
        .sort((a, b) => a.perShare - b.perShare);
      const best = priced[0];
      if (!best) continue;
      const second = priced[1];
      out[s.ticker] = { ...best, quoted: priced.length, spreadBps: second ? Math.round(((second.perShare - best.perShare) / best.perShare) * 10_000) : null };
    }
    return out;
  }, [stocks.data]);
  const pricing = stocks.isLoading;

  const rows = (stocks.data?.stocks ?? []).filter((s) => !q.trim() || s.ticker.toLowerCase().includes(q.trim().toLowerCase()) || s.representations.some((r) => r.symbol.toLowerCase().includes(q.trim().toLowerCase())));
  const issuers = Array.from(new Set((stocks.data?.stocks ?? []).flatMap((s) => s.representations.map((r) => r.platform))));
  const reps = (stocks.data?.stocks ?? []).reduce((n, s) => n + s.representations.length, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- search ---------- */}
      <section className="panel">
        <div className="panel-body flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="h4">Search tokenized stocks</h1>
              <p className="body-md muted mt-1">One stock can exist as several tokens from different issuers. Search once; Parallax prices every one of them and routes your order to the best.</p>
            </div>
            <div className="flex gap-2">
              <span className="chip"><Ic.layers width={14} height={14} />{reps} representations</span>
              <span className="chip"><Ic.shield width={14} height={14} />{issuers.map(issuerName).join(" · ") || "issuers"}</span>
            </div>
          </div>
          <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); const t = q.trim().toUpperCase(); if (t) router.push(`/buy/${t}`); }}>
            <div className="search flex-1" style={{ padding: "12px 15px" }}>
              <span className="muted"><Ic.search /></span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a stock or token, e.g. NVDA, TSLA, NVDAB" aria-label="Search a stock" style={{ fontSize: 16 }} />
            </div>
            <button className="btn btn-primary btn-lg" type="submit">Get best price</button>
          </form>
        </div>
      </section>

      {/* ---------- results ---------- */}
      <section className="panel">
        <div className="panel-head">
          <span>{q.trim() ? `Results for “${q.trim()}”` : "All stocks on BNB Chain"}</span>
          
          <span className="body-sm muted">{pricing ? "pricing every issuer…" : stocks.data ? (stocks.data.dataSource === "live" ? "live" : "onchain live · Binance fields from fixtures") : ""}</span>
        </div>
        {stocks.isLoading && <div className="p-5"><Loading rows={4} /></div>}
        <div className="px-5"><ErrorState error={stocks.error} retry={() => stocks.refetch()} /></div>
        {stocks.data && rows.length === 0 && <div className="p-8 text-center muted">No stock matches “{q}”. The registry currently holds {tickers.join(", ")}.</div>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr><th>Stock</th><th>Best / share</th><th>vs reference</th><th>Cheapest issuer</th><th>Issuers</th><th>Market</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const b = indicative[s.ticker];
                  return (
                    <tr key={s.ticker} className="cursor-pointer" onClick={() => router.push(`/buy/${s.ticker}`)}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <StockLogo ticker={s.ticker} src={s.logoUrl} size={28} />
                          <span>
                            <span className="font-medium">{s.ticker}</span>
                            <span className="block body-xs muted">{s.name ? `${s.name} · ` : ""}reference {usd(s.referencePrice)}</span>
                          </span>
                        </span>
                      </td>
                      <td className="num">{b ? <span className="font-medium">{usd(b.perShare, 2)}</span> : pricing ? <span className="skeleton inline-block w-20 h-4" /> : "n/a"}</td>
                      <td className="num">{(() => {
                        const ref = Number(s.referencePrice ?? 0);
                        if (!b || !ref) return "n/a";
                        const d = Math.round(((b.perShare - ref) / ref) * 10_000);
                        return <span className="inline-flex items-center gap-1" style={{ color: d <= 0 ? "var(--good)" : undefined }}>{d <= 0 ? <Ic.up width={14} height={14} /> : <Ic.down width={14} height={14} />}{bps(d)}</span>;
                      })()}</td>
                      <td>{b ? <span className="flex items-center gap-2"><span className="font-medium">{b.symbol}</span><PlatformTag platform={b.platform} /></span> : "n/a"}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {s.representations.map((r) => (
                            <span key={r.token} className={`tag ${b && r.symbol === b.symbol ? "tag-blue" : ""}`} title={`${issuerName(r.platform)} · ${r.buyEligible ? "buy-eligible" : "not buy-eligible right now"}`}>
                              {r.symbol}
                            </span>
                          ))}
                          {b?.spreadBps ? <span className="body-xs muted">{b.spreadBps} bps apart</span> : null}
                        </span>
                      </td>
                      <td className="body-sm">{s.market.open ? "open" : "closed"}</td>
                      <td className="text-right"><Link className="btn btn-sm" href={`/buy/${s.ticker}`} onClick={(e) => e.stopPropagation()}>Buy</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="px-5 py-4 border-t line body-xs muted">
Prices here are indicative: each issuer's live token price divided by its shares-per-token ratio, so they are comparable per underlying share. Open a stock for the executable quote: venue fees, slippage and gas included, with the reason any route was excluded.
        </div>
      </section>

      {/* ---------- baskets teaser ---------- */}
      <section className="grid md:grid-cols-3 gap-4">
        {[
          ["Curated baskets", "One unit is a fixed number of shares per stock, and every constituent is bought through its best issuer. Backing ≥ 1.00 is enforced onchain.", "/baskets", "Browse baskets"],
          ["Proof for every fill", "Each fill emits a receipt whose quote hash opens the full scoring record: candidates, premiums, attestation ages and the policy.", "/receipts", "Open receipts"],
          ["Let an agent trade", "Give an agent key per-transaction and daily caps, an expiry and an allowlist. Outputs go to you; revocation is instant.", "/mandates", "Create a mandate"],
        ].map(([title, text, href, cta]) => (
          <div key={title} className="panel p-5 flex flex-col gap-2">
            <div className="body-md font-medium">{title}</div>
            <p className="body-sm muted flex-1">{text}</p>
            <Link className="link body-sm" href={href}>{cta} →</Link>
          </div>
        ))}
      </section>
    </div>
  );
}
