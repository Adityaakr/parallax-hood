"use client";
/*
 * The rebalance trail for one index.
 *
 * What a Parallax vault can actually do is narrow, and the section says so plainly: it may swap one token that
 * represents a constituent for another token that represents the same stock, and only when the shares it holds
 * strictly increase. Weights never move, nothing is ever sold for cash, and the call is permissionless. On
 * Robinhood Chain each stock has one token today, so the trail is usually empty; the rule is in the contract
 * for the day a second one exists. "Executed" is what the vault has emitted; "Next" is what the resolver finds
 * accretive right now.
 */
import { useState } from "react";
import { fmt, ago, platformName } from "@/lib/format";
import { explorerTx } from "@/lib/config";
import { Loading, Tag } from "@/components/ui";
import { TxButton } from "@/components/TxButton";
import { Ic } from "./icons";
import { StockLogo } from "./StockLogo";
import type { Allocation, Migration, RebalanceTrail, Rebalance } from "@/lib/api";

const day = (ts: number) => (ts ? new Date(ts * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "n/a");
const share = (shares: string, total: string | null) => {
  const t = Number(total ?? "0");
  return t > 0 ? `${((Number(shares) / t) * 100).toFixed(1)}%` : null;
};

/** One constituent's issuer split, before → after: the reference's weight rows, computed from the quote record. */
function Split({ split, before, after, logo }: { split: NonNullable<Rebalance["split"]>; before: string | null; after: string | null; logo?: string | null }) {
  const moved = split.filter((r) => r.shares !== r.sharesAfter);
  if (moved.length === 0) return null;
  return (
    <div className="rb-split">
      {moved.map((r) => {
        const from = share(r.shares, before);
        const to = share(r.sharesAfter, after);
        const up = Number(r.sharesAfter) > Number(r.shares);
        return (
          <div key={r.symbol} className="rb-split-row">
            <span className="flex items-center gap-2 min-w-0">
              <StockLogo ticker={r.symbol} src={logo} size={20} />
              <span className="num truncate">{r.symbol}</span>
              <span className="body-xs muted">{platformName(r.platform)}</span>
            </span>
            <span className="flex items-center gap-2 whitespace-nowrap">
              <span className="num muted">{from ?? `${fmt(r.shares, 18, 4)} sh`}</span>
              <span className="muted">→</span>
              <span className="num" style={{ color: up ? "var(--good)" : "var(--bad)" }}>{to ?? `${fmt(r.sharesAfter, 18, 4)} sh`}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Card({ title, stamp, right, badge, children, open, onToggle }: {
  title: string; stamp: string; right: string; badge?: React.ReactNode; children: React.ReactNode; open: boolean; onToggle: () => void;
}) {
  return (
    <div className="rb" data-open={open}>
      <button className="rb-head" onClick={onToggle} aria-expanded={open}>
        <span className="flex flex-col gap-1 min-w-0 text-left">
          <span className="body-md font-medium truncate">{title}</span>
          <span className="body-xs muted">{stamp}</span>
        </span>
        <span className="flex items-center gap-3 shrink-0">
          {badge}
          <span className="body-xs muted">{right}</span>
          <span className="rb-chevron muted"><Ic.chevron width={16} height={16} /></span>
        </span>
      </button>
      {open && <div className="rb-body">{children}</div>}
    </div>
  );
}

export function Rebalances({ trail, migrations, chainId, logos, minted, onExecuted }: {
  trail: { data?: RebalanceTrail; isLoading: boolean };
  migrations: { data?: Migration[]; isLoading: boolean; refetch: () => void };
  chainId: number;
  logos: Allocation[];
  /** units outstanding: an empty vault has nothing to move, which is a different answer from "nothing was better" */
  minted: number;
  onExecuted: () => void;
}) {
  const executed = trail.data?.executed ?? [];
  const next = migrations.data ?? [];
  const [tab, setTab] = useState<"executed" | "next">("executed");
  const [open, setOpen] = useState<string | null>(null);
  const show = tab === "executed" || executed.length === 0 ? (executed.length === 0 && tab === "executed" ? "executed" : tab) : tab;
  const logoFor = (ticker: string) => logos.find((a) => a.ticker === ticker)?.logoUrl ?? null;
  const last = executed[0];

  return (
    <section id="rebalance" className="flex flex-col gap-2 scroll-mt-[90px]">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-2">
        <div className="flex flex-col gap-1" style={{ maxWidth: 560 }}>
          <h2 className="h5">Rebalances</h2>
          <p className="body-xs muted">
            A rebalance may only swap one token that represents a stock for another token of the same stock, and
            only when the shares held strictly increase, so index weights never change and nothing is ever sold
            for cash. Anyone may call it. Each stock has one token on Robinhood Chain today, so there is usually
            nothing to move; the rule is in the vault for when there is.
          </p>
        </div>
        <div className="seg">
          <button data-on={show === "executed"} onClick={() => setTab("executed")}>Executed{executed.length ? ` ${executed.length}` : ""}</button>
          <button data-on={show === "next"} onClick={() => setTab("next")}>Next{next.length ? ` ${next.length}` : ""}</button>
        </div>
      </div>

      <div className="panel stat-row">
        <div className="stat">
          <div className="stat-label"><Ic.target width={14} height={14} />Floor</div>
          <div className="stat-value">{trail.data ? `${trail.data.minGainBps} bps` : "…"}</div>
          <div className="stat-sub">the share gain a move must clear before the resolver proposes it</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Ic.layers width={14} height={14} />Version</div>
          <div className="stat-value">{trail.data ? `v${trail.data.version}` : "…"}</div>
          <div className="stat-sub">{executed.length === 0 ? "the composition it launched with" : `${executed.length} rebalance${executed.length === 1 ? "" : "s"} since launch`}</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Ic.clock width={14} height={14} />Last rebalance</div>
          <div className="stat-value">{last ? ago(last.timestamp) : "never"}</div>
          <div className="stat-sub">{last ? `${last.ticker}: ${last.from} → ${last.to}` : next.length ? `${next.length} accretive move${next.length === 1 ? "" : "s"} on the table now` : minted === 0 ? "nothing minted into this vault yet" : "nothing accretive on the table right now"}</div>
        </div>
      </div>

      {show === "executed" ? (
        <div className="panel rb-list">
          {trail.isLoading && <Loading rows={2} />}
          {executed.map((r) => {
            const id = `${r.txHash}:${r.quoteHash}`;
            const link = explorerTx(chainId, r.txHash);
            return (
              <Card
                key={id}
                title={r.from && r.to ? `${r.ticker}: ${r.from} → ${r.to}` : `${r.ticker} rebalanced`}
                stamp={`v${r.fromVersion}→v${r.toVersion}`}
                right={ago(r.timestamp)}
                badge={r.gainBps !== null ? <span className="num" style={{ color: "var(--good)" }}>+{r.gainBps} bps</span> : undefined}
                open={open === id}
                onToggle={() => setOpen(open === id ? null : id)}
              >
                <ul className="rb-points">
                  <li>The vault held <span className="num">{fmt(r.heldSharesBefore ?? "0", 18, 6)}</span> {r.ticker} shares and now holds <span className="num">{fmt(r.heldSharesAfter ?? "0", 18, 6)}</span>, a gain of <span className="num" style={{ color: "var(--good)" }}>{fmt(r.shareGain, 18, 6)}</span>, which is the number the vault checked before it let the call through.</li>
                  {r.why && <li>{r.why}</li>}
                  {!r.quoteRecord && <li>This resolver does not hold the scoring record for this quote, so only the vault&apos;s own figures are shown.</li>}
                </ul>
                {r.split && <Split split={r.split} before={r.heldSharesBefore} after={r.heldSharesAfter} logo={logoFor(r.ticker)} />}
                <div className="rb-sources">
                  <span className="body-xs muted">Sources</span>
                  {link ? <a className="link body-xs" href={link} target="_blank" rel="noreferrer">transaction {r.txHash.slice(0, 10)}…</a> : <span className="mono body-xs">{r.txHash.slice(0, 14)}…</span>}
                  <span className="mono body-xs muted" title="the scoring record this call was checked against">quote {r.quoteHash.slice(0, 10)}…</span>
                  <span className="body-xs muted">block {r.blockNumber.toLocaleString("en-US")}</span>
                </div>
              </Card>
            );
          })}
          {!trail.isLoading && executed.length === 0 && (
            <div className="rb-empty body-sm muted">
              {minted === 0
                ? "No rebalance yet: nothing has been minted into this vault, so it holds no shares to move."
                : `No rebalance yet. Nothing has cleared the ${trail.data ? `${trail.data.minGainBps} bps ` : ""}floor since this index went live. Next shows what is on the table right now.`}
            </div>
          )}
          {trail.data?.liveSince && (
            <div className="rb-genesis">
              <span className="flex items-center gap-2"><Ic.flag width={15} height={15} /><span className="body-md font-medium">Index went live</span><Tag>v1</Tag></span>
              <span className="body-xs muted">{day(trail.data.liveSince.timestamp)} · block {trail.data.liveSince.block.toLocaleString("en-US")}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="panel rb-list">
          {migrations.isLoading && <Loading rows={2} />}
          {next.map((m) => (
            <Card
              key={m.quoteHash}
              title={`${m.ticker}: ${m.from} → ${m.to}`}
              stamp={`${m.fractionBps / 100}% of the ${m.from} held${trail.data ? ` · would take the index to v${trail.data.version + 1}` : ""}`}
              right="priced now"
              badge={<span className="num" style={{ color: "var(--good)" }}>+{m.gainBps} bps</span>}
              open={open === m.quoteHash}
              onToggle={() => setOpen(open === m.quoteHash ? null : m.quoteHash)}
            >
              <ul className="rb-points">
                <li>{m.why}</li>
                <li>The vault would refuse this call below <span className="num">{fmt(m.minShareGain, 18, 6)}</span> shares gained, so a route that moves against us reverts instead of settling.</li>
              </ul>
              {m.split && <Split split={m.split} before={m.heldSharesBefore ?? null} after={m.heldSharesAfter ?? null} logo={logoFor(m.ticker)} />}
              <div className="rb-sources">
                <span className="body-xs muted">Sources</span>
                <span className="mono body-xs muted">quote {m.quoteHash.slice(0, 10)}…</span>
                {trail.data && <span className="body-xs muted">{m.gainBps >= trail.data.minGainBps ? "above the floor" : "below the floor: shown, but not worth its gas yet"}</span>}
                <span className="ml-auto"><TxButton tx={m.tx} label="Rebalance now" onSent={onExecuted} /></span>
              </div>
            </Card>
          ))}
          {!migrations.isLoading && next.length === 0 && (
            <div className="rb-empty body-sm muted">
              {minted === 0
                ? "Nothing to move: the vault holds no shares yet."
                : "Nothing accretive right now. A move needs a second token for the same stock that returns more shares than it gives up once the swap costs are paid."}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
