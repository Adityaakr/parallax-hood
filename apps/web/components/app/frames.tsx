"use client";
import type { ReactNode } from "react";

/* Product frames used on the landing page. Built in React (not images) so they are crisp at any size, follow the
   theme, and show the product's real surfaces. Every number is from the mainnet-fork run of 17 Sep 2026
   (docs/recon.md, docs/decisions.md) and is labeled as such where it appears. */

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
const Td = ({ children, right = false, className = "", colSpan }: { children: ReactNode; right?: boolean; className?: string; colSpan?: number }) => (
  <td className={`${right ? "text-right whitespace-nowrap" : ""} ${className}`} colSpan={colSpan}>{children}</td>
);

/* ---------- Resolver: ranked representations for one order ---------- */
export function ResolveFrame({ compact = false, venue = true, mini = false }: { compact?: boolean; venue?: boolean; mini?: boolean }) {
  compact = compact || mini;
  const showVenue = venue && !compact;
  const showRatio = !mini;
  return (
    <Frame title={mini ? "Resolve · NVDA" : "Resolve · NVDA · 100 USDT"} meta={mini ? "mainnet fork" : "mainnet fork · 17 Sep 2026"}>
      <table className={`grid ${compact ? "text-[12px] [&_td]:!px-3 [&_th]:!px-3" : ""}`}>
        <thead>
          <tr>
            <Th>{mini ? "Token" : "Representation"}</Th>
            {showRatio && <Th>Ratio</Th>}
            {showVenue && <Th>Venue</Th>}
            <Th right>{mini ? "Cost / sh" : "Cost / share"}</Th>
            <Th right>{mini ? "vs ref" : "vs Chainlink"}</Th>
            {!compact && <Th right>Attestation</Th>}
          </tr>
        </thead>
        <tbody>
          <tr className="chosen">
            <Td className="whitespace-nowrap">
              <span className="font-semibold">NVDAB</span> {!mini && <span className="tag ml-1">bStocks</span>} {!compact && <span className="tag tag-green ml-1">chosen</span>}
            </Td>
            {showRatio && <Td className="num whitespace-nowrap">1.000778{!compact && <span className="muted-2 text-[11px]"> onchain</span>}</Td>}
            {showVenue && <Td className="num whitespace-nowrap">PancakeSwap v3 · 0.25%</Td>}
            <Td right className="num font-medium">$219.01</Td>
            <Td right className="num" >
              <span style={{ color: "var(--accent-dark)" }}>−8 bps</span>
            </Td>
            {!compact && <Td right className="num"><Ok>0.1 h</Ok></Td>}
          </tr>
          <tr>
            <Td className="whitespace-nowrap">
              <span className="font-semibold">NVDAon</span> {!mini && <span className="tag ml-1">Ondo</span>}
            </Td>
            {showRatio && <Td className="num whitespace-nowrap">1.003701{!compact && <span className="muted-2 text-[11px]"> keeper</span>}</Td>}
            {showVenue && <Td className="num whitespace-nowrap">PancakeSwap v3 · 1% · thin</Td>}
            <Td right className="num">$219.88</Td>
            <Td right className="num">+31 bps</Td>
            {!compact && <Td right className="num"><Ok>0.1 h</Ok></Td>}
          </tr>
        </tbody>
      </table>
      <div className={`grid ${mini ? "grid-cols-1 gap-2" : compact ? "grid-cols-2 gap-4" : "grid-cols-3 gap-4"} px-4 py-3 border-t line text-[12px]`} style={{ background: "var(--soft)" }}>
        <div className={mini ? "flex justify-between items-baseline" : ""}>
          <div className="muted whitespace-nowrap">minShares · onchain</div>
          <div className="num font-medium mt-0.5">0.454321 sh</div>
        </div>
        <div className={mini ? "flex justify-between items-baseline" : ""}>
          <div className="muted">simulation</div>
          <div className="mt-0.5 whitespace-nowrap"><Ok>{mini ? "ok" : "ok · from sender address"}</Ok></div>
        </div>
        {!compact && <div>
          <div className="muted">quote</div>
          <div className="mono mt-0.5">0x7c3c1f3e…4041</div>
        </div>}
      </div>
    </Frame>
  );
}

