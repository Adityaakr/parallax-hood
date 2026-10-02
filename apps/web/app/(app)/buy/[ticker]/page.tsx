"use client";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useApi, useApiPost, type ResolveResponse, type Stock, type StocksResponse, type Health, type WalletView, type SellResponse, type CorporateActions } from "@/lib/api";
import { useDepth } from "@/lib/depth";
import { fmt, fmtUsdg, usd, bps, dt, ago, compactUsd, usdgNumber, venueName, platformName } from "@/lib/format";
import { Loading, ErrorState, Banner, PlatformTag, Tag, A } from "@/components/ui";
import { TxButton } from "@/components/TxButton";
import { DepthChart } from "@/components/app/DepthChart";
import { Ic } from "@/components/app/icons";
import { StockLogo } from "@/components/app/StockLogo";
import { AddressLink } from "@/components/app/AddressLink";
import { TokenMark } from "@/components/app/TokenMark";
import { PriceChart } from "@/components/app/PriceChart";

/* The buyer's own limits, sent with every quote. The registry's limits apply on top and cannot be loosened here. */
const DEFAULT_POLICY = { maxPremiumBps: 150, maxClosedMarketPremiumBps: 150, maxSlippageBps: 50, allowClosedMarket: true };
const sent = (p: typeof DEFAULT_POLICY) => ({ ...p }) as Record<string, unknown>;
const PRESETS = [100, 500, 1000, 1500, 2000];

