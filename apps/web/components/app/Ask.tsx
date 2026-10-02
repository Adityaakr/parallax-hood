"use client";
/*
 * Ask: the agent's tool surface, in a text box.
 *
 * The MCP server gives an agent fifteen tools; this runs the same ones from the browser, so a person can do in
 * one line what an agent does in one call, and see the identical result: the route that was chosen, why, the
 * quote hash it is recorded under, and the transaction to sign.
 *
 * There is no model in this path on purpose. A sentence is matched to one tool and its arguments by rules that
 * are visible in this file, the resolver answers, and the answer is rendered from that response. Nothing here
 * can invent a number, and an unparsed sentence says so rather than guessing.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { apiRequest, useApiBase, type BasketCard, type MintQuote, type RedeemQuote, type ResolveResponse, type Receipt, type Stock } from "@/lib/api";
import { fmt, usd, short } from "@/lib/format";
import { A, Banner, Tag } from "@/components/ui";
import { TxButton } from "@/components/TxButton";
import { Ic } from "./icons";
import { TokenMark } from "./TokenMark";
import { StockLogo } from "./StockLogo";
import { AddressLink } from "@/components/app/AddressLink";

export type MandateSummary = {
  id: bigint; agent: `0x${string}`; perTxCapUsdt: bigint; dailyCapUsdt: bigint; remaining: bigint;
  expiry: bigint; active: boolean; maxSlippageBps: number;
};

type Plan =
  | { tool: "resolve_stock"; ticker: string; usd: number }
  | { tool: "quote_basket_mint"; symbol: string; usd: number }
  | { tool: "quote_basket_redeem"; symbol: string; units: string }
  | { tool: "get_stock"; ticker: string }
  | { tool: "search_stocks"; query: string }
  | { tool: "get_receipts" }
  | { tool: "get_mandate" }
  | { tool: "help"; reason: string };

type Turn = { id: number; q: string; plan: Plan; pending: boolean; error?: string; data?: unknown };

const AMOUNT = /\$\s?([\d,]+(?:\.\d+)?)|\b([\d,]+(?:\.\d+)?)\s?(?:usdt|usd|dollars?)\b/i;
const UNITS = /\b([\d.]+)\s?(?:units?|px[a-z0-9]+)\b/i;

/** One sentence to one tool. Everything it matches on is a ticker or a basket the resolver already told us about. */
export function plan(q: string, ctx: { tickers: string[]; baskets: string[] }): Plan {
  const s = q.trim();
  const low = s.toLowerCase();
  if (!s || /^(help|\?|what can .*(you|i) do)/.test(low)) return { tool: "help", reason: "" };
  if (/\b(receipt|activity|history|what did|my trades)\b/.test(low)) return { tool: "get_receipts" };
  if (/\b(mandate|allowed to|my agent|delegat)/.test(low)) return { tool: "get_mandate" };

  const m = AMOUNT.exec(s);
  const amount = m ? Number((m[1] ?? m[2]).replace(/,/g, "")) : null;
  const basket = ctx.baskets.find((b) => low.includes(b.toLowerCase()));
  const ticker = ctx.tickers.find((t) => new RegExp(`\\b${t.toLowerCase()}\\b`).test(low));

  if (basket) {
    if (/\b(redeem|sell|exit|cash out)\b/.test(low)) {
      const u = UNITS.exec(s);
      return { tool: "quote_basket_redeem", symbol: basket, units: u?.[1] ?? "1" };
    }
    if (amount) return { tool: "quote_basket_mint", symbol: basket, usd: amount };
    return { tool: "help", reason: `How much would you like to put into ${basket}? Try “invest $50 in ${basket}”.` };
  }
  if (ticker) {
    if (/\b(compare|issuer|where|which|route|cheaper|versus|vs)\b/.test(low) || !amount) return { tool: "get_stock", ticker };
    return { tool: "resolve_stock", ticker, usd: amount };
  }
  const word = low.match(/\b[a-z]{2,12}\b/g)?.filter((w) => !["buy", "the", "for", "with", "into", "invest", "show", "what", "usdt", "usd", "worth", "some", "best", "give", "find"].includes(w));
  if (word?.length) return { tool: "search_stocks", query: word[word.length - 1]! };
  return { tool: "help", reason: `I could not find a stock or an index in that.` };
}