/* ---------- ShareRouter: minShares in shares, not tokens ---------- */
export function RouterFrame() {
  const rows: [string, ReactNode][] = [
    ["target", <span className="mono" key="t">SmartRouter 0x13f4…8Dd4 · allowlisted</span>],
    ["approval", "forceApprove(maxIn) → reset to 0"],
    ["sharesOut", <span className="num" key="s">0.4566 sh = 0.456245 NVDAB × 1.000778</span>],
    ["minShares", <span className="num" key="m">0.4543 sh (99.5 %)</span>],
  ];
  return (
    <Frame title="ShareRouter.buyShares" meta="share-denominated slippage">
      <div className="p-4">
        <div className="mono text-[12px] muted">buyShares(NVDA, 100e18 USDT, minShares = 0.4543e18, legs[])</div>
        <div className="mt-4 space-y-3">
          <div>
            <div className="flex justify-between text-[12px]"><span className="muted">shares out</span><span className="num font-medium">0.4566</span></div>
            <div className="bar mt-1.5"><span style={{ width: "100%", background: "var(--accent-dark)" }} /></div>
          </div>
          <div>
            <div className="flex justify-between text-[12px]"><span className="muted">minShares (99.5 %)</span><span className="num">0.4543</span></div>
            <div className="bar mt-1.5"><span style={{ width: "99.5%", background: "var(--accent-soft)" }} /></div>
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
    </Frame>
  );
}

/* ---------- Basket: composition with backing per constituent ---------- */
/* pxMAG7 as deployed on BSC mainnet (0x38bf68E3…9728): shares per unit from the vault, the bar is each
   constituent's weight by value at today's reference prices. */
const MAG7: [string, string, number][] = [["NVDA", "0.0644", 93], ["AAPL", "0.0425", 91], ["MSFT", "0.0289", 91], ["AMZN", "0.0561", 91], ["GOOGL", "0.0407", 93], ["META", "0.0213", 100], ["TSLA", "0.0391", 92]];
export function BasketFrame({ rows = 7 }: { rows?: number }) {
  return (
    <Frame title="pxMAG7 · index" meta="7 constituents · live on mainnet">
      <div className="grid grid-cols-2 divide-x line border-b line">
        <div className="p-4">
          <div className="muted text-[12px] whitespace-nowrap">Backing · in shares</div>
          <div className="numeral text-[32px] leading-none mt-2">1.0031</div>
          <div className="text-[11px] mt-2"><span className="tag tag-green">≥ 1.00 on every constituent</span></div>
        </div>
        <div className="p-4">
          <div className="muted text-[12px] whitespace-nowrap">NAV / unit · display</div>
          <div className="numeral text-[32px] leading-none mt-2">$103.30</div>
          <div className="text-[11px] muted-2 mt-1">units are shares; no oracle to mint or redeem</div>
        </div>
      </div>
      <div className="p-4 space-y-2.5">
        {MAG7.slice(0, rows).map(([t, sh, w]) => (
          <div key={t} className="grid grid-cols-[52px_64px_1fr_56px] items-center gap-3 text-[12px]">
            <span className="font-semibold">{t}</span>
            <span className="muted num">{sh} sh/u</span>
            <div className="bar"><span style={{ width: `${w}%`, background: "var(--accent-dark)" }} /></div>
            <span className="num text-right"><Ok>1.0001</Ok></span>
          </div>
        ))}
      </div>
    </Frame>
  );
}

