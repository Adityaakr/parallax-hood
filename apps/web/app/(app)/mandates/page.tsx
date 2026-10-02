"use client";
import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import { encodeFunctionData, isAddress, getAddress, type Address, type Hex } from "viem";
import { AgentMandateAbi, Erc20Abi, parseWad, tickerToId } from "@parallax-hood/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, type Health, type StocksResponse, type BasketCard } from "@/lib/api";
import { useNetwork } from "@/lib/network";
import { fmt, short, dt } from "@/lib/format";
import { Loading, ErrorState, Banner, Dot, Empty, Tag } from "@/components/ui";
import { TxButton } from "@/components/TxButton";
import { Page, PageHead } from "@/components/Page";
import { Ask } from "@/components/app/Ask";
import { AddressLink } from "@/components/app/AddressLink";
import { StockLogo } from "@/components/app/StockLogo";
import { TokenMark } from "@/components/app/TokenMark";

type MandateRow = { id: bigint; owner: Address; agent: Address; perTxCapUsdt: bigint; dailyCapUsdt: bigint; expiry: bigint; active: boolean; spentInWindow: bigint; windowStart: bigint; maxSlippageBps: number; remaining: bigint };

function MandatesPageInner() {
  const { address } = useAccount();
  const { chainId } = useNetwork();
  const pub = usePublicClient({ chainId });
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const qc = useQueryClient();
  const health = useApi<Health>("/health");
  const stocks = useApi<StocksResponse>("/stocks");
  const baskets = useApi<{ baskets: BasketCard[] }>("/baskets");
  const mandateAddr = health.data?.deployment.mandate;

  const [form, setForm] = useState({ agent: "", perTx: "50", daily: "100", days: "7", slippageBps: "300", tickers: [] as string[], baskets: [] as string[] });
  const [revoking, setRevoking] = useState<string | null>(null);

  const list = useQuery<MandateRow[]>({
    queryKey: ["mandates", chainId, mandateAddr, address],
    enabled: Boolean(pub && mandateAddr && address),
    refetchInterval: 10_000,
    queryFn: async () => {
      const ids = await pub!.readContract({ address: mandateAddr!, abi: AgentMandateAbi, functionName: "mandatesOfOwner", args: [address!] });
      return Promise.all(
        ids.map(async (id) => {
          const m = await pub!.readContract({ address: mandateAddr!, abi: AgentMandateAbi, functionName: "getMandate", args: [id] });
          const remaining = await pub!.readContract({ address: mandateAddr!, abi: AgentMandateAbi, functionName: "remainingDaily", args: [id] });
          return { id, ...m, remaining };
        }),
      );
    },
  });

  const createTx = (() => {
    const slippage = Number(form.slippageBps);
    if (!mandateAddr || !isAddress(form.agent) || !Number(form.perTx) || !Number(form.daily) || !Number(form.days)) return null;
    if (!Number.isInteger(slippage) || slippage < 1 || slippage > 2000) return null;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(form.days) * 86400);
    const data = encodeFunctionData({
      abi: AgentMandateAbi,
      functionName: "createMandate",
      args: [getAddress(form.agent), parseWad(form.perTx), parseWad(form.daily), expiry, Number(form.slippageBps), form.tickers.map((t) => tickerToId(t)), form.baskets.map((b) => getAddress(b))],
    });
    return { to: mandateAddr, data: data as Hex };
  })();

  const revoke = async (id: bigint) => {
    if (!wallet || !pub || !mandateAddr) return;
    setRevoking(id.toString());
    try {
      await switchChainAsync({ chainId }).catch(() => {});
      const h = await wallet.writeContract({ address: mandateAddr, abi: AgentMandateAbi, functionName: "revoke", args: [id], chain: undefined });
      await pub.waitForTransactionReceipt({ hash: h });
      qc.invalidateQueries({ queryKey: ["mandates"] });
    } finally {
      setRevoking(null);
    }
  };

  const toggle = (k: "tickers" | "baskets", v: string) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Delegation"
        title="Agent mandates"
        lede="Try the tools first, then decide what an agent may do with them. A mandate is a contract: caps, an expiry, an allowlist and a price floor that hold whatever the agent asks for."
      />
      <ErrorState error={health.error} />

      {/* the same tools the agent is being authorized to call, so the delegation can be tried before it is signed */}
      <Ask stocks={stocks.data?.stocks ?? []} baskets={baskets.data?.baskets ?? []} mandates={list.data ?? []} />

      {/* what this delegation is part of, named rather than implied */}
      <section className="panel stack-panel">
        <div className="stack-head">
          <span className="body-md font-medium">The agent stack this plugs into</span>
          <span className="body-xs muted">every piece below is wired in the repository, with the runs to show for it</span>
        </div>
        <div className="stack-grid">
          {[
            { k: "AgentMandate", v: "The contract on this page. Caps, expiry, allowlist and a price floor, enforced onchain. The agent never receives the assets: the recipient is hardcoded to the owner.", t: "BSC mainnet" },
            { k: "MCP server", v: "Fifteen tools for any MCP client. Fourteen read; one writes, and it can only write through a mandate. Ask, above, runs the same ones from the browser.", t: "stdio + HTTP" },
            { k: "BNB Agent Studio", v: "A seller agent scaffolded with the bag CLI: an A2A card, an MCP face and an x402 endpoint on one runtime, with an ERC-8004 identity (agent #2453) and ERC-8183 escrowed jobs.", t: "agent/" },
            { k: "Binance Agentic Wallet", v: "A second opinion on execution: the wallet quotes the same order per issuer, and a preview hands our calldata to Binance's simulation and risk parse before anything is broadcast.", t: "mainnet only" },
            { k: "Binance Web3 API", v: "The RWA catalogue behind every ratio, attestation date and market status the keeper posts, plus the aggregator quotes and the RFQ desk that fill the stocks with no pool.", t: "signed, live" },
            { k: "x402 · B402", v: "The seller takes one paid or free HTTP request, settled before the work runs. A free passthrough and an escrowed job have both invested through a mandate end to end.", t: "recorded runs" },
          ].map((x) => (
            <div key={x.k} className="stack-cell">
              <div className="flex items-center justify-between gap-3">
                <span className="body-md font-medium">{x.k}</span>
                <span className="tag">{x.t}</span>
              </div>
              <p className="body-sm muted">{x.v}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-[10px] items-start">
        <div className="panel p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="h5">Create a mandate</div>
            <p className="body-sm muted">
              A per-transaction cap, a daily cap over a 24-hour window from the first spend, the worst execution price
              against the Chainlink or keeper reference, an expiry, and the stocks and indices it may touch. Outputs
              always go to you, never to the agent, and revocation is instant.
            </p>
          </div>

          <label className="block">
            <span className="body-xs muted">Agent address</span>
            <input className="input num mt-1" placeholder="0x… (the key your MCP server holds)" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} />
          </label>

          <div className="mandate-fields">
            {(
              [
                ["perTx", "Per-transaction cap", "USDT"],
                ["daily", "Daily cap", "USDT"],
                ["days", "Expires in", "days"],
                ["slippageBps", "Max slippage", "bps, up to 2000"],
              ] as const
            ).map(([k, label, unit]) => (
              <label key={k} className="mandate-field">
                <span className="body-xs muted">{label}</span>
                <input className="input num" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} inputMode="decimal" />
                <span className="body-xs muted">{unit}</span>
              </label>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <span className="body-xs muted">Allowed stocks{form.tickers.length > 0 ? ` · ${form.tickers.length} selected` : ""}</span>
            <div className="flex flex-wrap gap-[6px]">
              {stocks.data?.stocks.map((s) => (
                <button key={s.ticker} className="pick" data-on={form.tickers.includes(s.ticker) || undefined} onClick={() => toggle("tickers", s.ticker)} type="button">
                  <StockLogo ticker={s.ticker} src={s.logoUrl} size={17} />{s.ticker}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="body-xs muted">Allowed indices{form.baskets.length > 0 ? ` · ${form.baskets.length} selected` : ""}</span>
            <div className="flex flex-wrap gap-[6px]">
              {baskets.data?.baskets.filter((b): b is BasketCard & { address: `0x${string}` } => b.address !== null).map((b) => (
                <button key={b.address} className="pick" data-on={form.baskets.includes(b.address) || undefined} onClick={() => toggle("baskets", b.address)} type="button">
                  <TokenMark symbol={b.symbol} size={17} />{b.symbol}
                </button>
              ))}
            </div>
          </div>

          {Number(form.perTx) > Number(form.daily) && <Banner kind="warn">Per-transaction cap must not exceed the daily cap.</Banner>}
          <p className="body-xs muted">Creating also asks you to approve the daily cap in USDT to the mandate contract. It pulls USDT from you per trade, never more than the caps.</p>
          <TxButton
            tx={createTx}
            label="Create mandate"
            className="btn btn-primary btn-lg w-full"
            approval={health.data && mandateAddr ? { token: health.data.deployment.usdt, spender: mandateAddr, amount: parseWad(form.daily || "0") } : undefined}
            disabled={!createTx || Number(form.perTx) > Number(form.daily)}
            onSent={() => qc.invalidateQueries({ queryKey: ["mandates"] })}
          />
        </div>

        <div className="space-y-3">
          <div className="font-medium">Your mandates</div>
          {!address && <Empty>Connect a wallet to see your mandates.</Empty>}
          {address && list.isLoading && <Loading />}
          {list.error && <Banner kind="bad">{(list.error as Error).message.split("\n")[0]}</Banner>}
          {address && list.data && list.data.length === 0 && <Empty>No mandates yet.</Empty>}
          {list.data?.map((m) => {
            const expired = Number(m.expiry) * 1000 < Date.now();
            const live = m.active && !expired;
            const spentPct = m.dailyCapUsdt === 0n ? 0 : Number((m.spentInWindow * 100n) / m.dailyCapUsdt);
            return (
              <div key={m.id.toString()} className="panel p-5 body-sm space-y-2">
                <div className="flex justify-between items-baseline">
                  <div>
                    <Dot kind={live ? "good" : "muted"} />#{m.id.toString()} · agent <AddressLink value={m.agent} />
                  </div>
                  <Tag>{!m.active ? "revoked" : expired ? "expired" : "active"}</Tag>
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <div>
                    <div className="muted">per tx</div>
                    <div className="num">{fmt(m.perTxCapUsdt, 18, 2)} USDT</div>
                  </div>
                  <div>
                    <div className="muted">daily</div>
                    <div className="num">{fmt(m.dailyCapUsdt, 18, 2)} USDT</div>
                  </div>
                  <div>
                    <div className="muted">worst price</div>
                    <div className="num">−{(m.maxSlippageBps / 100).toFixed(2)}% vs ref</div>
                  </div>
                  <div>
                    <div className="muted">expires</div>
                    <div className="num">{dt(Number(m.expiry) * 1000)}</div>
                  </div>
                </div>
                <div>
                  <div className="text-xs muted mb-1">
                    spent today <span className="num">{fmt(m.spentInWindow, 18, 2)}</span> · remaining <span className="num">{fmt(m.remaining, 18, 2)}</span> USDT
                  </div>
                  <div className="bar">
                    <span style={{ width: `${Math.min(100, spentPct)}%`, background: "var(--accent)" }} />
                  </div>
                </div>
                {live && (
                  <button className="btn" disabled={revoking === m.id.toString()} onClick={() => revoke(m.id)}>
                    {revoking === m.id.toString() ? "Revoking…" : "Revoke (instant)"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function MandatesPage() {
  return (
    <Page>
      <MandatesPageInner />
    </Page>
  );
}