const TOOL_LABEL: Record<Plan["tool"], string> = {
  resolve_stock: "resolve_stock",
  quote_basket_mint: "quote_basket_mint",
  quote_basket_redeem: "quote_basket_redeem",
  get_stock: "resolve_stock · candidates",
  search_stocks: "search_stocks",
  get_receipts: "get_receipts",
  get_mandate: "get_mandate",
  help: "none",
};

/* Grouped the way the product divides: put money in, find the cheaper side, look at what you hold, get out. */
const GROUPS: { label: string; items: { q: string; mark: string }[] }[] = [
  { label: "Invest", items: [
    { q: "Invest $50 in pxMAG7", mark: "pxMAG7" },
    { q: "Buy $100 of NVDA", mark: "NVDA" },
    { q: "Put $250 into pxAI", mark: "pxAI" },
  ] },
  { label: "Compare", items: [
    { q: "Compare issuers for MSFT", mark: "MSFT" },
    { q: "Which issuer is cheaper for NVDA", mark: "NVDA" },
    { q: "Where does AAPL have liquidity", mark: "AAPL" },
  ] },
  { label: "Your position", items: [
    { q: "What do I hold?", mark: "" },
    { q: "Show my receipts", mark: "" },
    { q: "What is my agent allowed to do?", mark: "" },
  ] },
  { label: "Get out", items: [
    { q: "Sell 2 NVDA", mark: "NVDA" },
    { q: "Redeem 1 pxMAG7", mark: "pxMAG7" },
  ] },
];

