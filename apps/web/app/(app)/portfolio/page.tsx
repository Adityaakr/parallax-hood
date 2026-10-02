"use client";
/*
 * Portfolio: everything this wallet holds, in the unit the product is denominated in.
 *
 * A stock position is underlying shares, counted across every issuer that represents it, so two tokens of the
 * same company add up instead of sitting in separate rows pretending to be different assets. An index position
 * is units and what those units are worth at the vault's own NAV. A position the resolver cannot price says so
 * rather than being valued at zero, and the total says how many are in that state.
 */
import Link from "next/link";
import { useAccount } from "wagmi";
import { useApi, useResolverConfigured, type WalletView } from "@/lib/api";
import { fmt, usd } from "@/lib/format";
import { Loading, ErrorState, Banner, PlatformTag, Empty } from "@/components/ui";
import { Page, PageHead } from "@/components/Page";
import { Ic } from "@/components/app/icons";
import { StockLogo } from "@/components/app/StockLogo";
import { TokenMark } from "@/components/app/TokenMark";
import { AddressLink } from "@/components/app/AddressLink";
import { WalletRow } from "@/components/app/Wallet";

export default function PortfolioPage() {
  const { address } = useAccount();
  const { network } = useResolverConfigured();
  const w = useApi<WalletView>(address ? `/wallet/${address}` : null, { refetchInterval: 30_000 });
  const d = w.data;
  const total = d ? Number(d.totals.portfolioUsd) : 0;
  const cash = d ? Number(d.totals.usdtUsd) : 0;
  /* one row per company, not per issuer: the shares of the same stock are the same claim */
  const byTicker = new Map<string, { ticker: string; logoUrl: string | null; name: string | null; shares: number; valueUsd: number | null; priceUsd: string | null; legs: WalletView["holdings"] }>();
  for (const h of d?.holdings ?? []) {
    const e = byTicker.get(h.ticker) ?? { ticker: h.ticker, logoUrl: h.logoUrl, name: h.name, shares: 0, valueUsd: 0 as number | null, priceUsd: h.priceUsd, legs: [] };
    e.shares += Number(h.shares) / 1e18;
    e.valueUsd = e.valueUsd === null || h.valueUsd === null ? null : e.valueUsd + Number(h.valueUsd);
    e.legs.push(h);
    byTicker.set(h.ticker, e);
  }
  const stocks = [...byTicker.values()].sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
  const indices = (d?.baskets ?? []).slice().sort((a, b) => Number(b.valueUsd ?? 0) - Number(a.valueUsd ?? 0));
  const empty = d && stocks.length === 0 && indices.length === 0;

  return (
    <Page>
      <PageHead
        eyebrow="Portfolio"
        title="What you hold"
        lede="Stock positions are counted in underlying shares across every issuer that represents them, index positions in units and in what those units are worth at the vault's own NAV. Values are live from the same sources the quotes use."
        right={address ? <div className="flex flex-col items-end gap-1"><span className="body-xs muted">Total value</span><span className="metric">{d ? usd(total) : "…"}</span></div> : undefined}
      />

      {!address && (
        <div className="panel p-6 flex flex-col items-start gap-4">
          <div className="flex flex-col gap-2">
            <div className="body-md font-medium">Connect a wallet to see your positions</div>
            <div className="body-sm muted">Nothing is custodied: this page reads balances on {network} and prices them. Parallax never holds your assets.</div>
          </div>
          <WalletRow />
        </div>
      )}

      {address && (
        <>
          <ErrorState error={w.error} retry={() => w.refetch()} />
          {w.isLoading && !d && <Loading rows={4} />}

          {d && (
            <div className="panel stat-row">
              <div className="stat">
                <div className="stat-label"><Ic.pie width={14} height={14} />Positions</div>
                <div className="stat-value">{usd(total)}</div>
                <div className="stat-sub">{indices.length} index position{indices.length === 1 ? "" : "s"}, {stocks.length} stock{stocks.length === 1 ? "" : "s"}</div>
              </div>
              <div className="stat">
                <div className="stat-label"><Ic.layers width={14} height={14} />Indices</div>
                <div className="stat-value">{usd(d.totals.indicesUsd)}</div>
                <div className="stat-sub">valued at each vault&apos;s NAV per unit</div>
              </div>
              <div className="stat">
                <div className="stat-label"><Ic.chart width={14} height={14} />Single stocks</div>
                <div className="stat-value">{usd(d.totals.stocksUsd)}</div>
                <div className="stat-sub">in underlying shares, across issuers</div>
              </div>
              <div className="stat">
                <div className="stat-label"><Ic.wallet width={14} height={14} />USDT</div>
                <div className="stat-value">{usd(cash)}</div>
                <div className="stat-sub">spendable balance, not counted in positions</div>
              </div>
            </div>
          )}

          {d && d.totals.unpricedPositions > 0 && (
            <Banner kind="warn">{d.totals.unpricedPositions} position{d.totals.unpricedPositions === 1 ? " has" : "s have"} no live price source right now, so they are held out of the totals rather than valued at a guess.</Banner>
          )}

          {empty && (
            <Empty>
              Nothing held on {network} yet. <Link className="link" href="/baskets">Invest in an index</Link> or{" "}
              <Link className="link" href="/stocks">buy a single stock</Link>, and it will appear here with the receipt that created it.
            </Empty>
          )}

          {indices.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="h5 px-1 pt-2">Index positions</h2>
              <div className="pf-grid">
                {indices.map((b) => (
                  <Link key={b.basket} href={`/baskets/${b.symbol}`} className="panel pf-card">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2"><TokenMark symbol={b.symbol} size={22} /><span className="body-md font-medium">{b.symbol}</span></span>
                      <span className="body-xs muted">{b.constituents.length} holdings</span>
                    </div>
                    <div className="big-num">{b.valueUsd ? usd(b.valueUsd) : "n/a"}</div>
                    <div className="pf-rows">
                      <div className="fee-row"><span className="muted">Units</span><span className="num">{fmt(b.units, 18, 4)}</span></div>
                      <div className="fee-row"><span className="muted">NAV per unit</span><span className="num">{b.navPerUnitUsd ? usd(b.navPerUnitUsd) : "n/a"}</span></div>
                    </div>
                    <span className="body-sm" style={{ color: "var(--brand)" }}>Invest more or redeem →</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {stocks.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="h5 px-1 pt-2">Stock positions</h2>
              <div className="panel overflow-x-auto">
                <table className="grid wide">
                  <thead><tr><th>Stock</th><th>Shares</th><th>Price</th><th>Value</th><th>Held as</th><th></th></tr></thead>
                  <tbody>
                    {stocks.map((s) => (
                      <tr key={s.ticker}>
                        <td>
                          <span className="flex items-center gap-2">
                            <StockLogo ticker={s.ticker} src={s.logoUrl} size={22} />
                            <span className="font-medium">{s.ticker}</span>
                            {s.name && <span className="body-xs muted truncate" style={{ maxWidth: 180 }}>{s.name}</span>}
                          </span>
                        </td>
                        <td className="num">{s.shares.toFixed(6)}</td>
                        <td className="num">{s.priceUsd ? usd(s.priceUsd) : "n/a"}</td>
                        <td className="num font-medium">{s.valueUsd === null ? "n/a" : usd(s.valueUsd)}</td>
                        <td>
                          <span className="flex flex-col gap-1">
                            {s.legs.map((l) => (
                              <span key={l.token} className="flex items-center gap-2 body-xs">
                                <span className="num">{fmt(l.tokens, 18, 4)}</span> {l.symbol} <PlatformTag platform={l.platform} />
                                <AddressLink value={l.token} truncate />
                              </span>
                            ))}
                          </span>
                        </td>
                        <td><Link className="btn" href={`/buy/${s.ticker}`}>Buy or sell</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {d && !empty && (
            <div className="body-xs muted px-1 pt-2">
              Balances read from {network} for <AddressLink value={d.address} />. Every position here was created by a
              transaction you can find in <Link className="link" href="/receipts">Activity</Link>.
            </div>
          )}
        </>
      )}
    </Page>
  );
}
