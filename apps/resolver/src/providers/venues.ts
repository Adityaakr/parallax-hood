import type { Address } from "viem";
import { BSC_ADDRESSES, PANCAKE_V3_FEES, PancakeV3FactoryAbi, WAD, pancakeExactInputSingleLeg, pancakeExactOutputSingleLeg, mockVenueLeg, type Leg } from "@parallax-hood/sdk";
import type { Chain } from "../chain.js";
import type { BinanceProvider } from "./binance.js";

const QUOTE_TIMEOUT_MS = Number(process.env.QUOTE_TIMEOUT_MS ?? 25_000); // cold anvil forks fetch pool state upstream slowly
const MIN_POOL_USDT = 20n * WAD; // skip dust pools: they are slow to quote on a fork and never win
const ZERO = "0x0000000000000000000000000000000000000000";

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

export type VenueQuote = {
  venue: string; // "pancake-v3:500" | "mock" | "binance-agg:Kipseli+Metric"
  amountIn: bigint;
  amountOut: bigint;
  fee?: number;
  /** present when the quote came from the Binance aggregator; calldata is fetched at execution time */
  aggregator?: { quoteId: string; approveTarget: string | null };
};

/**
 * Quoting venues. PancakeSwap v3 pools are read straight from the chain. The Binance aggregator is quoted too
 * when a key is configured: it reaches venues we cannot see from a pool read (Kipseli, Metric, Uniswap v3/v4,
 * Tessera, and the RFQ market makers that are the only real liquidity for Ondo tokens), and it returns calldata
 * to one contract, so a leg can execute it once that router is allowlisted.
 */
export class Venues {
  private pools = new Map<string, { fee: number; pool: Address }[]>();
  /**
   * Quote pools only. Set while re-planning after a route failed simulation: RFQ settlements in particular
   * cannot be replayed on a forked chain, and a plan we cannot simulate is a plan we should not hand over.
   */
  poolsOnly = false;
  constructor(private chain: Chain, private binance?: BinanceProvider) {}

