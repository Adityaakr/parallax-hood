"use client";
import { Fragment, Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useApi, type Health, type Receipt } from "@/lib/api";
import { fmt, fmtUsdg, short, ago, venueName, platformName } from "@/lib/format";
import { Loading, ErrorState, Banner, Tag, A } from "@/components/ui";
import { useNetwork } from "@/lib/network";
import { explorerTx } from "@/lib/config";
import { Page, PageHead } from "@/components/Page";
import { AddressLink } from "@/components/app/AddressLink";

type Cand = { symbol: string; platform: string; venue: string; costPerShareUsd: string; premiumBps: number; slippageBps: number; eligible: boolean; reasons: string[] };
type QuoteDoc = { hash: string; kind: string; createdAt: number; record: Record<string, unknown> & { candidates?: Cand[]; chosen?: { why?: string } | null; breakdown?: unknown; policy?: unknown; why?: string; dataSource?: string } };

function Why({ hash }: { hash: string }) {
  const q = useApi<QuoteDoc>(`/quotes/${hash}`);
  if (q.isLoading) return <Loading rows={2} />;
  if (q.error) return <Banner kind="warn">Scoring record not found on this resolver ({q.error.message}). Records are stored by the resolver instance that built the transaction.</Banner>;
  const r = q.data!.record;
  const cands = r.candidates ?? [];
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs muted">
        kind {q.data!.kind} · recorded {new Date(q.data!.createdAt).toISOString()} · data source {String(r.dataSource ?? "?")}
      </div>
      {r.chosen && typeof r.chosen === "object" && r.chosen.why && (
        <div>
          <span className="font-medium">Why:</span> {r.chosen.why}
        </div>
      )}
      {typeof r.why === "string" && (
        <div>
          <span className="font-medium">Why:</span> {r.why}
        </div>
      )}
      {cands.length > 0 && (
        <table className="grid">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Venue</th>
              <th>Cost / share</th>
              <th>Premium</th>
              <th>Slippage</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {cands.map((c) => (
              <tr key={c.symbol}>
                <td className="num">
                  {c.symbol} <Tag>{platformName(c.platform)}</Tag>
                </td>
                <td className="num text-xs">{venueName(c.venue)}</td>
                <td className="num">{c.costPerShareUsd === "0" ? "n/a" : `$${c.costPerShareUsd}`}</td>
                <td className="num">{c.costPerShareUsd === "0" ? "n/a" : `${c.premiumBps} bps`}</td>
                <td className="num">{c.costPerShareUsd === "0" ? "n/a" : `${c.slippageBps} bps`}</td>
                <td className="text-xs">{c.eligible ? "eligible" : c.reasons.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {Array.isArray(r.breakdown) && (
        <div className="text-xs">
          <div className="font-medium">Index fills</div>
          {(r.breakdown as Array<{ ticker: string; fills: Array<{ symbol: string; shares: string; costPerShareUsd: string; premiumBps: number | null }> }>).map((b) => (
            <div key={b.ticker}>
              <span className="num">{b.ticker}</span>: {b.fills.map((f) => `${f.symbol} ${fmt(f.shares, 18, 6)} sh @ $${f.costPerShareUsd}${f.premiumBps === null ? "" : ` (${f.premiumBps} bps)`}`).join(", ")}
            </div>
          ))}
        </div>
      )}
      {r.policy !== undefined && <div className="text-xs muted">policy {JSON.stringify(r.policy)}</div>}
      <details className="text-xs">
        <summary className="cursor-pointer muted">raw record</summary>
        <pre className="num overflow-x-auto mt-1 p-2 card">{JSON.stringify(r, null, 1)}</pre>
      </details>
    </div>
  );
}

function ReceiptsInner() {
  const sp = useSearchParams();
  const { chainId } = useNetwork();
  const [actor, setActor] = useState(sp.get("actor") ?? "");
  const [underlying, setUnderlying] = useState(sp.get("underlying") ?? "");
  const tx = sp.get("tx");
  const quote = sp.get("quote");
  const qs = new URLSearchParams();
  if (actor) qs.set("actor", actor);
  if (underlying) qs.set("underlying", underlying);
  if (tx) qs.set("txHash", tx);
  if (quote) qs.set("quoteHash", quote);
  qs.set("limit", "100");
  const q = useApi<{ receipts: Receipt[] }>(`/receipts?${qs}`, { refetchInterval: 10_000 });
  /* `amount_in` is in the units of `token_in`: raw USDG has 6 decimals, a stock token being sold has 18 */
  const usdg = useApi<Health>("/health").data?.deployment.usdg.toLowerCase();
  const [open, setOpen] = useState<string | null>(quote ?? null);

  return (
    <div className="space-y-4">
      <PageHead
        eyebrow="Audit trail"
        title="Receipts"
        lede={<>Every fill emits a <span className="mono">RouteReceipt</span> with the shares received and the token&apos;s multiplier at execution, and a <span className="mono">quoteHash</span> that links to the resolver&apos;s scoring record, the &quot;why&quot; behind every route.</>}
      />
      <div className="flex gap-2 flex-wrap items-center">
        <input className="input !w-64 num" placeholder="actor 0x…" value={actor} onChange={(e) => setActor(e.target.value)} />
        <input className="input !w-32" placeholder="underlying" value={underlying} onChange={(e) => setUnderlying(e.target.value.toUpperCase())} />
        {(tx || quote) && (
          <span className="text-xs muted">
            filtered by {tx ? "tx" : "quote"} <span className="num">{(tx ?? quote)!.slice(0, 14)}…</span> · <A href="/receipts">clear</A>
          </span>
        )}
      </div>
      {quote && !q.data?.receipts.length && (
        <div className="panel p-5">
          <div className="text-sm font-medium mb-2">Scoring record {quote.slice(0, 18)}… (no receipt on chain yet)</div>
          <Why hash={quote} />
        </div>
      )}
      {q.isLoading && <Loading rows={5} />}
      <ErrorState error={q.error} retry={() => q.refetch()} />
      {q.data && q.data.receipts.length === 0 && !quote && <Banner>No receipts yet on this network. Buy a stock or mint an index and it will appear here within a few seconds.</Banner>}
      {q.data && q.data.receipts.length > 0 && (
        <div className="panel overflow-x-auto">
          <table className="grid wide">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Underlying</th>
                <th>In</th>
                <th>Representation</th>
                <th>Tokens out</th>
                <th>Shares out</th>
                <th>Shares / token</th>
                <th>Actor</th>
                <th>Tx</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {q.data.receipts.map((r) => {
                const key = `${r.tx_hash}-${r.log_index}`;
                const tokenIn = r.token_in.toLowerCase();
                const usdgIn = usdg ? tokenIn === usdg : tokenIn !== r.representation.toLowerCase();
                const ex = explorerTx(chainId, r.tx_hash);
                return (
                  <Fragment key={key}>
                    <tr>
                      <td className="text-xs muted">{r.timestamp ? ago(r.timestamp) : `#${r.block_number}`}</td>
                      <td>
                        <Tag>{r.action}</Tag>
                      </td>
                      <td className="font-medium">{r.underlying}</td>
                      <td className="num">
                        {usdgIn ? `${fmtUsdg(r.amount_in)} USDG` : `${fmt(r.amount_in, 18, 6)} tok`}
                      </td>
                      <td className="text-xs"><AddressLink value={r.representation} truncate /></td>
                      <td className="num">{fmt(r.tokens_out, 18, 6)}</td>
                      <td className="num">{fmt(r.shares_out, 18, 6)}</td>
                      <td className="num">{fmt(r.ratio, 18, 6)}</td>
                      <td className="text-xs"><AddressLink value={r.actor} truncate /></td>
                      <td className="text-xs num">{ex ? <A href={ex}>{short(r.tx_hash, 8)}</A> : short(r.tx_hash, 8)}</td>
                      <td>
                        <button className="btn text-xs" onClick={() => setOpen(open === r.quote_hash ? null : r.quote_hash)}>
                          {open === r.quote_hash ? "hide" : "why"}
                        </button>
                      </td>
                    </tr>
                    {open === r.quote_hash && (
                      <tr>
                        <td colSpan={11}>
                          <div className="p-2">
                            <div className="text-xs muted mb-2">
                              quote <span className="num">{r.quote_hash}</span>
                            </div>
                            <Why hash={r.quote_hash} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReceiptsPageInner() {
  return (
    <Suspense fallback={<Loading />}>
      <ReceiptsInner />
    </Suspense>
  );
}

export default function ReceiptsPage() {
  return (
    <Page>
      <ReceiptsPageInner />
    </Page>
  );
}
