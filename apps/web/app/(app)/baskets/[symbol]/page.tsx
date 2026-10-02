"use client";
/* One index: what it returned, what it costs to get in, what is inside it and in what proportion, then the
   vault itself (backing, tokens held, rebalances, receipts) when it is deployed on this network.
   The invest panel is denominated in dollars; the vault still mints whole units of shares. */
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useNetwork } from "@/lib/network";
import { useApi, useApiPost, quoteIsCurrent, useResolverConfigured, type BasketDetail, type Health, type Migration, type RebalanceTrail, type MintQuote, type RedeemQuote, type Receipt, type Period } from "@/lib/api";
import { fmt, fmtUsdg, usd, short, compactUsd, usdgNumber, platformName } from "@/lib/format";
import { Loading, ErrorState, Banner, Dot, PlatformTag, Tag, A } from "@/components/ui";
import { TxButton } from "@/components/TxButton";
import { Page } from "@/components/Page";
import { Tag as SiteTag } from "@/components/site/ui";
import { Ic } from "@/components/app/icons";
import { StockLogo } from "@/components/app/StockLogo";
import { AllocationRing, CoverageNote, LogoCluster, PERIODS, PERIOD_LABELS, PERIOD_LONG, PeriodSeg, ReturnValue, Sparkline, pct, signColor } from "@/components/app/index-ui";
import { TokenMark } from "@/components/app/TokenMark";
import { Rebalances } from "@/components/app/Rebalances";
import { AddressLink } from "@/components/app/AddressLink";

const PRICE = { fontFamily: "var(--font-price)", fontWeight: 500, letterSpacing: "-1px" } as const;
const BALANCE_OF = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ type: "uint256" }] }] as const;
/* round DOWN to cents: a Half/Max shortcut must never ask for more USDG than the wallet holds */
const cents = (n: number) => (Math.floor(n * 100) / 100).toFixed(2);