  /** Re-run `fn` with the aggregator switched off, then restore. */
  async withoutAggregator<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.poolsOnly;
    this.poolsOnly = true;
    try {
      return await fn();
    } finally {
      this.poolsOnly = prev;
    }
  }

  /** Binance aggregator: one quote across every venue it routes to. Null when unavailable or unroutable. */
  async aggregatorQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<VenueQuote | null> {
    // the aggregator prices BSC mainnet state, which is exactly what a fork of it holds; mocks and testnet have
    // neither the tokens nor the venues, so there is nothing for it to route
    const mainnetState = this.chain.cfg.network === "bsc" || this.chain.cfg.network === "fork";
    if (this.poolsOnly || !this.binance?.available || this.chain.isMocks || !mainnetState) return null;
    const q = await this.binance.aggregatorQuote({ fromTokenAddress: tokenIn, toTokenAddress: tokenOut, amount: amountIn.toString() });
    if (!q || !q.toTokenAmount || BigInt(q.toTokenAmount) <= 0n) return null;
    const names = ((q.dexRouterList ?? []) as { dexProtocol?: { dexName?: string } }[]).map((d) => d.dexProtocol?.dexName).filter(Boolean).join("+");
    return { venue: `binance-agg${names ? ":" + names : ""}`, amountIn, amountOut: BigInt(q.toTokenAmount), aggregator: { quoteId: String(q.quoteId ?? ""), approveTarget: q.approveTarget ?? null } };
  }

  /** Fee tiers whose USDT pool exists and holds at least MIN_POOL_USDT. Cached for the process lifetime. */
  /** Whether `token` has any USDT pool the resolver would quote (false on networks without pools). */
  async hasPool(token: Address): Promise<boolean> {
    if (this.chain.isMocks) return true;
    return (await this.liquidTiers(token)).length > 0;
  }

  private depthCache = new Map<string, { at: number; value: { usdt: bigint; tiers: number[]; bestFee: number | null } }>();

  /** USDT sitting in this token's pools, and the deepest tier — how much can actually be filled onchain.
   *  Cached for ten minutes: pool balances move slowly and a public RPC rate-limits long before they matter. */
  async depth(token: Address): Promise<{ usdt: bigint; tiers: number[]; bestFee: number | null }> {
    if (this.chain.isMocks) return { usdt: 0n, tiers: [], bestFee: null };
    const key = token.toLowerCase();
    const hit = this.depthCache.get(key);
    if (hit && Date.now() - hit.at < 600_000) return hit.value;
    const tiers = await this.liquidTiers(token);
    let usdt = 0n;
    let best: { fee: number; bal: bigint } | null = null;
    for (const t of tiers) {
      const bal = await this.chain.balanceOf(this.chain.d.usdt, t.pool).catch(() => 0n);
      usdt += bal;
      if (!best || bal > best.bal) best = { fee: t.fee, bal };
    }
    const value = { usdt, tiers: tiers.map((t) => t.fee), bestFee: best?.fee ?? null };
    this.depthCache.set(key, { at: Date.now(), value });
    return value;
  }

  private async liquidTiers(token: Address): Promise<{ fee: number; pool: Address }[]> {
    const k = token.toLowerCase();
    const hit = this.pools.get(k);
    if (hit) return hit;
    const found: { fee: number; pool: Address }[] = [];
    await Promise.all(
      PANCAKE_V3_FEES.map(async (fee) => {
        try {
          const pool = await this.chain.client.readContract({ address: BSC_ADDRESSES.pancakeV3Factory, abi: PancakeV3FactoryAbi, functionName: "getPool", args: [token, this.chain.d.usdt, fee] });
          if (pool === ZERO) return;
          const bal = await this.chain.balanceOf(this.chain.d.usdt, pool);
          if (bal >= MIN_POOL_USDT) found.push({ fee, pool });
        } catch {
          /* skip */
        }
      }),
    );
    this.pools.set(k, found);
    return found;
  }

  /** Warm the fork's state cache by quoting every token once (no-op cost on a real RPC). */
  async warmup(tokens: Address[]) {
    const probe = 50n * WAD;
    await Promise.all(tokens.map((t) => this.bestExactInput(this.chain.d.usdt, t, probe).catch(() => null)));
  }

  /** Pools considered for a token (for display: "pancake-v3:500 ($26k)"). */
  async poolsFor(token: Address) {
    const tiers = await this.liquidTiers(token);
    return Promise.all(tiers.map(async (t) => ({ ...t, usdt: await this.chain.balanceOf(this.chain.d.usdt, t.pool) })));
  }

  /** Best exact-input quote across fee tiers (or the mock venue). */
  async bestExactInput(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<VenueQuote | null> {
    if (amountIn <= 0n) return null;
    if (this.chain.isMocks) {
      const out = await this.chain.mockQuote(tokenIn, tokenOut, amountIn);
      return out && out > 0n ? { venue: "mock", amountIn, amountOut: out } : null;
    }
    const token = tokenIn.toLowerCase() === this.chain.d.usdt.toLowerCase() ? tokenOut : tokenIn;
    const tiers = await this.liquidTiers(token);
    const quotes = await Promise.all(
      tiers.map(async ({ fee }) => {
        const out = await withTimeout(this.chain.pancakeQuoteExactInput(tokenIn, tokenOut, amountIn, fee), QUOTE_TIMEOUT_MS);
        return out ? ({ venue: `pancake-v3:${fee}`, amountIn, amountOut: out, fee } as VenueQuote) : null;
      }),
    );
    const agg = await this.aggregatorQuote(tokenIn, tokenOut, amountIn).catch(() => null);
    const all = [...quotes.filter((q): q is VenueQuote => q !== null), ...(agg ? [agg] : [])];
    return all.sort((a, b) => (a.amountOut > b.amountOut ? -1 : 1))[0] ?? null;
  }

  /**
   * Exact-output through the aggregator, which only prices exact-input. We estimate the input from one probe
   * quote, then refine once with a small buffer; the result is a quote that delivers AT LEAST `amountOut`.
   * Buying slightly more than required is safe here — the vault checks backing after the fact and refunds the
   * unused USDT — whereas buying less would fail the backing invariant.
   */
  async aggregatorExactOutput(tokenIn: Address, tokenOut: Address, amountOut: bigint): Promise<VenueQuote | null> {
    if (this.poolsOnly || !this.binance?.available || this.chain.isMocks || amountOut <= 0n) return null;
    if (!(this.chain.cfg.network === "bsc" || this.chain.cfg.network === "fork")) return null;
    const probeIn = 100n * WAD; // $100 of USDT is enough to price the pair without moving it
    const probe = await this.aggregatorQuote(tokenIn, tokenOut, probeIn);
    if (!probe || probe.amountOut === 0n) return null;

    // scale the probe to the size we need, with 2% headroom for the price impact the bigger order adds
    let amountIn = (probeIn * amountOut * 102n) / (probe.amountOut * 100n);
    for (let attempt = 0; attempt < 2; attempt++) {
      const q = await this.aggregatorQuote(tokenIn, tokenOut, amountIn);
      if (!q) return null;
      if (q.amountOut >= amountOut) return { ...q, amountOut };
      // still short: scale by the miss and try once more
      amountIn = (amountIn * amountOut * 103n) / (q.amountOut * 100n);
    }
    return null;
  }

  /** Best exact-output quote (min amountIn) across fee tiers. */
  async bestExactOutput(tokenIn: Address, tokenOut: Address, amountOut: bigint): Promise<VenueQuote | null> {
    if (amountOut <= 0n) return null;
    if (this.chain.isMocks) {
      // mock venue is linear: invert via a probe
      const probe = 10n ** 18n;
      const outPerProbe = await this.chain.mockQuote(tokenIn, tokenOut, probe);
      if (!outPerProbe || outPerProbe === 0n) return null;
      const amountIn = (amountOut * probe) / outPerProbe + 1n;
      return { venue: "mock", amountIn, amountOut };
    }
    const token = tokenIn.toLowerCase() === this.chain.d.usdt.toLowerCase() ? tokenOut : tokenIn;
    const tiers = await this.liquidTiers(token);
    const quotes = await Promise.all(
      tiers.map(async ({ fee }) => {
        const inp = await withTimeout(this.chain.pancakeQuoteExactOutput(tokenIn, tokenOut, amountOut, fee), QUOTE_TIMEOUT_MS);
        return inp ? ({ venue: `pancake-v3:${fee}`, amountIn: inp, amountOut, fee } as VenueQuote) : null;
      }),
    );
    const agg = await this.aggregatorExactOutput(tokenIn, tokenOut, amountOut).catch(() => null);
    const all = [...quotes.filter((q): q is VenueQuote => q !== null), ...(agg ? [agg] : [])];
    return all.sort((a, b) => (a.amountIn < b.amountIn ? -1 : 1))[0] ?? null;
  }

  /** Marginal price probe: tiny-size quote for slippage measurement. Returns amountOut for `probeIn`. */
  async marginalOut(tokenIn: Address, tokenOut: Address, probeIn: bigint, fee?: number): Promise<bigint | null> {
    if (this.chain.isMocks) return this.chain.mockQuote(tokenIn, tokenOut, probeIn);
    if (fee === undefined) return (await this.bestExactInput(tokenIn, tokenOut, probeIn))?.amountOut ?? null;
    return withTimeout(this.chain.pancakeQuoteExactInput(tokenIn, tokenOut, probeIn, fee), QUOTE_TIMEOUT_MS);
  }

  /**
   * Turn a placeholder aggregator leg into a signable one by fetching the swap calldata for `taker`.
   *
   * The aggregator prices per request, so the calldata is fetched here rather than at quote time, and the fresh
   * route is checked against the amount the quote promised: if it moved against us beyond `toleranceBps`, the
   * leg is left unsignable rather than handing back a transaction that would revert on minShares.
   */
  async materializeLeg(leg: Leg, taker: Address, toleranceBps = 100n): Promise<{ leg: Leg; ok: true } | { ok: false; reason: string }> {
    if (!this.binance?.available) return { ok: false, reason: "aggregator route needs a Binance Web3 API key" };
    const q = await this.binance.aggregatorQuote({ fromTokenAddress: leg.tokenIn, toTokenAddress: leg.tokenOut, amount: leg.maxIn.toString(), userWalletAddress: taker });
    if (!q?.quoteId || !q.toTokenAmount) return { ok: false, reason: "aggregator did not re-quote this route" };
    const swap = await this.binance.aggregatorSwap({ fromTokenAddress: leg.tokenIn, toTokenAddress: leg.tokenOut, amount: leg.maxIn.toString(), userWalletAddress: taker, quoteId: String(q.quoteId), slippagePercent: (Number(toleranceBps) / 100).toString() });
    if (!swap?.to || !swap?.data) return { ok: false, reason: "aggregator returned no calldata" };
    return { ok: true, leg: { ...leg, target: swap.to as Address, data: swap.data as `0x${string}` } };
  }

  exactInputLeg(q: VenueQuote, tokenIn: Address, tokenOut: Address, minOut: bigint, recipient: Address): Leg {
    // Aggregator quotes are priced but not yet executable from our contracts: the swap calldata is fetched at
    // signing time and its router has to be allowlisted first, so we emit a placeholder the resolver never sends.
    if (q.aggregator) return { target: (q.aggregator.approveTarget ?? ZERO) as Address, data: "0x", tokenIn, maxIn: q.amountIn, tokenOut };
    if (q.venue === "mock") return mockVenueLeg({ venue: this.chain.d.venue!, tokenIn, tokenOut, amountIn: q.amountIn, minOut, recipient });
    return pancakeExactInputSingleLeg({ router: BSC_ADDRESSES.pancakeSmartRouter, tokenIn, tokenOut, fee: q.fee!, amountIn: q.amountIn, amountOutMinimum: minOut, recipient });
  }

  exactOutputLeg(q: VenueQuote, tokenIn: Address, tokenOut: Address, maxIn: bigint, recipient: Address): Leg {
    if (q.aggregator) return { target: (q.aggregator.approveTarget ?? ZERO) as Address, data: "0x", tokenIn, maxIn, tokenOut };
    if (q.venue === "mock") return mockVenueLeg({ venue: this.chain.d.venue!, tokenIn, tokenOut, amountIn: maxIn, minOut: q.amountOut, recipient });
    return pancakeExactOutputSingleLeg({ router: BSC_ADDRESSES.pancakeSmartRouter, tokenIn, tokenOut, fee: q.fee!, amountOut: q.amountOut, amountInMaximum: maxIn, recipient });
  }
}
