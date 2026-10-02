"use client";
/* The index shelf: every curated index priced by the resolver, with the return over a chosen period, the smallest
   amount that can mint it, and the names inside it. Deployed or not is stated on the card. */
import Link from "next/link";
import { useState } from "react";
import { useApi, type BasketCard, type Period } from "@/lib/api";
import { usd } from "@/lib/format";
import { Loading, ErrorState, Empty } from "@/components/ui";
import { Page, PageHead } from "@/components/Page";
import { Ic } from "@/components/app/icons";
import { CoverageNote, LogoCluster, PERIOD_LONG, PeriodSeg, ReturnValue } from "@/components/app/index-ui";
import { TokenMark } from "@/components/app/TokenMark";

function IndexCard({ b, period }: { b: BasketCard; period: Period }) {
  const ret = b.performance.returns[period];
  return (
    <Link href={`/baskets/${b.symbol}`} className="panel flex flex-col gap-5 p-[25px] transition-colors hover:bg-[var(--color-card-2)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3"><TokenMark symbol={b.symbol} size={30} /><span aria-hidden className="w-px self-stretch my-1" style={{ background: "var(--line-2)" }} /><LogoCluster items={b.allocation} /></div>
        <span className="tag whitespace-nowrap" style={b.deployed ? { borderColor: "transparent", background: "rgba(31,122,69,.12)", color: "var(--good)" } : undefined}>
          {b.deployed ? "live here" : "not deployed here"}
        </span>
      </div>
      <div>
        <div className="flex items-baseline gap-3">
          <h2 className="h5">{b.name}</h2>
          <span className="mono muted">{b.symbol}</span>
        </div>
        {b.thesis && <p className="body-sm muted mt-2">{b.thesis}</p>}
      </div>
      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-3 pt-5" style={{ borderTop: "var(--dash)" }}>
        <div>
          <div className="eyebrow whitespace-nowrap" style={{ lineHeight: "14px" }}>{PERIOD_LONG[period]} return</div>
          <ReturnValue bps={ret} className="block mt-3 card-figure" />
        </div>
        <div>
          <div className="eyebrow whitespace-nowrap" style={{ lineHeight: "14px" }}>Minimum</div>
          <div className="num mt-3 card-figure">{usd(b.minUsd, 0)}</div>
        </div>
        <div>
          <div className="eyebrow whitespace-nowrap" style={{ lineHeight: "14px" }}>NAV / unit</div>
          <div className="num mt-3 card-figure">{b.navPerUnitUsd ? usd(b.navPerUnitUsd) : "n/a"}</div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <CoverageNote perf={b.performance} />
        <span className="inline-flex items-center gap-1 body-sm font-medium shrink-0" style={{ color: "var(--brand)" }}>View index <Ic.trend width={14} height={14} /></span>
      </div>
    </Link>
  );
}

function BasketsInner() {
  const [period, setPeriod] = useState<Period>("m1");
  const q = useApi<{ dataSource: string; quoteOnly?: boolean; baskets: BasketCard[] }>("/baskets", { refetchInterval: 30_000 });
  return (
    <>
      <PageHead
        eyebrow="Indices"
        title="Indices defined in shares."
        lede="One unit is a fixed number of underlying shares per constituent, bought with USDG. The vault checks that backing on chain after every mint, and redeeming in kind can never be paused."
        right={<PeriodSeg value={period} onChange={setPeriod} />}
      />
      {q.isLoading && (
        <div className="flex flex-col gap-3">
          <Loading />
          <p className="body-sm muted px-1">Pricing every constituent of every index. A cold resolver takes a few seconds.</p>
        </div>
      )}
      <ErrorState error={q.error} retry={() => q.refetch()} />
      {q.data && q.data.baskets.length === 0 && <Empty>No indices on this network yet.</Empty>}
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-[10px]">
        {q.data?.baskets.map((b) => <IndexCard key={b.symbol} b={b} period={period} />)}
      </div>

    </>
  );
}

export default function Baskets() {
  return (
    <Page>
      <BasketsInner />
    </Page>
  );
}
