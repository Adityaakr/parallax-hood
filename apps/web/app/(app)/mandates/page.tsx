"use client";
import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient, useSwitchChain } from "wagmi";
import { encodeFunctionData, isAddress, getAddress, zeroAddress, type Address, type Hex } from "viem";
import { AgentMandateAbi, parseUsdg, tickerToId } from "@parallax-hood/sdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useApi, type Health, type StocksResponse, type BasketCard } from "@/lib/api";
import { useNetwork } from "@/lib/network";
import { fmtUsdg, dt } from "@/lib/format";
import { Loading, ErrorState, Banner, Dot, Empty, Tag } from "@/components/ui";
import { TxButton } from "@/components/TxButton";
import { Page, PageHead } from "@/components/Page";
import { Ask, MCP_READ_TOOLS, MCP_WRITE_TOOL } from "@/components/app/Ask";
import { AddressLink } from "@/components/app/AddressLink";
import { StockLogo } from "@/components/app/StockLogo";
import { TokenMark } from "@/components/app/TokenMark";

/** Caps and spend are raw USDG (6 decimals), as `AgentMandate` stores them. */
type MandateRow = { id: bigint; owner: Address; agent: Address; perTxCapUsdg: bigint; dailyCapUsdg: bigint; expiry: bigint; active: boolean; spentInWindow: bigint; windowStart: bigint; maxSlippageBps: number; remaining: bigint };

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
  /* a quote-only network reports the zero address: there is no mandate contract to read or to sign for */
  const deployedMandate = health.data?.deployment.mandate;
  const mandateAddr = deployedMandate && deployedMandate !== zeroAddress ? deployedMandate : undefined;
  /* a cap typed with more than six decimals, or not a number at all, is no cap */
  const cap = (v: string) => {
    try {
      return parseUsdg(v || "0");
    } catch {
      return 0n;
    }
  };

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
    if (!mandateAddr || !isAddress(form.agent) || cap(form.perTx) === 0n || cap(form.daily) === 0n || !Number(form.days)) return null;
    if (!Number.isInteger(slippage) || slippage < 1 || slippage > 2000) return null;
    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number(form.days) * 86400);
    const data = encodeFunctionData({
      abi: AgentMandateAbi,
      functionName: "createMandate",
      // createMandate(agent, perTxCapUsdg, dailyCapUsdg, expiry, maxSlippageBps, underlyings[], baskets[]): caps in raw 6-decimal USDG
      args: [getAddress(form.agent), cap(form.perTx), cap(form.daily), expiry, slippage, form.tickers.map((t) => tickerToId(t)), form.baskets.map((b) => getAddress(b))],
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

      {/* how an agent actually reaches this contract, named rather than implied */}
      <section className="panel stack-panel">
        <div className="stack-head">
          <span className="body-md font-medium">How an agent connects</span>
          <span className="body-xs muted">the Parallax MCP server, <span className="mono">apps/mcp</span> in the repository</span>
        </div>
        <div className="stack-grid">
          <div className="stack-cell">
            <div className="flex items-center justify-between gap-3"><span className="body-md font-medium">AgentMandate</span><span className="tag">on chain</span></div>
            <p className="body-sm muted">The contract on this page. A per-transaction cap, a daily cap, an expiry, allowlists and a price floor, all checked by the contract. The agent never receives assets: the recipient is always the owner.</p>
            <div className="body-xs muted">{mandateAddr ? <AddressLink value={mandateAddr} /> : health.data ? "not deployed on this network" : ""}</div>
          </div>
          <div className="stack-cell">
            <div className="flex items-center justify-between gap-3"><span className="body-md font-medium">MCP server</span><span className="tag">stdio · HTTP</span></div>
            <p className="body-sm muted">Any MCP client can use it. It runs over stdio for a desktop client, or as streamable HTTP on port 4110.</p>
            <div className="body-xs mono muted">http://127.0.0.1:4110/mcp</div>
          </div>
          <div className="stack-cell">
            <div className="flex items-center justify-between gap-3"><span className="body-md font-medium">Agent key</span><span className="tag">gas only</span></div>
            <p className="body-sm muted">The address you enter below is the key the server holds. It pays gas in ETH and holds nothing else: USDG is pulled from your wallet per trade, inside the caps, and what is bought goes to you.</p>
          </div>
          <div className="stack-cell">
            <div className="flex items-center justify-between gap-3"><span className="body-md font-medium">Read tools</span><span className="tag">{MCP_READ_TOOLS.length} tools</span></div>
            <p className="body-sm muted">Quotes, index data, mandate state and receipts. They build unsigned transactions and never send one.</p>
            <div className="flex flex-wrap gap-[6px]">{MCP_READ_TOOLS.map((t) => <span key={t} className="tag mono" style={{ textTransform: "none" }}>{t}</span>)}</div>
          </div>
          <div className="stack-cell">
            <div className="flex items-center justify-between gap-3"><span className="body-md font-medium">The one write tool</span><span className="tag">1 tool</span></div>
            <p className="body-sm muted">It signs with the agent key and can only act through the mandate, so caps, expiry and allowlists are enforced on chain and outputs go to the owner.</p>
            <div className="flex flex-wrap gap-[6px]"><span className="tag tag-ink mono" style={{ textTransform: "none" }}>{MCP_WRITE_TOOL}</span></div>
          </div>
          <div className="stack-cell">
            <div className="flex items-center justify-between gap-3"><span className="body-md font-medium">Ask</span><span className="tag">this page</span></div>
            <p className="body-sm muted">The box above runs the read tools from the browser with no model in between, so you can see what an agent would be told before you delegate anything.</p>
          </div>
        </div>
      </section>

      <div className="grid lg:grid-cols-[1.15fr_1fr] gap-[10px] items-start">
        <div className="panel p-6 flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="h5">Create a mandate</div>
            <p className="body-sm muted">
              A per-transaction cap, a daily cap over a 24-hour window from the first spend, the worst execution price
              against the Chainlink reference, an expiry, and the stocks and indices it may touch. Outputs always go
              to you, never to the agent, and you can revoke at any time.
            </p>
          </div>

          <label className="block">
            <span className="body-xs muted">Agent address</span>
            <input className="input num mt-1" placeholder="0x… (the key your MCP server holds)" value={form.agent} onChange={(e) => setForm({ ...form, agent: e.target.value })} />
          </label>

          <div className="mandate-fields">
            {(
              [
                ["perTx", "Per-transaction cap", "USDG"],
                ["daily", "Daily cap", "USDG"],
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

          {cap(form.perTx) > cap(form.daily) && <Banner kind="warn">Per-transaction cap must not exceed the daily cap.</Banner>}
          {health.data && !mandateAddr && <Banner kind="warn">The mandate contract is not deployed on this network, so there is nothing to sign here.</Banner>}
          <p className="body-xs muted">Creating also asks you to approve the daily cap in USDG to the mandate contract. It pulls USDG from you per trade, never more than the caps.</p>
          <TxButton
            tx={createTx}
            label="Create mandate"
            className="btn btn-primary btn-lg w-full"
            approval={health.data && mandateAddr ? { token: health.data.deployment.usdg, spender: mandateAddr, amount: cap(form.daily) } : undefined}
            disabled={!createTx || cap(form.perTx) > cap(form.daily)}
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
            const spentPct = m.dailyCapUsdg === 0n ? 0 : Number((m.spentInWindow * 100n) / m.dailyCapUsdg);
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
                    <div className="num">{fmtUsdg(m.perTxCapUsdg)} USDG</div>
                  </div>
                  <div>
                    <div className="muted">daily</div>
                    <div className="num">{fmtUsdg(m.dailyCapUsdg)} USDG</div>
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
                    spent today <span className="num">{fmtUsdg(m.spentInWindow)}</span> · remaining <span className="num">{fmtUsdg(m.remaining)}</span> USDG
                  </div>
                  <div className="bar">
                    <span style={{ width: `${Math.min(100, spentPct)}%`, background: "var(--accent)" }} />
                  </div>
                </div>
                {live && (
                  <button className="btn" disabled={revoking === m.id.toString()} onClick={() => revoke(m.id)}>
                    {revoking === m.id.toString() ? "Revoking…" : "Revoke"}
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