export default function BuyPage({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = use(params);
  const T = ticker.toUpperCase();
  const router = useRouter();
  const { address } = useAccount();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("500");
  const [sellTokens, setSellTokens] = useState("");
  const [policy, setPolicy] = useState(DEFAULT_POLICY);
  const [showPolicy, setShowPolicy] = useState(false);
  const [metric, setMetric] = useState<"price" | "cost" | "premium">("price");
  const stock = useApi<Stock & { dataSource: string }>(`/stocks/${T}`, { refetchInterval: 20_000 });
  const stocks = useApi<StocksResponse>("/stocks");
  const health = useApi<Health>("/health");
  /* dividends and splits as the issuer reports them; refreshed hourly, which is how often the issuer's list changes */
  const actions = useApi<CorporateActions>(`/stocks/${T}/corporate-actions`, { refetchInterval: 3_600_000 });
  const resolve = useApiPost<{ ticker: string; usdAmount: string; wallet?: string; policy: Record<string, unknown> }, ResolveResponse>("/resolve");
  /* selling needs what this wallet actually holds of this stock, per token */
  const wallet = useApi<WalletView>(address ? `/wallet/${address}` : null, { refetchInterval: 30_000 });
  const sell = useApiPost<{ ticker: string; side: "sell"; tokenAmount: string; representation?: string; wallet?: string; policy: Record<string, unknown> }, SellResponse>("/resolve");
  const held = (wallet.data?.holdings ?? []).filter((h) => h.ticker === T);
  const heldTokens = held.reduce((a, h) => a + Number(h.tokens) / 1e18, 0);
  const sq = sell.data;
  const depth = useDepth(T, policy, Boolean(resolve.data));
  const r = resolve.data;

  // auto-resolve on load and when inputs change (debounced)
  useEffect(() => {
    const n = Number(amount);
    if (!n || n <= 0) return;
    const t = setTimeout(() => resolve.mutate({ ticker: T, usdAmount: amount, wallet: address, policy: sent(policy) }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [T, amount, address, policy]);

  useEffect(() => {
    if (side !== "sell") return;
    const n = Number(sellTokens);
    if (!n || n <= 0) return;
    const t = setTimeout(() => sell.mutate({ ticker: T, side: "sell", tokenAmount: sellTokens, wallet: address, policy: sent(policy) }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [T, side, sellTokens, address, policy]);

  const chosenSymbol = useMemo(() => {
    if (!r?.chosen) return undefined;
    const tok = r.chosen.split[0]?.token.toLowerCase();
    return r.candidates.find((c) => c.token.toLowerCase() === tok)?.symbol;
  }, [r]);
  const best = r?.candidates.filter((c) => c.eligible).sort((a, b) => a.premiumBps - b.premiumBps)[0];
  const reps = stock.data?.representations ?? [];
  const issuers = Array.from(new Set(reps.map((x) => x.platform)));
  /* USDG in the token's direct Uniswap v3 pools (raw, 6 decimals) and the fee tiers holding it */
  const poolUsd = reps.reduce((a, x) => a + usdgNumber(x.poolUsdg), 0);
  const poolTiers = Array.from(new Set(reps.flatMap((x) => x.poolFees ?? []))).sort((a, b) => a - b);
  /* Robinhood's own quote and trading sessions for this stock, when the resolver reads its API on this network */
  const issuer = stock.data?.issuer ?? null;
  const iq = issuer?.quote ?? null;
  const sessions = issuer?.sessions ? (["market", "extended", "overnight"] as const).filter((k) => issuer.sessions![k].whole) : null;
  /* a test network priced from mainnet fills at one price, so its cost curve is flat */
  const testVenue = Boolean(health.data?.hybrid);

  return (
    <div className="grid xl:grid-cols-[minmax(0,1fr)_460px] gap-4 items-start">
      {/* ---------- left: chart + candidates ---------- */}
      <div className="flex flex-col gap-4 min-w-0">
        <section className="panel">
          <div className="panel-head">
            <div className="flex items-center gap-4">
              <label className="relative inline-flex items-center gap-2 body-md font-medium cursor-pointer">
                <StockLogo ticker={T} src={stock.data?.logoUrl} size={22} />
                {T}
                <span className="muted"><Ic.chevron /></span>
                <select className="absolute inset-0 opacity-0 cursor-pointer" value={T} onChange={(e) => router.push(`/buy/${e.target.value}`)} aria-label="Stock">
                  {(stocks.data?.stocks ?? [{ ticker: T }]).map((s) => <option key={s.ticker} value={s.ticker}>{s.ticker}</option>)}
                </select>
              </label>
              <span className="body-sm muted">{stock.data ? `${stock.data.name ? stock.data.name + " · " : ""}${reps.length === 1 ? "stock token" : `${reps.length} tokens`} · ${issuers.map(platformName).join(", ")}` : ""}</span>
            </div>
            <A href={`/receipts?underlying=${T}`}><span className="chip">Receipts</span></A>
          </div>
          <div className="panel-body flex flex-col gap-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex flex-col gap-2">
                <div className="big-num">{stock.data?.referencePrice ? usd(stock.data.referencePrice) : <span className="skeleton inline-block w-40 h-8" />}</div>
                <div className="flex flex-wrap items-center gap-2 body-sm">
                  {best && (
                    <span className="chip" style={{ color: best.premiumBps <= 0 ? "var(--good)" : "var(--fg)" }}>
                      {best.premiumBps <= 0 ? <Ic.up width={14} height={14} /> : <Ic.down width={14} height={14} />}
                      {best.symbol} {bps(best.premiumBps)} vs reference
                    </span>
                  )}
                  {stock.data && (
                    <span className="chip"><span className={`dot ${stock.data.market.open ? "dot-good" : "dot-warn"}`} style={{ marginRight: 0 }} />{stock.data.market.reason === "HALTED" ? "Trading halted" : `Market ${stock.data.market.open ? "open" : "closed"}`}{!stock.data.market.open && stock.data.market.nextOpenTime ? ` · opens ${dt(stock.data.market.nextOpenTime)}` : ""}</span>
                  )}
                  <span className="muted">reference · {stock.data?.referenceSource ?? "…"}</span>
                </div>
              </div>
              <div className="seg">
                <button data-on={metric === "price"} onClick={() => setMetric("price")}>Price</button>
                <button data-on={metric === "cost"} onClick={() => setMetric("cost")}>Cost / share</button>
                <button data-on={metric === "premium"} onClick={() => setMetric("premium")}>Premium</button>
              </div>
            </div>
            {stock.error && <ErrorState error={stock.error} retry={() => stock.refetch()} />}
            {metric === "price" ? (
              <PriceChart ticker={T} />
            ) : depth.points.length < 2 ? (
              <div className="flex flex-col gap-3 py-8">
                <Loading rows={5} />
                <div className="body-xs muted">{depth.error ? depth.error.message : "Quoting six order sizes…"}</div>
              </div>
            ) : (
              <DepthChart points={depth.points} metric={metric} chosen={chosenSymbol} />
            )}
            <div className="body-xs muted">
              {metric === "price"
                ? "What one share of the underlying has done, from the stock's Chainlink feed where the network has one. The feeds update 24 hours a day, 5 days a week, and stop over the weekend."
                : `Cost per underlying share as the order size grows, quoted through the resolver. The dashed orange line is the reference price.${stock.data?.dataSource === "fixture" ? " On this network the token, the venue and the reference price are mocks." : testVenue ? " The venue on this network is a test one that fills any size at mainnet's pool price, so the curve shows no price impact; pool depth above is the real market's." : ""}`}
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <span>Route candidates{r ? ` · $${Number(amount).toLocaleString()} USDG` : ""}</span>
            <A href={r ? `/receipts?quote=${r.quoteHash}` : "/receipts"}><span className="chip">Scoring record</span></A>
          </div>
          <ErrorState error={resolve.error} retry={() => resolve.mutate({ ticker: T, usdAmount: amount, wallet: address, policy: sent(policy) })} />
          {resolve.isPending && !r && <div className="p-5"><Loading rows={3} /></div>}
          {r && (
            <div className="overflow-x-auto">
              <table className="grid">
                <thead>
                  <tr><th>Token</th><th>Shares / token</th><th>Venue</th><th>Shares out</th><th>Cost / share</th><th>Premium</th><th>Slippage</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {r.candidates.map((c) => {
                    const chosen = r.chosen?.split.some((s) => s.token.toLowerCase() === c.token.toLowerCase());
                    return (
                      <tr key={c.token} className={chosen ? "chosen" : ""}>
                        <td><span className="flex items-center gap-2"><StockLogo ticker={T} src={stock.data?.logoUrl} size={20} /><span className="font-medium">{c.symbol}</span> <PlatformTag platform={c.platform} />{chosen && <Tag>chosen</Tag>}</span></td>
                        <td className="num">{fmt(c.ratio, 18, 6)} <span className="body-xs muted">{c.ratioSource === "ERC8056" ? "on-chain multiplier" : "posted ratio"}</span></td>
                        <td className="num body-sm whitespace-nowrap" title={c.venue}>{venueName(c.venue)}</td>
                        <td className="num">{c.sharesOut === "0" ? "n/a" : fmt(c.sharesOut, 18, 6)}</td>
                        <td className="num">{c.costPerShareUsd === "0" ? "n/a" : usd(c.costPerShareUsd, 4)}</td>
                        <td className="num whitespace-nowrap"><span className="inline-flex items-center gap-1">{c.costPerShareUsd !== "0" && (c.premiumBps <= 0 ? <Ic.up width={14} height={14} style={{ color: "var(--good)" }} /> : <Ic.down width={14} height={14} style={{ color: "var(--bad)" }} />)}{c.costPerShareUsd === "0" ? "n/a" : bps(c.premiumBps)}</span>{c.pricePremiumBps !== undefined && c.costPerShareUsd !== "0" && <div className="body-xs muted">{bps(c.pricePremiumBps)} ex-gas</div>}</td>
                        <td className="num">{c.costPerShareUsd === "0" ? "n/a" : bps(c.slippageBps)}</td>
                        <td className="body-sm">
                          {c.eligible ? (
                            <span className="tag tag-blue">{chosen ? (r.chosen!.split.length > 1 ? `chosen · ${r.chosen!.split.find((s) => s.token.toLowerCase() === c.token.toLowerCase())!.bps / 100}%` : "chosen") : "eligible"}</span>
                          ) : (
                            <span className="flex items-center gap-2 whitespace-nowrap" title={c.reasons.join(" · ")}>
                              <span className="tag" style={{ color: "var(--bad)", borderColor: "var(--bad)" }}>blocked</span>
                              <span className="body-xs muted truncate" style={{ maxWidth: 210 }}>{c.reasons[0]}</span>
                              {c.reasons.length > 1 && <span className="body-xs muted">+{c.reasons.length - 1}</span>}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {r?.chosen && (
            <div className="px-5 py-4 border-t line body-sm">
              <span className="font-medium">Why this route:</span> <span className="muted">{r.chosen.why}</span>
              <div className="body-xs muted mt-1">quote <span className="mono">{r.quoteHash.slice(0, 18)}…</span> · <A href={`/receipts?quote=${r.quoteHash}`}>scoring record</A></div>
            </div>
          )}
        </section>

        {/* Dividends and splits change the token's multiplier, which is why Parallax counts shares and not tokens. */}
        {actions.data?.source && (
          <section className="panel">
            <div className="panel-head">
              <span>Corporate actions</span>
              <span className="body-sm muted">reported by Robinhood{issuer ? ` · multiplier ${Number(issuer.multiplier).toFixed(6)}` : ""}</span>
            </div>
            {issuer?.pendingMultiplier && (
              <div className="px-5 pt-4">
                <Banner kind="warn">
                  A multiplier change to {Number(issuer.pendingMultiplier.multiplier).toFixed(6)} is scheduled{issuer.pendingMultiplier.effectiveAt ? ` for ${dt(issuer.pendingMultiplier.effectiveAt * 1000)}` : ""}. Quotes stay in underlying shares, so the share count you are quoted does not change with it.
                </Banner>
              </div>
            )}
            {actions.data.actions === null ? (
              <div className="p-5 body-sm muted">Robinhood&apos;s API is not answering, so nothing is listed here.</div>
            ) : actions.data.actions.length === 0 ? (
              <div className="p-5 body-sm muted">Robinhood lists no corporate action for {T}.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="grid">
                  <thead><tr><th>Process date</th><th>Action</th><th>Status</th></tr></thead>
                  <tbody>
                    {actions.data.actions.slice(0, 6).map((a) => (
                      <tr key={`${a.id}-${a.processDate}-${a.type}`}>
                        <td className="num whitespace-nowrap">{a.processDate ?? "not scheduled"}</td>
                        <td className="body-sm">{a.summary}</td>
                        <td><span className={a.status === "COMPLETED" ? "tag tag-blue" : "tag"}>{a.status === "COMPLETED" ? "completed" : a.status === "IN_PROGRESS" ? "in progress" : a.status.toLowerCase()}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="px-5 py-4 border-t line body-xs muted">
              From Robinhood&apos;s Stock Token API. The process date is the issuer&apos;s scheduling date, not a payable date. A dividend or a split reaches holders through the token&apos;s on-chain multiplier.
            </div>
          </section>
        )}
      </div>

      {/* ---------- right: market overview + trade panel ---------- */}
      <div className="flex flex-col gap-4">
        <section className="panel">
          <div className="panel-head">
            <span>Market overview</span>
            <span className="chip"><StockLogo ticker={T} src={stock.data?.logoUrl} size={18} />{T}<Ic.chevron width={14} height={14} /></span>
          </div>
          <div className="stat-grid">
            <div className="stat"><div className="stat-label"><Ic.up />Reference</div><div className="stat-value">{stock.data?.referencePrice ? usd(stock.data.referencePrice) : "…"}</div><div className="stat-sub">{stock.data?.referenceSource ?? "source"}</div></div>
            <div className="stat"><div className="stat-label"><Ic.clock />Market</div><div className="stat-value">{stock.data ? (stock.data.market.reason === "HALTED" ? "Halted" : stock.data.market.open ? "Open" : "Closed") : "…"}</div><div className="stat-sub">{stock.data ? (stock.data.market.source === "issuer" ? "halt reported by Robinhood" : stock.data.market.source === "computed" ? "Chainlink's 24/5 schedule" : `status via ${stock.data.market.source}`) : ""}</div></div>
            <div className="stat"><div className="stat-label"><Ic.layers />Shares per token</div><div className="stat-value">{reps.length === 1 ? fmt(reps[0]!.ratio, 18, 6) : stock.data ? `${reps.length} tokens` : "…"}</div><div className="stat-sub">{reps.length === 1 ? (reps[0]!.ratioSource === "ERC8056" ? "the token's on-chain multiplier" : "posted ratio") : issuers.map(platformName).join(" · ")}</div></div>
            <div className="stat"><div className="stat-label"><Ic.target />Best route</div><div className="stat-value">{best ? best.symbol : r ? "none" : "…"}</div><div className="stat-sub">{best ? `${bps(best.premiumBps)} incl. gas` : "under this policy"}</div></div>
            <div className="stat"><div className="stat-label"><Ic.shield />Pool depth</div><div className="stat-value">{!stock.data ? "…" : poolUsd > 0 ? compactUsd(poolUsd) : "n/a"}</div><div className="stat-sub">{poolTiers.length ? `USDG in direct Uniswap v3 pools, ${poolTiers.map((f) => `${f / 10_000}%`).join(" and ")}` : "no direct Uniswap v3 pool on this network"}</div></div>
            {issuer && (
              <>
                <div className="stat"><div className="stat-label"><Ic.target />Robinhood bid / ask</div><div className="stat-value" style={{ fontSize: 20 }}>{iq ? `${usd(iq.bid)} / ${usd(iq.ask)}` : "n/a"}</div><div className="stat-sub">{iq ? `the issuer's quote per share, ${ago(iq.generatedAt)}${iq.dailyLow && iq.dailyHigh ? ` · day ${usd(iq.dailyLow)} to ${usd(iq.dailyHigh)}` : ""}` : "Robinhood's API did not answer"}</div></div>
                <div className="stat"><div className="stat-label"><Ic.clock />Sessions</div><div className="stat-value">{sessions ? `${sessions.length} of 3` : "n/a"}</div><div className="stat-sub">{sessions ? (sessions.length ? `tradable at Robinhood: ${sessions.join(", ")}` : "Robinhood lists no tradable session") : "not reported by the issuer"}{iq?.dailyVolume ? ` · ${Number(iq.dailyVolume).toLocaleString("en-US")} shares today` : ""}</div></div>
              </>
            )}
            <div className="stat"><div className="stat-label"><Ic.chart />Venue</div><div className="stat-value" style={{ fontSize: 20 }}>{best ? venueName(best.venue) : "…"}</div><div className="stat-sub">where this order would fill</div></div>
          </div>
        </section>

        <section className="panel">
          <div className="p-3 pb-0">
            <div className="seg !grid grid-cols-4 w-full">
              <button data-on={side === "buy"} onClick={() => setSide("buy")}>Buy</button>
              <button data-on={side === "sell"} onClick={() => setSide("sell")}>Sell</button>
              <button onClick={() => router.push("/baskets")}>Mint</button>
              <button onClick={() => router.push("/mandates")}>Delegate</button>
            </div>
          </div>
          <div className="panel-body flex flex-col gap-5">
            {side === "buy" ? (
              <>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between body-md"><span>You pay</span><span className="chip"><TokenMark symbol="USDG" size={18} />USDG<Ic.chevron width={14} height={14} /></span></div>
              <input className="big-num w-full bg-transparent outline-none" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Amount in USDG" />
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p) => <button key={p} className="preset" data-on={Number(amount) === p} onClick={() => setAmount(String(p))}>${p.toLocaleString()}</button>)}
              </div>
            </div>
            <div className="relative h-px" style={{ background: "var(--line-2)" }}><span className="swap-orb absolute left-1/2 -translate-x-1/2 -translate-y-1/2"><Ic.swap width={18} height={18} /></span></div>
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center justify-between body-md"><span>You receive</span><span className="chip"><StockLogo ticker={T} src={stock.data?.logoUrl} size={16} />{T} shares<Ic.chevron width={14} height={14} /></span></div>
              <div className="big-num">{r?.chosen ? `${fmt(r.chosen.sharesOut, 18, 4)} ${T}` : resolve.isPending ? <span className="skeleton inline-block w-40 h-8" /> : "n/a"}</div>
              <div className="body-sm muted">{r?.chosen ? `via ${chosenSymbol}${r.chosen.split.length > 1 ? ` + ${r.chosen.split.length - 1} more` : ""} · min ${fmt(r.chosen.minShares, 18, 4)} shares enforced on chain` : r?.status === "no_route" ? "No eligible route under this policy." : ""}</div>
            </div>
            <div className="rounded-2xl border line">
              <div className="fee-row"><span className="muted">Protocol fee{r?.fee ? ` ${(r.fee.bps / 100).toFixed(2)}%` : ""}</span><span className="num">{r?.fee ? `${fmtUsdg(r.fee.usdg)} USDG` : "…"}</span></div>
              <div className="fee-row"><span className="muted">Total USDG incl. fee</span><span className="num">{r?.fee?.totalUsdgIn ? fmtUsdg(r.fee.totalUsdgIn) : "…"}</span></div>
              <div className="fee-row"><span className="muted">Gas estimate</span><span className="num">{r ? usd(r.gasUsd, 3) : "…"}</span></div>
              <div className="fee-row"><span className="muted">Premium incl. gas</span><span className="num">{best ? bps(best.premiumBps) : "…"}</span></div>
              <div className="fee-row"><span className="muted">Slippage</span><span className="num">{best ? bps(best.slippageBps) : "…"}</span></div>
              <div className="fee-row"><span className="muted">Simulation</span><span className="num">{r?.simulation ? (r.simulation.ok ? `ok${r.approvalNeeded ? " · approval first" : ""}` : "failed") : r ? (r.executable === false ? "quote only" : "runs once a wallet is connected") : "…"}</span></div>
            </div>
            {r?.executable === false && (
              <Banner kind="warn">
                <b>Quote only on this network.</b> Prices, multipliers and routes are read from the chain, but Parallax&apos;s contracts are not deployed here, so there is nothing to sign.
              </Banner>
            )}
            {r?.status === "queued_until_open" && <Banner kind="warn">Market closed: order is queued until open{r.nextOpenTime ? ` (${dt(r.nextOpenTime)})` : ""}. Allow closed-market execution in the policy to trade now within {policy.maxClosedMarketPremiumBps} bps.</Banner>}
            {r?.simulation && !r.simulation.ok && <Banner kind="bad">Simulation failed: {r.simulation.error}</Banner>}
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <TxButton tx={r?.status === "ok" && r.executable !== false ? r.tx : null} label={`Buy ${T}`} className="btn btn-primary btn-lg w-full" approval={health.data && r ? { token: health.data.deployment.usdg, spender: r.router, amount: BigInt(r.fee?.totalUsdgIn ?? r.chosen?.usdgIn ?? "0") } : undefined} disabled={!r?.tx} />
              </div>
              <button className="body-md muted whitespace-nowrap hover:opacity-70" onClick={() => setShowPolicy(!showPolicy)}>{showPolicy ? "Hide policy" : "Set policy"}</button>
            </div>
              </>
            ) : (
              <>
            {/* Sell: the exit. Any registered token can always be sold, whatever the state of its reference price. */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between body-md">
                <span>You sell</span>
                <span className="chip"><StockLogo ticker={T} src={stock.data?.logoUrl} size={18} />{sq?.chosen ? sq.candidates.find((c) => c.token === sq.chosen!.representation)?.symbol ?? T : T}</span>
              </div>
              <input className="big-num w-full bg-transparent outline-none" value={sellTokens} onChange={(e) => setSellTokens(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" aria-label={`Amount of ${T} tokens to sell`} />
              <div className="flex items-center justify-between gap-3">
                <span className="body-sm muted inline-flex items-center gap-[6px]">
                  <Ic.wallet width={15} height={15} />
                  {address ? <><span className="num">{heldTokens.toFixed(4)}</span> {held.length > 1 ? `held across ${held.length} tokens` : "held"}</> : "connect a wallet to see your holding"}
                </span>
                <span className="flex gap-2">
                  {([["25%", 0.25], ["50%", 0.5], ["Max", 1]] as const).map(([label, f]) => (
                    <button key={label} className="preset" disabled={!heldTokens} onClick={() => setSellTokens((Math.floor(heldTokens * f * 1e6) / 1e6).toString())}>{label}</button>
                  ))}
                </span>
              </div>
            </div>
            <div className="relative h-px" style={{ background: "var(--line-2)" }}><span className="swap-orb absolute left-1/2 -translate-x-1/2 -translate-y-1/2"><Ic.swap width={18} height={18} /></span></div>
            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center justify-between body-md"><span>You receive</span><span className="chip"><TokenMark symbol="USDG" size={16} />USDG</span></div>
              <div className="big-num">{sq?.chosen ? `${fmtUsdg(sq.chosen.usdgOut)} USDG` : sell.isPending ? <span className="skeleton inline-block w-40 h-8" /> : "n/a"}</div>
              <div className="body-sm muted">
                {sq?.chosen
                  ? <>{sq.chosen.why} · at least <span className="num">{fmtUsdg(sq.chosen.minUsdgOut)}</span> USDG enforced on chain, net of the fee.</>
                  : sq?.status === "no_route"
                    ? "There is no liquidity a contract can sell this token into right now."
                    : "An exit never depends on a fresh reference price: any registered token can be sold."}
              </div>
            </div>
            {sq && (
              <div className="rounded-2xl border line">
                {sq.candidates.map((c) => (
                  <div key={c.token} className="fee-row">
                    <span className="muted flex items-center gap-2">{c.symbol} <PlatformTag platform={c.platform} />{!c.eligible && <span className="body-xs">{c.reasons[0]}</span>}</span>
                    <span className="num">{c.eligible ? `${fmtUsdg(c.usdgOut)} USDG · ${bps(c.premiumBps)}` : "no route"}</span>
                  </div>
                ))}
                <div className="fee-row"><span className="muted">Protocol fee{sq.fee ? ` ${(sq.fee.bps / 100).toFixed(2)}%` : ""}</span><span className="num">{sq.fee ? `${fmtUsdg(sq.fee.usdg)} USDG` : "…"}</span></div>
                <div className="fee-row"><span className="muted">Simulation</span><span className="num">{sq.simulation ? (sq.simulation.ok ? "ok" : "failed") : sq.executable === false ? "quote only" : "runs once a wallet is connected"}</span></div>
              </div>
            )}
            <ErrorState error={sell.error} />
            {sq?.simulation && !sq.simulation.ok && <Banner kind="bad">Simulation failed: {sq.simulation.error}</Banner>}
            <TxButton
              tx={sq?.status === "ok" ? sq.tx : null}
              label={`Sell ${sellTokens || "0"} ${T}`}
              className="btn btn-primary btn-lg w-full"
              approval={sq?.chosen ? { token: sq.chosen.representation, spender: sq.router, amount: BigInt(sq.chosen.tokenAmount) } : undefined}
              approvalSymbol={T}
              disabled={!sq?.tx}
              onSent={() => { wallet.refetch(); sell.reset(); setSellTokens(""); }}
            />
              </>
            )}
            {showPolicy && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t line">
                {([["maxPremiumBps", "Max premium (open), bps"], ["maxClosedMarketPremiumBps", "Max premium (closed), bps"], ["maxSlippageBps", "Max slippage, bps"]] as const).map(([k, label]) => (
                  <label key={k} className="block"><span className="body-xs muted">{label}</span><input className="input mt-1" type="number" value={policy[k]} onChange={(e) => setPolicy({ ...policy, [k]: Number(e.target.value) })} /></label>
                ))}
                <label className="col-span-2 flex items-center gap-2 body-sm"><input type="checkbox" checked={policy.allowClosedMarket} onChange={(e) => setPolicy({ ...policy, allowClosedMarket: e.target.checked })} /> allow closed-market execution</label>
              </div>
            )}
          </div>
        </section>

        {stock.data && (
          <div className="body-xs muted px-1 flex flex-wrap items-center gap-x-4 gap-y-2">
            <span className="font-medium">Token contract</span>
            {stock.data.representations.map((x) => (
              <span key={x.token} className="inline-flex items-center gap-[6px]">
                <StockLogo ticker={T} src={stock.data?.logoUrl} size={14} />{x.symbol}
                <AddressLink value={x.token} />
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
