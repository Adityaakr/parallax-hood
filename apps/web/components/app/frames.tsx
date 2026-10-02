"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { BasketDetail, Health, Receipt, ResolveResponse } from "@/lib/api";
import { DEFAULT_CHAIN, resolverUrlOrNull } from "@/lib/config";
import { fmt, fmtUsdg, usd, bps, short, venueName, platformName } from "@/lib/format";

/* Product frames used on the landing page. Built in React (not images) so they are crisp at any size and show
   the product's real surfaces. Nothing in them is written by hand: every figure is read from the resolver when
   the frame mounts, the frame names the network it came from, and a frame whose resolver does not answer says
   so and shows no numbers. The landing page has no query provider, so these fetch on their own and share one
   request per endpoint. */

const cache = new Map<string, Promise<unknown>>();
function load<T>(path: string, body?: unknown): Promise<T> {
  const base = resolverUrlOrNull(DEFAULT_CHAIN);
  if (!base) return Promise.reject(new Error("no resolver configured"));
  const key = `${path}${body ? JSON.stringify(body) : ""}`;
  let p = cache.get(key);
  if (!p) {
    p = fetch(`${base}${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(key)); // a failed request is retried by the next frame that mounts
    cache.set(key, p);
  }
  return p as Promise<T>;
}
type Live<T> = { data: T | null; state: "loading" | "ok" | "down" };
function useLive<T>(path: string, body?: unknown): Live<T> {
  const [v, set] = useState<Live<T>>({ data: null, state: "loading" });
  useEffect(() => {
    let on = true;
    load<T>(path, body).then((data) => on && set({ data, state: "ok" }), () => on && set({ data: null, state: "down" }));
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return v;
}

/** The order every quote frame shows: the stock and the USDG amount are inputs, everything else is the answer. */
const QUOTE = { ticker: "NVDA", side: "buy", usdAmount: "100" } as const;
const INDEX = "pxMAG7";
const useQuote = () => useLive<ResolveResponse>("/resolve", QUOTE);
/** Where the numbers in a frame come from, and whether that network is made of mocks. */
function useSource() {
  const h = useLive<Health>("/health");
  if (h.state === "loading") return "…";
  if (!h.data?.label) return "resolver not reachable";
  return `${h.data.label.name}${h.data.label.mocked.length ? " · mock data" : ""}`;
}
const Down = () => <div className="p-4 text-[12px] muted">The resolver is not reachable, so there is nothing to show here.</div>;
const Wait = () => <div className="p-4 text-[12px] muted">Reading from the resolver…</div>;

export function Frame({ title, meta, children, className = "" }: { title: ReactNode; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`frame min-w-0 ${className}`}>
      <div className="frame-bar">
        <span className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          <span className="w-2 h-2 rounded-full" style={{ background: "var(--accent)" }} />
          <b>{title}</b>
        </span>
        <span className="mono text-[11px] whitespace-nowrap overflow-hidden text-ellipsis pl-3 min-w-0">{meta}</span>
      </div>
      {children}
    </div>
  );
}

export const Ok = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5">
    <span className="inline-flex w-3.5 h-3.5 rounded-full items-center justify-center shrink-0" style={{ background: "var(--good)" }}>
      <svg width="8" height="8" viewBox="0 0 10 10"><path d="M2 5l2.2 2.2L8 3" stroke="#fff" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </span>
    {children}
  </span>
);
export const No = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center gap-1.5" style={{ color: "var(--bad)" }}>
    <span className="inline-flex w-3.5 h-3.5 rounded-full items-center justify-center shrink-0" style={{ background: "var(--bad)" }}>
      <svg width="8" height="8" viewBox="0 0 10 10"><path d="M3 3l4 4M7 3l-4 4" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></svg>
    </span>
    {children}
  </span>
);

const Th = ({ children, right = false }: { children: ReactNode; right?: boolean }) => <th className={right ? "text-right" : ""}>{children}</th>;
const Td = ({ children, right = false, className = "" }: { children: ReactNode; right?: boolean; className?: string }) => (
  <td className={`${right ? "text-right whitespace-nowrap" : ""} ${className}`}>{children}</td>
);

/* ---------- Resolver: the candidates for one order, as the resolver ranks them ---------- */
export function ResolveFrame({ compact = false, venue = true, mini = false }: { compact?: boolean; venue?: boolean; mini?: boolean }) {
  compact = compact || mini;
  const showVenue = venue && !compact;
  const showRatio = !mini;
  const q = useQuote();
  const source = useSource();
  const r = q.data;
  return (
    <Frame title={mini ? `Resolve · ${QUOTE.ticker}` : `Resolve · ${QUOTE.ticker} · ${QUOTE.usdAmount} USDG`} meta={source}>
      {q.state === "down" ? <Down /> : !r ? <Wait /> : (
        <>
          <table className={`grid ${compact ? "text-[12px] [&_td]:!px-3 [&_th]:!px-3" : ""}`}>
            <thead>
              <tr>
                <Th>Token</Th>
                {showRatio && <Th>{compact ? "Sh / token" : "Shares / token"}</Th>}
                {showVenue && <Th>Venue</Th>}
                <Th right>{mini ? "Cost / sh" : "Cost / share"}</Th>
                <Th right>vs ref</Th>
              </tr>
            </thead>
            <tbody>
              {r.candidates.map((c) => {
                const chosen = r.chosen?.split.some((s) => s.token.toLowerCase() === c.token.toLowerCase()) ?? false;
                const priced = c.costPerShareUsd !== "0";
                return (
                  <tr key={c.token} className={chosen ? "chosen" : ""}>
                    <Td className="whitespace-nowrap">
                      <span className="font-semibold">{c.symbol}</span> {!mini && <span className="tag ml-1">{platformName(c.platform)}</span>} {!compact && chosen && <span className="tag tag-green ml-1">chosen</span>}
                    </Td>
                    {showRatio && <Td className="num whitespace-nowrap">{fmt(c.ratio, 18, 6)}{!compact && c.ratioSource === "ERC8056" && <span className="muted-2 text-[11px]"> on chain</span>}</Td>}
                    {showVenue && <Td className="num whitespace-nowrap">{venueName(c.venue)}</Td>}
                    <Td right className="num font-medium">{priced ? usd(c.costPerShareUsd) : "n/a"}</Td>
                    <Td right className="num">{priced ? bps(c.premiumBps) : "n/a"}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className={`grid ${mini ? "grid-cols-1 gap-2" : compact ? "grid-cols-2 gap-4" : "grid-cols-3 gap-4"} px-4 py-3 border-t line text-[12px]`} style={{ background: "var(--soft)" }}>
            <div className={mini ? "flex justify-between items-baseline" : ""}>
              <div className="muted whitespace-nowrap">minShares · on chain</div>
              <div className="num font-medium mt-0.5">{r.chosen ? `${fmt(r.chosen.minShares, 18, 6)} sh` : "no route"}</div>
            </div>
            <div className={mini ? "flex justify-between items-baseline" : ""}>
              <div className="muted">reference</div>
              <div className="num mt-0.5 whitespace-nowrap">{usd(r.referencePrice)}</div>
            </div>
            {!compact && <div>
              <div className="muted">quote</div>
              <div className="mono mt-0.5">{short(r.quoteHash, 10)}</div>
            </div>}
          </div>
        </>
      )}
    </Frame>
  );
}

/* ---------- ShareRouter: minShares in shares, not tokens ---------- */
export function RouterFrame() {
  const q = useQuote();
  const r = q.data;
  const c = r?.chosen ? r.candidates.find((x) => r.chosen!.split.some((s) => s.token.toLowerCase() === x.token.toLowerCase())) : undefined;
  const floorPct = r?.chosen && BigInt(r.chosen.sharesOut) > 0n ? Number((BigInt(r.chosen.minShares) * 10_000n) / BigInt(r.chosen.sharesOut)) / 100 : null;
  const rows: [string, ReactNode][] = r?.chosen && c ? [
    ["target", <span key="t">{venueName(c.venue)} · allowlisted</span>],
    ["approval", "forceApprove(maxIn), then reset to 0"],
    ["sharesOut", <span className="num" key="s">{fmt(r.chosen.sharesOut, 18, 4)} sh = {fmt(c.tokensOut, 18, 6)} {c.symbol} × {fmt(c.ratio, 18, 6)}</span>],
    ["minShares", <span className="num" key="m">{fmt(r.chosen.minShares, 18, 4)} sh{floorPct !== null ? ` (${floorPct.toFixed(1)}%)` : ""}</span>],
  ] : [];
  return (
    <Frame title="ShareRouter.buyShares" meta="share-denominated slippage">
      {q.state === "down" ? <Down /> : !r ? <Wait /> : !r.chosen || !c ? <div className="p-4 text-[12px] muted">No route for this order right now.</div> : (
        <div className="p-4">
          <div className="mono text-[12px] muted">buyShares({r.underlying}, {fmtUsdg(r.chosen.usdgIn)} USDG, minShares, legs[])</div>
          <div className="mt-4 space-y-3">
            <div>
              <div className="flex justify-between text-[12px]"><span className="muted">shares out</span><span className="num font-medium">{fmt(r.chosen.sharesOut, 18, 4)}</span></div>
              <div className="bar mt-1.5"><span style={{ width: "100%", background: "var(--accent-dark)" }} /></div>
            </div>
            <div>
              <div className="flex justify-between text-[12px]"><span className="muted">minShares{floorPct !== null ? ` (${floorPct.toFixed(1)}%)` : ""}</span><span className="num">{fmt(r.chosen.minShares, 18, 4)}</span></div>
              <div className="bar mt-1.5"><span style={{ width: `${floorPct ?? 100}%`, background: "var(--accent-soft)" }} /></div>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-[92px_1fr] gap-y-1.5 text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 pt-3 border-t line text-[12px]"><Ok>Σ shares ≥ minShares → RouteReceipt(quoteHash, sharesOut, …)</Ok></div>
        </div>
      )}
    </Frame>
  );
}

/* ---------- Index: what one unit is, in shares, with backing per constituent once anything is minted ---------- */
export function BasketFrame({ rows = 7 }: { rows?: number }) {
  const b = useLive<BasketDetail>(`/baskets/${INDEX}`);
  const source = useSource();
  const d = b.data;
  const minted = d ? BigInt(d.totalSupply ?? "0") > 0n : false;
  const ratios = (d?.constituents ?? []).map((c) => c.backingRatio).filter((x): x is number => x !== null);
  const top = Math.max(1, ...(d?.constituents ?? []).map((c) => c.weightBps ?? 0));
  return (
    <Frame title={`${INDEX} · index`} meta={d ? `${d.constituents.length} constituents · ${source}` : source}>
      {b.state === "down" ? <Down /> : !d ? <Wait /> : (
        <>
          <div className="grid grid-cols-2 divide-x line border-b line">
            <div className="p-4">
              <div className="muted text-[12px] whitespace-nowrap">Backing · in shares</div>
              <div className="numeral text-[32px] leading-none mt-2">{minted && ratios.length ? Math.min(...ratios).toFixed(4) : "≥ 1.00"}</div>
              <div className="text-[11px] mt-2">{minted ? <span className={d.backingOk ? "tag tag-green" : "tag"}>{d.backingOk ? "≥ 1.00 on every constituent" : "below 1.00"}</span> : <span className="muted-2">the rule every mint is checked against</span>}</div>
            </div>
            <div className="p-4">
              <div className="muted text-[12px] whitespace-nowrap">NAV / unit · display</div>
              <div className="numeral text-[32px] leading-none mt-2">{usd(d.navPerUnitUsd)}</div>
              <div className="text-[11px] muted-2 mt-1">units are shares; no oracle to mint or redeem</div>
            </div>
          </div>
          <div className="p-4 space-y-2.5">
            {d.constituents.slice(0, rows).map((c) => (
              <div key={c.ticker} className="grid grid-cols-[52px_64px_1fr_56px] items-center gap-3 text-[12px]">
                <span className="font-semibold">{c.ticker}</span>
                <span className="muted num">{fmt(c.sharesPerUnit, 18, 4)} sh/u</span>
                <div className="bar"><span style={{ width: `${((c.weightBps ?? 0) / top) * 100}%`, background: "var(--accent-dark)" }} /></div>
                <span className="num text-right">{c.backingRatio !== null ? <Ok>{c.backingRatio.toFixed(4)}</Ok> : c.weightBps !== null && c.weightBps !== undefined ? `${(c.weightBps / 100).toFixed(1)}%` : ""}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Frame>
  );
}

/* ---------- Agent mandate: what the contract checks. No figures: the owner sets them. ---------- */
export function MandateFrame() {
  const caps: [string, string][] = [["Per-tx cap", "in USDG, set by the owner"], ["Daily cap", "24-hour window from the first spend"], ["Expiry", "checked on every call"], ["Allowed", "the stocks and indices the owner lists"], ["Recipient", "owner, always"]];
  return (
    <Frame title="AgentMandate" meta="enforced on chain">
      <dl className="p-4 grid grid-cols-[110px_1fr] gap-y-2 text-[12px]">
        {caps.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="muted">{k}</dt>
            <dd><Ok>{v}</Ok></dd>
          </div>
        ))}
      </dl>
      <div className="px-4 py-3 border-t line text-[12px]" style={{ background: "var(--soft)" }}>
        <div className="mono">agent → an order above the per-tx cap</div>
        <div className="mt-1.5"><No>reverts: PerTxCapExceeded(amount, cap)</No></div>
        <div className="muted-2 mt-1">checked before sending, then enforced by the contract</div>
      </div>
    </Frame>
  );
}

/* ---------- Receipt: the fill links to its scoring record. The newest one the resolver has indexed, or the fields it will carry. ---------- */
export function ReceiptFrame() {
  const rs = useLive<{ receipts: Receipt[] }>("/receipts?limit=1");
  const h = useLive<Health>("/health");
  const source = useSource();
  const r = rs.data?.receipts[0];
  const usdgIn = r && h.data ? r.token_in.toLowerCase() === h.data.deployment.usdg.toLowerCase() : false;
  const rows: [string, ReactNode][] = r ? [
    ["event", <span className="mono" key="e">RouteReceipt</span>],
    ["action", r.action],
    ["underlying", r.underlying],
    ["tokenOut", <span className="mono" key="t">{short(r.representation, 8)}</span>],
    ["ratio", <span className="num" key="r">{fmt(r.ratio, 18, 6)} sh / token</span>],
    ["sharesOut", <span className="num" key="s">{fmt(r.shares_out, 18, 6)}</span>],
    ["amountIn", <span className="num" key="u">{usdgIn ? `${fmtUsdg(r.amount_in)} USDG` : fmt(r.amount_in, 18, 6)}</span>],
    ["quoteHash", <span className="mono" key="q">{short(r.quote_hash, 12)}</span>],
    ["tx", <span className="mono" key="x">{short(r.tx_hash, 10)}</span>],
  ] : [
    ["event", <span className="mono" key="e">RouteReceipt</span>],
    ["underlying", "the stock that was bought or sold"],
    ["tokenOut", "the token received"],
    ["ratio", "shares per token at execution"],
    ["sharesOut", "tokens received × ratio"],
    ["amountIn", "USDG spent"],
    ["quoteHash", "the scoring record this fill was built from"],
  ];
  return (
    <Frame title="Receipt" meta={rs.state === "ok" ? `${r ? "latest" : "none yet"} · ${source}` : source}>
      {rs.state === "down" ? <Down /> : rs.state === "loading" ? <Wait /> : (
        <>
          <dl className="p-4 grid grid-cols-[92px_1fr] gap-y-2 text-[12px]">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="muted">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <div className="px-4 py-3 border-t line text-[12px] muted" style={{ background: "var(--soft)" }}>
            {r ? "Open the scoring record: the candidates, their cost per share and the policy that produced this fill." : "No fill has been indexed on this network yet. These are the fields every receipt carries."}
          </div>
        </>
      )}
    </Frame>
  );
}