function BasketPageInner({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  const { address } = useAccount();
  const { network } = useResolverConfigured();
  const { chainId } = useNetwork();
  const b = useApi<BasketDetail>(`/baskets/${symbol}`, { refetchInterval: 30_000 });
  const deployed = b.data?.deployed ?? false;
  const hist = useApi<{ receipts: Receipt[] }>(deployed && b.data?.address ? `/receipts?basket=${b.data.address}&limit=50` : null, { refetchInterval: 15_000 });
  /* rebalance candidates are quoted on their own, so they load on their own and never hold the page */
  const migrations = useApi<Migration[]>(deployed && b.data?.address ? `/migrations?basket=${b.data.address}&minGainBps=0` : null, { refetchInterval: 60_000 });
  /* what the vault has already rebalanced: its own Migrated events, joined to the record each quote hash points at */
  const trail = useApi<RebalanceTrail>(deployed ? `/baskets/${symbol}/rebalances` : null, { refetchInterval: 60_000 });

  const [period, setPeriod] = useState<Period>("m1");
  const [tab, setTab] = useState<"invest" | "redeem">("invest");
  const [amount, setAmount] = useState("100");
  const [units, setUnits] = useState("1");
  const [inKind, setInKind] = useState(false);
  /* the panel is denominated in what the buyer spends: the resolver sizes the units so the vault can never pull more than this budget */
  const mint = useApiPost<{ budgetUsdg: string; wallet?: string }, MintQuote>(`/baskets/${symbol}/quote-mint`);
  const redeem = useApiPost<{ units: string; inKind: boolean; wallet?: string }, RedeemQuote>(`/baskets/${symbol}/quote-redeem`);

  const nav = b.data?.navPerUnitUsd ? Number(b.data.navPerUnitUsd) : null;
  const minUsd = b.data?.minUsd ?? 0;
  const minted = Number(b.data?.totalSupply ?? "0");
  const amountNum = Number(amount) || 0;
  const belowMin = amountNum > 0 && amountNum < minUsd;
  /* units the vault would mint for this amount, before the router's quote refines it */
  const estUnits = nav && amountNum > 0 ? amountNum / nav : null;
  /* a unit is a claim on shares, so the panel quotes the position in dollars, not only in units */
  const quotedUnits = mint.data?.units ? Number(mint.data.units) / 1e18 : estUnits;
  const positionUsd = nav && quotedUnits ? quotedUnits * nav : null;
  /* what the USDG actually buys, against what actually leaves the wallet: fee plus spread, as one number.
     USDG amounts from the resolver are raw 6-decimal integers; units and shares are 1e18-scaled. */
  const spentUsd = mint.data ? usdgNumber(mint.data.expectedUsdg) : null;
  const costPct = positionUsd !== null && spentUsd ? ((positionUsd - spentUsd) / spentUsd) * 100 : null;
  const heldPerUnit = (b.data?.constituents ?? []).slice(0, 3).map((c) => ({ ticker: c.ticker, shares: fmt(c.sharesPerUnit, 18, 4) }));
  const balance = useReadContract({
    address: (b.data?.address ?? undefined) as `0x${string}` | undefined,
    abi: BALANCE_OF,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && b.data?.address) },
  });
  const held = balance.data ? Number(balance.data) / 1e18 : 0;
  /* the USDG the wallet can actually spend, so Half/Max mean something */
  const health = useApi<Health>("/health");
  const usdgAddress = (mint.data?.usdg ?? health.data?.deployment.usdg) as `0x${string}` | undefined;
  const usdgBalance = useReadContract({
    address: usdgAddress,
    abi: BALANCE_OF,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && usdgAddress) },
  });
  const usdgHeld = usdgBalance.data !== undefined ? usdgNumber(usdgBalance.data) : null;
  const redeemUsd = nav && Number(units) > 0 ? Number(units) * nav : null;

  /* what the quote on screen has to have been asked with before its transaction may be signed */
  const mintInputs = { budgetUsdg: amount, wallet: address };
  const redeemInputs = { units, inKind, wallet: address };
  const mintCurrent = quoteIsCurrent(mint, mintInputs);
  const redeemCurrent = quoteIsCurrent(redeem, redeemInputs);

  useEffect(() => {
    if (!deployed) return;
    if (tab === "invest" && (!amountNum || belowMin)) return;
    if (tab === "redeem" && !Number(units)) return;
    const t = setTimeout(() => (tab === "invest" ? mint.mutate(mintInputs) : redeem.mutate(redeemInputs)), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployed, tab, amount, units, inKind, address, symbol]);

  const presets = useMemo(() => Array.from(new Set([25, 100, 500, 1000].filter((n) => n >= minUsd))).sort((a, c) => a - c).slice(0, 4), [minUsd]);

  if (b.isLoading) return <Loading rows={8} />;
  if (b.error) return <ErrorState error={b.error} retry={() => b.refetch()} />;
  if (!b.data) return null;
  const d = b.data;
  const mq = mint.data;
  const rq = redeem.data;
  const ret = d.performance.returns[period];
  const constituentCount = d.allocation.length;

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_400px] gap-[10px] items-start">
      <div className="flex flex-col gap-[10px] min-w-0">
        {/* ---------- head ---------- */}
        <div className="flex flex-wrap items-end justify-between gap-4 pt-[20px] pb-[10px]">
          <div className="flex flex-col gap-[15px]" style={{ maxWidth: 680 }}>
            <div className="flex items-center gap-4">
              <SiteTag on={3}>Index</SiteTag>
              <LogoCluster items={d.allocation} size={24} />
            </div>
            <h1 className="h2">{d.name}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <span className="chip"><TokenMark symbol={d.symbol} size={16} />{d.symbol}</span>
              <span className="chip">{constituentCount} constituents</span>
              {d.deployed ? <span className="chip" style={{ borderColor: "transparent", background: "rgba(31,122,69,.12)", color: "var(--good)" }}>live on {network}</span> : <span className="chip">priced · not deployed on {network}</span>}
              {d.address && <span className="body-xs muted"><AddressLink value={d.address} /></span>}
            </div>
            {d.thesis && <p className="body-md muted">{d.thesis}</p>}
          </div>
          <PeriodSeg value={period} onChange={setPeriod} />
        </div>

        {/* ---------- headline figures ---------- */}
        <div className="panel stat-row">
          <div className="stat">
            <div className="stat-label"><Ic.trend width={14} height={14} />{PERIOD_LONG[period]} return</div>
            <ReturnValue bps={ret} className="stat-value block" />
            <div className="stat-sub"><CoverageNote perf={d.performance} period={period} /></div>
          </div>
          <div className="stat">
            <div className="stat-label"><Ic.target width={14} height={14} />Min. investment</div>
            <div className="stat-value">{usd(d.minUsd, 0)}</div>
            <div className="stat-sub">the smallest order the resolver quotes for this index</div>
          </div>
          <div className="stat">
            <div className="stat-label"><Ic.pie width={14} height={14} />NAV per unit</div>
            <div className="stat-value">{d.navPerUnitUsd ? usd(d.navPerUnitUsd) : "n/a"}</div>
            <div className="stat-sub">{d.navSource}</div>
          </div>
          <div className="stat">
            <div className="stat-label"><Ic.shield width={14} height={14} />Backing</div>
            <div className="stat-value"><Dot kind={d.backingOk ? "good" : "bad"} />{d.backingOk ? "≥ 1.00" : "below 1.00"}</div>
            <div className="stat-sub">{d.deployed ? `${fmt(d.totalSupply, 18, 4)} units outstanding · held ÷ required shares, every constituent` : "enforced on chain once the vault is deployed"}</div>
          </div>
        </div>

        {/* ---------- performance ---------- */}
        <section className="panel">
          <div className="panel-head">
            <span>Performance</span>
            <span className="tag">{d.performance.source ?? "no price history"}</span>
          </div>
          <div className="grid grid-cols-5">
            {PERIODS.map((p, i) => (
              <button key={p} onClick={() => setPeriod(p)} className="text-left px-[25px] py-[20px] transition-colors" style={{ borderRight: i < PERIODS.length - 1 ? "var(--dash)" : undefined, background: period === p ? "var(--color-card-2)" : undefined }}>
                <div className="eyebrow" style={{ lineHeight: "14px" }}>{PERIOD_LABELS[p]}</div>
                <ReturnValue bps={d.performance.returns[p]} className="block mt-3" />
                <div className="body-xs muted mt-1">{d.performance.returns[p] === null ? "no history" : d.performance.coverage[p] >= 10_000 ? "whole index" : `${(d.performance.coverage[p] / 100).toFixed(0)}% of NAV`}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ---------- allocation ---------- */}
        <section className="panel">
          <div className="panel-head">
            <span>Allocation</span>
            <span className="body-sm muted">by value of one unit at today&apos;s reference prices</span>
          </div>
          <div className="panel-body">
            <AllocationRing allocation={d.allocation} center={{ value: d.navPerUnitUsd ? usd(d.navPerUnitUsd) : "n/a", label: "per unit" }} />
          </div>
        </section>

        {/* ---------- assets ---------- */}
        <section className="flex flex-col gap-[10px]">
          <div className="flex items-end justify-between gap-3 px-1 pt-2">
            <h2 className="h5">Assets</h2>
            <span className="body-sm muted">Reference prices and the 7-day path from each stock&apos;s Chainlink feed, where this network has one</span>
          </div>
          <div className="grid sm:grid-cols-2 gap-[10px]">
            {d.allocation.map((a) => {
              const c = d.constituents.find((x) => x.ticker === a.ticker);
              const why = d.why?.[a.ticker];
              return (
                <div key={a.ticker} className="panel card-2 p-[20px] flex flex-col gap-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <StockLogo ticker={a.ticker} src={a.logoUrl} size={36} />
                      <div className="min-w-0">
                        <div className="font-medium truncate">{a.name ?? a.ticker}</div>
                        <div className="body-xs muted">{a.ticker} · {(a.weightBps / 100).toFixed(1)}% of unit</div>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="num" style={{ ...PRICE, fontSize: 20, lineHeight: "24px" }}>{a.priceUsd ? usd(a.priceUsd) : "n/a"}</div>
                      <div className="body-xs num" style={{ color: signColor(a.change24hBps) }}>{a.change24hBps !== null ? `${pct(a.change24hBps)} 24h` : a.priceSource ? "24h out of reach" : "no history"}</div>
                    </div>
                  </div>
                  <div className="flex items-end justify-between gap-3">
                    <Sparkline points={a.sparkline} width={150} height={40} />
                    <div className="text-right body-xs muted">
                      <div>{c ? `${fmt(c.sharesPerUnit, 18, 4)} sh / unit` : ""}</div>
                      <div className="num">{usd(a.valuePerUnitUsd)} / unit</div>
                    </div>
                  </div>
                  {why && <p className="body-sm muted" style={{ borderTop: "var(--dash)", paddingTop: 12 }}>{why}</p>}
                  <div className="flex items-center justify-between gap-2" style={{ borderTop: "var(--dash)", paddingTop: 12 }}>
                    <span className="body-xs muted">
                      {c && c.representations.length > 0 ? c.representations.map((r) => `${r.symbol} · ${platformName(r.platform)}`).join("  ") : a.priceSource === "chainlink" ? "chainlink feed" : "priced at mint"}
                    </span>
                    <Link href={`/buy/${a.ticker}`} className="inline-flex items-center gap-1 body-sm font-medium" style={{ color: "var(--brand)" }}>Buy {a.ticker} <Ic.trend width={14} height={14} /></Link>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ---------- vault (deployed only) ---------- */}
        {d.deployed && (
          <>
            <section className="panel overflow-x-auto">
              <div className="panel-head">
                <span>Vault</span>
                <div className="flex items-center gap-3 body-sm muted">
                  {minted > 0 ? (
                    d.issuerMix.length > 1 && <span>{d.issuerMix.map((m) => `${platformName(m.platform)} ${m.bps / 100}%`).join(" · ")}</span>
                  ) : (
                    <span>Nothing minted yet, so nothing is held: what follows is the unit this vault would buy, priced now</span>
                  )}
                  <span className="num">{fmt(d.totalSupply, 18, 4)} units · {usd(d.navPerUnitUsd)} NAV · USDG {fmtUsdg(d.usdgBalance)}</span>
                </div>
              </div>
              <table className="grid">
                <thead>
                  <tr>
                    <th>Constituent</th>
                    <th>Shares / unit</th>
                    <th>Value / unit</th>
                    <th>Weight</th>
                    {minted > 0 && <th>Required</th>}
                    {minted > 0 && <th>Held</th>}
                    {minted > 0 && <th>Backing</th>}
                    <th>{minted > 0 ? "Tokens held (share of the constituent)" : "Token (route, depth)"}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.constituents.map((c) => (
                    <tr key={c.ticker}>
                      <td className="font-medium">{c.ticker}</td>
                      <td className="num">{fmt(c.sharesPerUnit, 18, 4)}</td>
                      <td className="num" title={c.referencePrice ? `${fmt(c.sharesPerUnit, 18, 4)} shares at ${usd(c.referencePrice)}` : undefined}>{c.valuePerUnitUsd ? usd(c.valuePerUnitUsd) : "n/a"}</td>
                      <td className="num">{c.weightBps === null || c.weightBps === undefined ? "n/a" : `${(c.weightBps / 100).toFixed(1)}%`}</td>
                      {minted > 0 && <td className="num">{fmt(c.requiredShares, 18, 6)}</td>}
                      {minted > 0 && <td className="num">{fmt(c.heldShares, 18, 6)}</td>}
                      {minted > 0 && (
                        <td className="num">
                          {c.backingRatio === null ? <span className="muted">n/a</span> : (
                            <span><Dot kind={c.backingRatio >= 1 ? "good" : "bad"} />{c.backingRatio.toFixed(4)}</span>
                          )}
                        </td>
                      )}
                      <td>
                        <div className="space-y-1">
                          {c.representations.map((r) => (
                            <div key={r.token} className="flex items-center gap-2 text-xs">
                              <span className="num w-16">{r.symbol}</span>
                              <PlatformTag platform={r.platform} />
                              {minted > 0 ? (
                                <>
                                  <div className="bar w-28" title={`${r.shareBps / 100}% of ${c.ticker}`}>
                                    <span style={{ width: `${r.shareBps / 100}%`, background: r.shareBps / 100 > c.maxIssuerBps / 100 ? "var(--bad)" : "var(--accent)" }} />
                                  </div>
                                  <span className="num">{(r.shareBps / 100).toFixed(1)}%</span>
                                  <span className="muted">{c.capActive ? `cap ${c.maxIssuerBps / 100}%` : "no cap"}</span>
                                  <span className="num muted">{fmt(r.shares, 18, 6)} sh</span>
                                </>
                              ) : (
                                <span
                                  className="num muted whitespace-nowrap"
                                  title={`${r.route === "pool" ? `USDG in this token's direct Uniswap v3 pools${r.poolFees?.length ? `, fee tiers ${r.poolFees.map((f) => `${f / 10_000}%`).join(", ")}` : ""}` : "no direct Uniswap v3 pool for this token on this network"} · 1 token = ${r.ratio ? fmt(r.ratio, 18, 6) : "?"} shares`}
                                >
                                  {r.route === "pool" ? `${compactUsd(usdgNumber(r.poolUsdg ?? "0"))} pool` : "no direct pool"}
                                </span>
                              )}
                              {!r.buyEligible && <Tag>not buy-eligible</Tag>}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <Rebalances
              trail={{ data: trail.data, isLoading: trail.isLoading }}
              migrations={{ data: migrations.data, isLoading: migrations.isLoading, refetch: () => void migrations.refetch() }}
              chainId={chainId}
              logos={d.allocation}
              minted={minted}
              onExecuted={() => { b.refetch(); hist.refetch(); migrations.refetch(); trail.refetch(); }}
            />

            <section className="flex flex-col gap-2">
              <h2 className="h5 px-1 pt-2">History</h2>
              {hist.isLoading && <Loading />}
              {hist.data && hist.data.receipts.length === 0 && <Banner>No receipts yet for this index.</Banner>}
              {hist.data && hist.data.receipts.length > 0 && (
                <div className="panel overflow-x-auto">
                  <table className="grid wide">
                    <thead><tr><th>Action</th><th>Constituent</th><th>Representation</th><th>Shares</th><th>Ratio</th><th>Actor</th><th>Tx</th></tr></thead>
                    <tbody>
                      {hist.data.receipts.map((r) => (
                        <tr key={`${r.tx_hash}-${r.log_index}`}>
                          <td><Tag>{r.action}</Tag></td>
                          <td>{r.underlying}</td>
                          <td className="text-xs"><AddressLink value={r.representation} truncate /></td>
                          <td className="num">{fmt(r.shares_out, 18, 6)}</td>
                          <td className="num">{fmt(r.ratio, 18, 6)}</td>
                          <td className="text-xs"><AddressLink value={r.actor} truncate /></td>
                          <td className="text-xs"><A href={`/receipts?tx=${r.tx_hash}`}>{short(r.tx_hash, 8)}</A></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>

      {/* ---------- invest panel ---------- */}
      <section className="panel xl:sticky xl:top-[90px]">
        <div className="p-3 pb-0">
          <div className="seg !grid grid-cols-2 w-full">
            <button data-on={tab === "invest"} onClick={() => setTab("invest")}>Invest</button>
            <button data-on={tab === "redeem"} onClick={() => setTab("redeem")}>Redeem</button>
          </div>
        </div>
        <div className="panel-body flex flex-col gap-5">
          {tab === "invest" ? (
            <>
              {/* what leaves the wallet: the balance, the two shortcuts a buyer reaches for, the amount */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="body-sm muted inline-flex items-center gap-[6px]"><Ic.wallet width={15} height={15} /><span className="num">{usdgHeld === null ? "n/a" : cents(usdgHeld)}</span> USDG</span>
                  <div className="flex gap-2">
                    <button className="preset" disabled={!usdgHeld} onClick={() => usdgHeld && setAmount(cents(usdgHeld / 2))}>Half</button>
                    <button className="preset" disabled={!usdgHeld} onClick={() => usdgHeld && setAmount(cents(usdgHeld))}>Max</button>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="chip shrink-0"><TokenMark symbol="USDG" size={18} />USDG</span>
                  <input className="big-num w-full bg-transparent outline-none text-right" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Amount in USDG" />
                </div>
                {/* the answer a buyer wants: what that money is worth once it is invested */}
                <div className="flex items-center justify-between gap-3 body-sm">
                  <span className="muted">You&apos;ll receive</span>
                  <span className="inline-flex items-center gap-[6px]">
                    {/* the quote decides this, not the estimate: only an undeployed index falls back to NAV value */}
                    {positionUsd !== null && (mq || !d.deployed) ? (
                      <>
                        <TokenMark symbol={d.symbol} size={15} />≈ <span className="num">{usd(positionUsd)}</span>
                        {costPct !== null && <span className="num muted" title="fee and venue spread, against the USDG actually spent">({costPct >= 0 ? "+" : "−"}{Math.abs(costPct).toFixed(2)}%)</span>}
                      </>
                    ) : mint.isPending ? <span className="skeleton inline-block w-24 h-4 align-middle" /> : "n/a"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {presets.map((n) => <button key={n} className="preset" data-on={amountNum === n} onClick={() => setAmount(String(n))}>{usd(n, 0)}</button>)}
                </div>
                {belowMin && <Banner kind="warn">Minimum is {usd(minUsd, 0)} for this index.</Banner>}
              </div>

              {/* the three numbers that decide the investment */}
              <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
                <div className="fee-row"><span className="muted">{PERIOD_LONG[period]} return</span><ReturnValue bps={ret} /></div>
                <div className="fee-row"><span className="muted">Fee{mq?.fee ? ` · ${(mq.fee.bps / 100).toFixed(2)}%` : ""}</span><span className="num">{mq?.fee ? `${fmtUsdg(mq.fee.usdg)} USDG` : d.deployed ? "…" : "n/a"}</span></div>
                <div className="fee-row"><span className="muted">Minimum</span><span className="num">{usd(minUsd, 0)}</span></div>
                {/* not a switch: a rebalance applies to every holder at once, and the trail below says when one happened */}
                {d.deployed && <div className="fee-row"><span className="muted">Rebalance rule</span><a className="link num" href="#rebalance">{trail.data ? `share gain ≥ ${trail.data.minGainBps} bps` : "…"}</a></div>}
              </div>

              <div className="body-sm muted">
                {d.deployed
                  ? <>Buys all {constituentCount} holdings at index weight, each through its cheapest eligible route. Unspent USDG is refunded in the same transaction.</>
                  : <>Indicative, from reference prices: {d.symbol} is not deployed on {network}, so there is no executable quote here.</>}
              </div>

              {/* everything the vault actually does, one click away: hidden by default, never removed */}
              <details className="rounded-2xl" style={{ border: "var(--dash)" }}>
                <summary className="fee-row body-sm cursor-pointer select-none" style={{ listStyle: "none" }}>
                  <span className="muted">Order details</span>
                  <span className="num">{mq ? `${fmt(mq.units, 18, 4)} ${d.symbol}` : estUnits !== null ? `~${estUnits.toFixed(4)} ${d.symbol}` : "n/a"}</span>
                </summary>
                <div className="fee-row"><span className="muted">NAV per unit</span><span className="num">{d.navPerUnitUsd ? usd(d.navPerUnitUsd) : "n/a"}</span></div>
                {heldPerUnit.length > 0 && (
                  <div className="fee-row"><span className="muted">Each unit holds</span><span className="num" style={{ textAlign: "right" }}>{heldPerUnit.map((h) => `${h.shares} ${h.ticker}`).join(" · ")}{constituentCount > heldPerUnit.length ? ` +${constituentCount - heldPerUnit.length}` : ""}</span></div>
                )}
                {d.deployed && (
                  <>
                    <div className="fee-row"><span className="muted">Expected cost incl. fee</span><span className="num">{mq ? `${fmtUsdg(mq.expectedUsdg)} USDG` : "…"}</span></div>
                    <div className="fee-row"><span className="muted">Max USDG (unused refunded)</span><span className="num">{mq ? fmtUsdg(mq.maxUsdgIn) : "…"}</span></div>
                    <div className="fee-row"><span className="muted">Simulation</span><span className="num">{mq?.simulation ? (mq.simulation.ok ? `ok${mq.simulation.approvalNeeded ? " · approval first" : ""}` : "failed") : "…"}</span></div>
                    {mq && <div className="fee-row"><span className="muted">Quote</span><span className="mono body-xs">{mq.quoteHash.slice(0, 18)}…</span></div>}
                  </>
                )}
              </details>

              <ErrorState error={mint.error} />
              {mq && mq.problems.length > 0 && <Banner kind="warn">{mq.problems.join(" · ")}</Banner>}
              {mq?.simulation && !mq.simulation.ok && <Banner kind="bad">Simulation failed: {mq.simulation.error}</Banner>}
              {d.deployed ? (
                <TxButton tx={mintCurrent ? mq?.tx ?? null : null} label={`Invest ${usd(amountNum, 0)}`} className="btn btn-primary btn-lg w-full" approval={mq ? { token: mq.usdg, spender: mq.basket, amount: BigInt(mq.maxUsdgIn) } : undefined} disabled={!mintCurrent || !mq?.tx || belowMin} onSent={() => { b.refetch(); hist.refetch(); }} />
              ) : (
                <button className="btn btn-primary btn-lg w-full" disabled>Not deployed on {network}</button>
              )}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between body-md"><span>You redeem</span><span className="chip"><TokenMark symbol={d.symbol} size={16} />{d.symbol}</span></div>
                <input className="big-num w-full bg-transparent outline-none" value={units} onChange={(e) => setUnits(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Units" />
                <div className="flex flex-wrap gap-2">
                  {[1, 5, 10, 25].map((n) => <button key={n} className="preset" data-on={Number(units) === n} onClick={() => setUnits(String(n))}>{n} {n === 1 ? "unit" : "units"}</button>)}
                  {held > 0 && <button className="preset" data-on={Number(units) === held} onClick={() => setUnits(String(held))}>All {held.toFixed(4)}</button>}
                </div>
                {redeemUsd !== null && <div className="body-sm muted"><span className="num">{usd(redeemUsd)}</span> at today&apos;s NAV</div>}
                <label className="flex items-center gap-2 body-sm"><input type="checkbox" checked={inKind} onChange={(e) => setInKind(e.target.checked)} /> in kind (tokens, always available)</label>
              </div>
              <div className="relative h-px" style={{ background: "var(--line-2)" }}><span className="swap-orb absolute left-1/2 -translate-x-1/2 -translate-y-1/2"><span style={{ fontSize: 18 }}>↓</span></span></div>
              <div className="flex flex-col gap-3 pt-2">
                <div className="flex items-center justify-between body-md"><span>You receive</span><span className="chip">{inKind ? <LogoCluster items={d.allocation} size={16} max={4} /> : <TokenMark symbol="USDG" size={16} />}{inKind ? "the underlying tokens" : "USDG"}</span></div>
                <div className="big-num">{rq ? (inKind ? `${rq.slices.length} slices` : `${fmtUsdg(rq.usdgOut)} USDG`) : redeem.isPending ? <span className="skeleton inline-block w-40 h-8" /> : d.deployed ? "n/a" : "not deployed"}</div>
                <div className="body-sm muted">{inKind ? "Your pro-rata slice of every token the vault holds, plus vault USDG. No oracle, cannot be paused." : "Each token is sold through its best exit; anything without liquidity is delivered in kind."}</div>
              </div>
              {rq && (
                <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
                  {!inKind && <div className="fee-row"><span className="muted">Protocol fee{rq.fee ? ` ${(rq.fee.bps / 100).toFixed(2)}%` : ""}</span><span className="num">{rq.fee ? `${fmtUsdg(rq.fee.usdg)} USDG` : "…"}</span></div>}
                  {inKind && <div className="fee-row"><span className="muted">Protocol fee</span><span className="num">none in kind</span></div>}
                  {!inKind && <div className="fee-row"><span className="muted">Min USDG after fee (enforced on chain)</span><span className="num">{fmtUsdg(rq.minUsdgOut)}</span></div>}
                  {rq.slices.map((s) => (
                    <div key={s.symbol} className="fee-row"><span className="muted"><span className="num">{s.symbol}</span> · {platformName(s.platform)}</span><span className="num">{s.deliveredInKind || !s.sold ? `${fmt(s.tokens, 18, 4)} in kind` : `${fmtUsdg(s.sold.usdgOut)} USDG`}</span></div>
                  ))}
                  <div className="fee-row"><span className="muted">Simulation</span><span className="num">{rq.simulation ? (rq.simulation.ok ? "ok" : "failed") : "…"}</span></div>
                </div>
              )}
              <ErrorState error={redeem.error} />
              {rq?.simulation && !rq.simulation.ok && <Banner kind="bad">Simulation failed: {rq.simulation.error}</Banner>}
              {d.deployed ? (
                <TxButton tx={redeemCurrent ? rq?.tx ?? null : null} label={inKind ? `Redeem ${units} in kind` : `Redeem ${units} to USDG`} className="btn btn-primary btn-lg w-full" disabled={!redeemCurrent || !rq?.tx} onSent={() => { b.refetch(); hist.refetch(); }} />
              ) : (
                <button className="btn btn-primary btn-lg w-full" disabled>Not deployed on {network}</button>
              )}
              {rq && <div className="body-xs muted">quote <span className="mono">{rq.quoteHash.slice(0, 18)}…</span></div>}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export default function BasketPage(props: Parameters<typeof BasketPageInner>[0]) {
  return (
    <Page>
      <BasketPageInner {...props} />
    </Page>
  );
}