export function Ask({ stocks, baskets, mandates }: { stocks: Stock[]; baskets: BasketCard[]; mandates: MandateSummary[] }) {
  const base = useApiBase();
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const next = useRef(1);
  const scroller = useRef<HTMLDivElement>(null);
  const end = useRef<HTMLDivElement>(null);
  /* the newest turn is the one you asked for, so it is the one kept in view */
  useEffect(() => {
    if (turns.length === 0) return;
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);
  const ctx = useMemo(() => ({ tickers: stocks.map((s) => s.ticker), baskets: baskets.map((b) => b.symbol) }), [stocks, baskets]);
  /* the catalogue already carries each company's mark; the resolver's candidates do not repeat it */
  const logoOf = (p: Plan) => ("ticker" in p ? stocks.find((s) => s.ticker === p.ticker)?.logoUrl ?? null : null);

  async function run(q: string) {
    const p = plan(q, ctx);
    const id = next.current++;
    setTurns((t) => [...t, { id, q, plan: p, pending: p.tool !== "help" && p.tool !== "get_mandate" }]);
    const finish = (patch: Partial<Turn>) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, pending: false, ...patch } : x)));
    try {
      if (p.tool === "help") return;
      if (p.tool === "get_mandate") return finish({ data: mandates });
      if (p.tool === "resolve_stock") {
        const r = await apiRequest<ResolveResponse>(base, "/resolve", { method: "POST", body: JSON.stringify({ ticker: p.ticker, side: "buy", usdAmount: String(p.usd), wallet: address }) });
        return finish({ data: r });
      }
      if (p.tool === "quote_basket_mint") {
        const r = await apiRequest<MintQuote>(base, `/baskets/${p.symbol}/quote-mint`, { method: "POST", body: JSON.stringify({ budgetUsdt: String(p.usd), wallet: address }) });
        return finish({ data: r });
      }
      if (p.tool === "quote_basket_redeem") {
        const r = await apiRequest<RedeemQuote>(base, `/baskets/${p.symbol}/quote-redeem`, { method: "POST", body: JSON.stringify({ units: p.units, inKind: false, wallet: address }) });
        return finish({ data: r });
      }
      if (p.tool === "get_stock") {
        const r = await apiRequest<ResolveResponse>(base, "/resolve", { method: "POST", body: JSON.stringify({ ticker: p.ticker, side: "buy", usdAmount: "100", wallet: address }) });
        return finish({ data: r });
      }
      if (p.tool === "get_receipts") {
        const r = await apiRequest<{ receipts: Receipt[] }>(base, `/receipts?limit=8${address ? `&actor=${address}` : ""}`);
        return finish({ data: r.receipts });
      }
    } catch (e) {
      finish({ error: (e as Error).message });
    }
  }

  const composer = (
    <form
      className="ask-composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (!input.trim()) return;
        void run(input.trim());
        setInput("");
      }}
    >
      <span className="ask-composer-mark"><Ic.spark width={17} height={17} /></span>
      <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Invest $50 in pxMAG7" aria-label="Ask" />
      <button className="btn btn-primary" type="submit" disabled={!input.trim()}>Show the quote</button>
    </form>
  );

  if (turns.length === 0) {
    return (
      <section className="ask-hero">
        <div className="flex flex-col gap-3" style={{ maxWidth: 680 }}>
          <h2 className="h3">What do you want to do?</h2>
          <p className="body-md muted">
            Say it in a sentence. It runs the same tools the MCP server gives an agent, with no model between your
            question and the chain, and nothing is signed until you review it.
          </p>
        </div>
        {composer}
        <div className="ask-groups">
          {GROUPS.map((g) => (
            <div key={g.label} className="ask-group">
              <span className="ask-group-label">{g.label}</span>
              <div className="ask-group-items">
                {g.items.map((it) => (
                  <button key={it.q} className="ask-suggest" onClick={() => void run(it.q)} type="button">
                    {it.mark ? <Mark symbol={it.mark} stocks={stocks} /> : <span className="ask-suggest-dot" />}
                    {it.q}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className="panel ask">
      <div className="ask-head">
        <span className="flex items-center gap-2"><Ic.spark width={16} height={16} /><span className="body-md font-medium">Ask</span></span>
        <span className="flex items-center gap-2">
          <span className="chip" title="search_stocks, resolve_stock, quote_basket_mint, quote_basket_redeem, get_mandate, get_receipts and nine more">15 MCP tools</span>
          <button className="preset" onClick={() => setTurns([])}>Clear</button>
        </span>
      </div>

      <div className="ask-body" ref={scroller}>
        {turns.map((t) => (
          <div key={t.id} className="ask-turn">
            <div className="ask-q">{t.q}</div>
            <div className="ask-card">
              <div className="ask-tool">
                <span className={`dot ${t.pending ? "dot-warn" : t.error ? "dot-bad" : "dot-good"}`} />
                <span className="mono">{TOOL_LABEL[t.plan.tool]}</span>
                {t.pending && <span className="muted">running…</span>}
              </div>
              <div className="ask-out">
                {t.error ? <Banner kind="bad">{t.error}</Banner> : <Answer turn={t} mandates={mandates} logo={logoOf(t.plan)} />}
              </div>
            </div>
          </div>
        ))}
        <div ref={end} />
      </div>

      <div className="ask-foot">
        {composer}
        <div className="ask-chips">
          {GROUPS.flatMap((g) => g.items).slice(0, 5).map((it) => (
            <button key={it.q} className="preset" onClick={() => void run(it.q)}>{it.q}</button>
          ))}
        </div>
      </div>
    </section>
  );
}

/** The mark of whatever the suggestion is about: an index token, or the company behind a ticker. */
function Mark({ symbol, stocks }: { symbol: string; stocks: Stock[] }) {
  if (symbol.toLowerCase().startsWith("px")) return <TokenMark symbol={symbol} size={18} />;
  const s = stocks.find((x) => x.ticker === symbol);
  return <StockLogo ticker={symbol} src={s?.logoUrl} size={18} />;
}

/** Whether the mandate the owner already signed would carry this spend. The allowlist is enforced onchain. */
function MandateCheck({ usdAmount, mandates }: { usdAmount: number; mandates: MandateSummary[] }) {
  const live = mandates.filter((m) => m.active && Number(m.expiry) * 1000 > Date.now());
  if (live.length === 0 || !usdAmount) return null;
  const m = live[0]!;
  const perTx = Number(m.perTxCapUsdt) / 1e18;
  const left = Number(m.remaining) / 1e18;
  const ok = usdAmount <= perTx && usdAmount <= left;
  return (
    <div className="body-xs muted" style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className={`dot ${ok ? "dot-good" : "dot-warn"}`} />
      {ok
        ? <>Mandate #{String(m.id)} would carry this: {usd(usdAmount)} is inside the {usd(perTx)} per-transaction cap, with {usd(left)} left today.</>
        : <>Mandate #{String(m.id)} would refuse this: cap {usd(perTx)} per transaction, {usd(left)} left today.</>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="fee-row"><span className="muted">{k}</span><span className="num">{v}</span></div>;
}

/** Every branch renders only fields the resolver returned; nothing is filled in when a field is missing. */
function Answer({ turn, mandates, logo }: { turn: Turn; mandates: MandateSummary[]; logo?: string | null }) {
  const p = turn.plan;
  if (p.tool === "help") {
    return (
      <div className="body-sm muted">
        {p.reason || "Ask for a quote on a stock or an index, for the issuers behind a stock, for your receipts, or for what your agent is allowed to do."}
      </div>
    );
  }
  if (turn.pending) return <div className="skeleton h-16 w-full rounded-xl" />;
  if (turn.data === undefined) return null;

  if (p.tool === "get_mandate") {
    if (mandates.length === 0) return <div className="body-sm muted">No mandate on this wallet yet. Create one below and the agent can act inside it.</div>;
    return (
      <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
        {mandates.map((m) => (
          <div key={String(m.id)}>
            <Row k={`Mandate #${String(m.id)} · agent`} v={<span className="body-xs"><AddressLink value={m.agent} /></span>} />
            <Row k="Per transaction" v={`${fmt(m.perTxCapUsdt, 18, 2)} USDT`} />
            <Row k="Left today" v={`${fmt(m.remaining, 18, 2)} of ${fmt(m.dailyCapUsdt, 18, 2)} USDT`} />
            <Row k="Worst price it may accept" v={`${(m.maxSlippageBps / 100).toFixed(2)}% under the reference`} />
            <Row k="Status" v={m.active && Number(m.expiry) * 1000 > Date.now() ? "active" : "expired or revoked"} />
          </div>
        ))}
      </div>
    );
  }

  if (p.tool === "get_receipts") {
    const rs = turn.data as Receipt[];
    if (rs.length === 0) return <div className="body-sm muted">No receipts indexed for this wallet yet.</div>;
    return (
      <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
        {rs.slice(0, 5).map((r) => (
          <div key={`${r.tx_hash}-${r.log_index}`} className="fee-row">
            <span className="muted">{r.action} · {r.underlying}</span>
            <span className="num">{fmt(r.shares_out, 18, 6)} sh <span className="mono body-xs muted">{r.tx_hash.slice(0, 10)}…</span></span>
          </div>
        ))}
      </div>
    );
  }

  if (p.tool === "search_stocks") return <div className="body-sm muted">Nothing matched “{p.query}”. Try a ticker such as NVDA, or an index such as pxMAG7.</div>;

  if (p.tool === "resolve_stock" || p.tool === "get_stock") {
    const r = turn.data as ResolveResponse;
    const best = r.candidates.find((c) => c.eligible) ?? r.candidates[0];
    return (
      <div className="flex flex-col gap-3">
        {p.tool === "resolve_stock" && r.chosen && best && (
          <div className="ask-headline">
            <span className="num">{fmt(r.chosen.sharesOut, 18, 6)}</span> shares of {r.underlying} for {usd(p.usd)}
            <span className="body-sm muted"> · through {best.symbol}</span>
          </div>
        )}
        <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
          {r.candidates.map((c) => (
            <div key={c.symbol} className="fee-row" style={{ opacity: c.eligible ? 1 : 0.6 }}>
              <span className="flex items-center gap-2">
                <StockLogo ticker={r.underlying} src={logo} size={18} />
                <span className="num">{c.symbol}</span>
                {c.symbol === best?.symbol && r.chosen && <Tag>chosen</Tag>}
                <Tag>{c.platform === "bstock" ? "bStocks" : c.platform}</Tag>
                {!c.eligible && <span className="body-xs muted">{c.reasons[0]}</span>}
              </span>
              <span className="num">{usd(c.costPerShareUsd)} / share <span style={{ color: c.premiumBps <= 0 ? "var(--good)" : "var(--muted)" }}>{c.premiumBps > 0 ? "+" : ""}{c.premiumBps} bps</span></span>
            </div>
          ))}
          {r.chosen && <Row k="Protected at" v={`${fmt(r.chosen.minShares, 18, 6)} shares minimum, onchain`} />}
          {r.quoteHash && <Row k="Scoring record" v={<A href={`/receipts?quote=${r.quoteHash}`}><span className="mono body-xs">{r.quoteHash.slice(0, 18)}…</span></A>} />}
        </div>
        {r.status !== "ok" && <Banner kind="warn">{r.status === "queued_until_open" ? "The market is closed; this route is priced but held until it opens." : "No executable route right now."}</Banner>}
        {p.tool === "resolve_stock" && <MandateCheck usdAmount={p.usd} mandates={mandates} />}
        {p.tool === "resolve_stock" && <TxButton tx={r.tx} label={`Buy ${usd(p.usd)} of ${r.underlying}`} className="btn btn-primary w-full" disabled={!r.tx} />}
      </div>
    );
  }

  if (p.tool === "quote_basket_mint") {
    const q = turn.data as MintQuote;
    const units = Number(q.units) / 1e18;
    const nav = q.navPerUnitUsd ? Number(q.navPerUnitUsd) : null;
    return (
      <div className="flex flex-col gap-3">
        <div className="ask-headline">
          <span className="num">{units.toFixed(4)}</span> {q.symbol}
          {nav && <span className="body-sm muted"> · {usd(units * nav)} at today&apos;s prices</span>}
        </div>
        <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
          <Row k="You spend, at most" v={`${fmt(q.maxUsdtIn, 18, 2)} USDT`} />
          {q.fee && <Row k={`Fee · ${(q.fee.bps / 100).toFixed(2)}%`} v={usd(fmt(q.fee.usdt, 18, 2))} />}
          <Row k="Legs" v={`${q.breakdown.length} constituents, each from its cheapest issuer`} />
          <Row k="Scoring record" v={<A href={`/receipts?quote=${q.quoteHash}`}><span className="mono body-xs">{q.quoteHash.slice(0, 18)}…</span></A>} />
        </div>
        {q.problems.length > 0 && <Banner kind="warn">{q.problems.join(" · ")}</Banner>}
        <MandateCheck usdAmount={p.usd} mandates={mandates} />
        <TxButton tx={q.tx} label={`Invest ${usd(p.usd)} in ${q.symbol}`} className="btn btn-primary w-full" disabled={!q.tx}
          approval={q.tx ? { token: q.usdt, spender: q.basket, amount: BigInt(q.maxUsdtIn) } : undefined} />
      </div>
    );
  }

  if (p.tool === "quote_basket_redeem") {
    const q = turn.data as RedeemQuote;
    return (
      <div className="flex flex-col gap-3">
        <div className="ask-headline"><span className="num">{fmt(q.usdtOut, 18, 2)}</span> USDT for {p.units} {p.symbol}</div>
        <div className="rounded-2xl" style={{ border: "var(--dash)" }}>
          <Row k="Guaranteed onchain" v={`${fmt(q.minUsdtOut, 18, 2)} USDT minimum`} />
          <Row k="Slices" v={`${q.slices.length} representations sold`} />
        </div>
        <TxButton tx={q.tx} label={`Redeem ${p.units} ${p.symbol}`} className="btn btn-primary w-full" disabled={!q.tx} />
      </div>
    );
  }
  return null;
}