/* ---------- Migration: monotone check ---------- */
export function MigrateFrame() {
  return (
    <Frame title="BasketVault.migrate" meta="permissionless · monotone">
      <div className="p-4 text-[12px]">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div className="card p-3">
            <div className="muted">from</div>
            <div className="font-semibold mt-0.5">NVDAon <span className="tag ml-1">Ondo</span></div>
            <div className="num muted mt-1">0.300000 sh held</div>
          </div>
          <span className="muted-2 text-lg">→</span>
          <div className="card p-3">
            <div className="muted">to</div>
            <div className="font-semibold mt-0.5">NVDAB <span className="tag ml-1">bStocks</span></div>
            <div className="num muted mt-1">0.300144 sh after</div>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          <li><Ok>NVDA shares strictly rise · +0.000144 ≥ minShareGain</Ok></li>
          <li><Ok>no other constituent decreases</Ok></li>
          <li><Ok>vault USDT does not decrease · issuer cap 80% holds</Ok></li>
        </ul>
        <div className="mt-4 pt-3 border-t line flex items-center justify-between">
          <span className="muted">1% pool at block 61.2M</span>
          <No>not share-accretive → revert</No>
        </div>
      </div>
    </Frame>
  );
}

/* ---------- Agent mandate: caps the agent cannot break ---------- */
export function MandateFrame() {
  const caps: [string, string][] = [["Per-tx cap", "$50"], ["Daily cap", "$100 · $50 spent"], ["Expiry", "in 7 days"], ["Allowed", "NVDA · pxMAG7"], ["Recipient", "owner, always"]];
  return (
    <Frame title="AgentMandate #1" meta="active · onchain">
      <dl className="p-4 grid grid-cols-[110px_1fr] gap-y-2 text-[12px]">
        {caps.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="muted">{k}</dt>
            <dd><Ok>{v}</Ok></dd>
          </div>
        ))}
      </dl>
      <div className="px-4 py-3 border-t line text-[12px]" style={{ background: "var(--soft)" }}>
        <div className="mono">agent → buy $500 NVDA</div>
        <div className="mt-1.5"><No>refused: exceeds per-tx cap 50</No></div>
        <div className="muted-2 mt-1">checked before sending · enforced by AgentMandate onchain</div>
      </div>
    </Frame>
  );
}

/* ---------- Receipt: the fill links to its scoring record ----------
   A real RouteReceipt from the hybrid end-to-end run on BSC testnet (tx 0xb1895466…dc8e, block 132,504,752):
   the NVDA leg of a $100 pxMAG7 mint. Ratio, shares and quote hash are the values the contract emitted. */
export function ReceiptFrame() {
  const rows: [string, ReactNode][] = [
    ["event", <span className="mono" key="e">RouteReceipt</span>],
    ["underlying", "NVDA"],
    ["tokenOut", <span key="t">NVDAB <span className="tag ml-1">bStocks</span></span>],
    ["ratio", <span className="num" key="r">1.000778 sh / token</span>],
    ["sharesOut", <span className="num" key="s">0.062731</span>],
    ["usdtIn", <span className="num" key="u">14.27</span>],
    ["quoteHash", <span className="mono" key="q">0x07157ec817eeb097…</span>],
    ["tx", <span className="mono" key="x">0xb1895466…dc8e</span>],
  ];
  return (
    <Frame title="Receipt" meta="recorded · bsc testnet">
      <dl className="p-4 grid grid-cols-[92px_1fr] gap-y-2 text-[12px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="muted">{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="px-4 py-3 border-t line text-[12px] muted" style={{ background: "var(--soft)" }}>
        Open the scoring record: candidates, premiums, attestation ages and the policy that produced this fill.
      </div>
    </Frame>
  );
}

