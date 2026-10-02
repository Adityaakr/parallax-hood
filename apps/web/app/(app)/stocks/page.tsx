"use client";
/* The stock list: every Robinhood stock token the registry holds, quoted per underlying share. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useApi, type StocksResponse } from "@/lib/api";
import { LIST_QUOTE_USD, useBestRoutes } from "@/lib/best";
import { Loading, ErrorState, PlatformTag } from "@/components/ui";
import { usd, bps, compactUsd, usdgNumber, venueName, platformName } from "@/lib/format";
import { Ic } from "@/components/app/icons";
import { StockLogo } from "@/components/app/StockLogo";

export default function Stocks() {
  const [q, setQ] = useState("");
  const router = useRouter();
  const stocks = useApi<StocksResponse>("/stocks", { refetchInterval: 30_000 });
  const tickers = useMemo(() => stocks.data?.stocks.map((s) => s.ticker) ?? [], [stocks.data]);
  /* an executable quote per ticker at one standard order size, in dollars per underlying share */
  const { best, loading: pricing } = useBestRoutes(tickers);

  const needle = q.trim().toLowerCase();
  const rows = (stocks.data?.stocks ?? []).filter((s) => !needle || s.ticker.toLowerCase().includes(needle) || (s.name ?? "").toLowerCase().includes(needle) || s.representations.some((r) => r.symbol.toLowerCase().includes(needle)));
  const issuers = Array.from(new Set((stocks.data?.stocks ?? []).flatMap((s) => s.representations.map((r) => r.platform))));
  const reps = (stocks.data?.stocks ?? []).reduce((n, s) => n + s.representations.length, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- search ---------- */}
      <section className="panel">
        <div className="panel-body flex flex-col gap-5">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="h4">Search stock tokens</h1>
              <p className="body-md muted mt-1">A stock token is not always one share: its on-chain multiplier says how many shares one token stands for. Parallax quotes every token per underlying share, against the Uniswap v3 pools on the chain.</p>
            </div>
            <div className="flex gap-2">
              <span className="chip"><Ic.layers width={14} height={14} />{stocks.data ? `${reps} token${reps === 1 ? "" : "s"}` : "tokens"}</span>
              <span className="chip"><Ic.shield width={14} height={14} />{issuers.map(platformName).join(" · ") || "issuer"}</span>
            </div>
          </div>
          <form className="flex gap-3" onSubmit={(e) => { e.preventDefault(); const t = q.trim().toUpperCase(); if (t) router.push(`/buy/${t}`); }}>
            <div className="search flex-1" style={{ padding: "12px 15px" }}>
              <span className="muted"><Ic.search /></span>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a stock by ticker or name" aria-label="Search a stock" style={{ fontSize: 16 }} />
            </div>
            <button className="btn btn-primary btn-lg" type="submit">Get a quote</button>
          </form>
        </div>
      </section>

      {/* ---------- results ---------- */}
      <section className="panel">
        <div className="panel-head">
          <span>{q.trim() ? `Results for “${q.trim()}”` : "Stocks on this network"}</span>
          <span className="body-sm muted">{pricing ? "quoting every stock…" : stocks.data ? (stocks.data.dataSource === "live" ? "read from the chain" : "mock tokens and mock prices") : ""}</span>
        </div>
        {stocks.isLoading && <div className="p-5"><Loading rows={4} /></div>}
        <div className="px-5"><ErrorState error={stocks.error} retry={() => stocks.refetch()} /></div>
        {stocks.data && rows.length === 0 && <div className="p-8 text-center muted">No stock matches “{q}”. The registry currently holds {tickers.join(", ")}.</div>}
        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="grid">
              <thead>
                <tr><th>Stock</th><th>Reference</th><th>Quote / share</th><th>vs reference</th><th>Venue</th><th>Pool depth</th><th>Shares / token</th><th>Market</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const b = best[s.ticker];
                  const depth = s.representations.reduce((a, r) => a + usdgNumber(r.poolUsdg), 0);
                  const tiers = Array.from(new Set(s.representations.flatMap((r) => r.poolFees ?? []))).sort((x, y) => x - y);
                  return (
                    <tr key={s.ticker} className="cursor-pointer" onClick={() => router.push(`/buy/${s.ticker}`)}>
                      <td>
                        <span className="flex items-center gap-2.5">
                          <StockLogo ticker={s.ticker} src={s.logoUrl} size={28} />
                          <span>
                            <span className="font-medium">{s.ticker}</span>
                            <span className="block body-xs muted">{s.name ?? ""}</span>
                          </span>
                        </span>
                      </td>
                      <td className="num" title={s.referenceSource}>{usd(s.referencePrice)}</td>
                      <td className="num">{b ? <span className="font-medium">{usd(b.costPerShareUsd, 2)}</span> : pricing ? <span className="skeleton inline-block w-20 h-4" /> : "n/a"}</td>
                      <td className="num">{b ? <span className="inline-flex items-center gap-1" style={{ color: b.premiumBps <= 0 ? "var(--good)" : undefined }}>{b.premiumBps <= 0 ? <Ic.up width={14} height={14} /> : <Ic.down width={14} height={14} />}{bps(b.premiumBps)}</span> : "n/a"}</td>
                      <td className="body-sm whitespace-nowrap">{b ? venueName(b.venue) : "n/a"}</td>
                      <td className="num whitespace-nowrap" title={tiers.length ? `USDG in this token's direct Uniswap v3 pools, fee tiers ${tiers.map((f) => `${f / 10_000}%`).join(", ")}` : "no direct Uniswap v3 pool on this network"}>{depth > 0 ? compactUsd(depth) : "n/a"}</td>
                      <td>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {s.representations.map((r) => (
                            <span key={r.token} className="inline-flex items-center gap-1.5" title={`${r.symbol} · ${platformName(r.platform)} · ${r.buyEligible ? "buy-eligible" : "not buy-eligible right now"}`}>
                              <span className="num">{(Number(r.ratio) / 1e18).toFixed(6)}</span>
                              <PlatformTag platform={r.platform} />
                            </span>
                          ))}
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
          Quote / share is the resolver&apos;s quote for a {usd(LIST_QUOTE_USD, 0)} USDG buy, per underlying share, with venue fees, price impact and gas included. Pool depth is the USDG held in the token&apos;s direct Uniswap v3 pools. Open a stock for a quote at your own size and the reason any route was excluded.
        </div>
      </section>

      {/* ---------- where next ---------- */}
      <section className="grid md:grid-cols-3 gap-4">
        {[
          ["Indices", "One unit is a fixed number of shares per stock, bought with USDG. The vault checks that backing after every mint, and redeeming in kind cannot be paused.", "/baskets", "Browse indices"],
          ["A receipt for every fill", "Each fill emits a receipt whose quote hash opens the full scoring record: the candidates, their cost per share and the policy applied.", "/receipts", "Open receipts"],
          ["Let an agent trade", "Give an agent key per-transaction and daily caps, an expiry and an allowlist. Outputs go to you, and you can revoke at any time.", "/mandates", "Create a mandate"],
        ].map(([title, text, href, cta]) => (
          <div key={title} className="panel p-5 flex flex-col gap-2">
            <div className="body-md font-medium">{title}</div>
            <p className="body-sm muted flex-1">{text}</p>
            <Link className="link body-sm" href={href!}>{cta} →</Link>
          </div>
        ))}
      </section>
    </div>
  );
}