/* ---------- Fragmentation: the same stock, two tokens ---------- */
export function FragmentationTable() {
  const rows: [string, ReactNode, ReactNode][] = [
    ["Issuer", "Ondo Global Markets", "bStocks (BTech)"],
    ["Contract", <span className="mono" key="a">0xa9ee…6f75</span>, <span className="mono" key="b">0x02fc…7436</span>],
    ["Shares per token", <span className="num" key="c">1.003701 · keeper-posted</span>, <span className="num" key="d">1.000778 · ERC-8056 onchain</span>],
    ["AMM liquidity", <span className="num" key="e">$8.7k · 1% pool</span>, <span className="num" key="f">$1.24M · 0.25% pool</span>],
    ["Primary venue", "Binance RFQ (EOA-signed)", "PancakeSwap v3"],
    ["Attestation", "daily report", "daily proof of collateral"],
    ["Controls", "pause · blocklist · upgradeable", "pause · blocklist · upgradeable"],
  ];
  return (
    <div className="frame">
      <div className="frame-bar"><b>NVDA on BNB Chain</b><span>one company · one reference price · two tokens</span></div>
      <table className="grid">
        <thead>
          <tr><Th>Attribute</Th><Th>NVDAon</Th><Th>NVDAB</Th></tr>
        </thead>
        <tbody>
          {rows.map(([k, a, b]) => (
            <tr key={k}><Td className="muted">{k}</Td><Td>{a}</Td><Td>{b}</Td></tr>
          ))}
          <tr>
            <Td className="muted">Parallax view</Td>
            <Td className="font-medium" colSpan={2}>
              <span style={{ color: "var(--accent-dark)" }}>one underlying, two routes</span>: every token measured in shares, cost per share, policy, best route
            </Td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/* ---------- Data pipeline: what feeds the resolver (vertical, for the "under the hood" column) ---------- */
export function PipelineFrame() {
  const stages: [string, string, string][] = [
    ["Binance Web3 API", "RWA ratios · attestation URLs · market status", "live with key · else fixtures"],
    ["ERC-8056 onchain", "uiMultiplier() shares-per-token for bStocks", "live"],
    ["Chainlink feeds", "reference price · deviation checks · display NAV", "live"],
    ["PancakeSwap v3 quoter", "executable quotes · slippage per leg", "live"],
    ["Resolver", "shares = tokens × ratio · cost per share · policy", "scored"],
    ["ShareRouter · BasketVault", "minShares in shares · backing ≥ 1.00 · receipt", "onchain"],
  ];
  return (
    <div className="frame">
      <div className="frame-bar"><b>Buy $100 NVDA</b><span className="mono text-[11px]">max 60 bps · attest ≤ 36 h</span></div>
      <ol className="p-4 relative">
        <div className="absolute left-[27px] top-6 bottom-6 w-px" style={{ background: "var(--line)" }} aria-hidden />
        {stages.map(([t, d, tag], i) => (
          <li key={t} className="relative pl-9 py-2.5">
            <span className="absolute left-1.5 top-3.5 w-5 h-5 rounded-full border line flex items-center justify-center text-[10px] font-semibold num" style={{ background: i >= 4 ? "var(--accent)" : "var(--bg-elev)", color: i >= 4 ? "#fff" : "var(--fg)", borderColor: i >= 4 ? "var(--accent)" : undefined }}>{i + 1}</span>
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-[13px]">{t}</span>
              <span className={`text-[10px] whitespace-nowrap ${tag === "live" || tag === "onchain" || tag === "scored" ? "tag tag-green" : "tag"}`}>{tag}</span>
            </div>
            <div className="muted text-[12px] mt-0.5">{d}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ---------- Small stat tile (evidence cards) ---------- */
export function StatTile({ big, label, tone }: { big: string; label: string; tone?: "good" | "bad" }) {
  return (
    <div className="frame w-fit min-w-[150px]">
      <div className="p-4">
        <div className="numeral text-[30px] leading-none" style={{ color: tone === "good" ? "var(--accent-dark)" : tone === "bad" ? "var(--bad)" : "var(--fg)" }}>{big}</div>
        <div className="muted text-[11px] mt-2 uppercase tracking-wider">{label}</div>
      </div>
    </div>
  );
}
