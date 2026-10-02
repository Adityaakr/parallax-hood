import { createPublicClient, http, type Address, type PublicClient } from "viem";
import {
  ROBINHOOD_ADDRESSES, USDG_UNIT, WAD, usdgToWad, CHAINS, mockVenueLeg, uniswapExactInputSingleLeg, uniswapExactOutputSingleLeg, uniswapExactInputLeg, uniswapExactOutputLeg, type Leg,
} from "@parallax-hood/sdk";
import { UniswapV3Client, UNISWAP_V3_DEPLOYMENTS, ROBINHOOD_UNISWAP_V3, type Quote, type Route } from "@parallax-hood/uniswap-client";
import type { Chain } from "../chain.js";

const QUOTE_TIMEOUT_MS = Number(process.env.QUOTE_TIMEOUT_MS ?? 25_000); // cold anvil forks fetch pool state upstream slowly
/* Skip pools holding less than this much USDG. Several stock pairs have a 0.01 % or 1 % pool that was created,
   seeded with a few dollars and left: quoting them costs a round trip each and they never win. */
const MIN_POOL_USDG = 1_000n * USDG_UNIT;

export type VenueQuote = {
  venue: string; // "uniswap-v3:500" | "uniswap-v3:500>3000" | "mock"
  amountIn: bigint;
  amountOut: bigint;
  /** The pools the swap goes through, in swap order. Absent for the mock venue. */
  route?: Route;
};

/**
 * Where a leg can be filled. On Robinhood Chain that is Uniswap v3, read straight from the chain: pools from the
 * factory, prices from QuoterV2, single-hop against USDG or two hops through WETH where a stock is deeper there.
 * It is the one venue here with a router a contract can call, which is what a leg needs; the list of venues that
 * were looked at and why they are not routed is in docs/addresses.md. Local and test networks without pools use
 * the mock venue instead, and say so in the venue label.
 */
export class Venues {
  /** null on networks with no Uniswap deployment (the mock chain, the testnet). */
  readonly uniswap: UniswapV3Client | null;
  /** Depth of the real market for a token whose execution is mocked here. */
  private readonly mainnetUniswap: UniswapV3Client | null;

  constructor(private chain: Chain) {
    const deployment = UNISWAP_V3_DEPLOYMENTS[chain.cfg.chain.id === 31337 ? 31337 : chain.cfg.CHAIN_ID];
    const minPoolBalance = { [ROBINHOOD_ADDRESSES.usdg]: MIN_POOL_USDG };
    this.uniswap = deployment && !chain.isMocks ? new UniswapV3Client({ client: chain.client, deployment, minPoolBalance, quoteTimeoutMs: QUOTE_TIMEOUT_MS }) : null;
    this.mainnetUniswap = chain.isHybrid
      ? new UniswapV3Client({ client: createPublicClient({ chain: CHAINS.robinhood, transport: http(chain.cfg.ROBINHOOD_RPC_URL), batch: { multicall: { wait: 16 } } }) as PublicClient, deployment: ROBINHOOD_UNISWAP_V3, minPoolBalance, quoteTimeoutMs: QUOTE_TIMEOUT_MS })
      : null;
  }

  /** Tokens a route may pass through on its way between USDG and a stock. */
  private get via(): Address[] {
    return [ROBINHOOD_ADDRESSES.weth];
  }

  /** Whether `token` can be bought with USDG through a pool the resolver would quote. */
  async hasPool(token: Address): Promise<boolean> {
    if (this.chain.isMocks) return true;
    if (!this.uniswap) return false;
    return (await this.uniswap.routes(this.chain.d.usdg, token, this.via)).length > 0;
  }

  /**
   * USDG sitting in this token's direct pools, and the deepest tier: how much can be filled onchain without
   * going through WETH. On a hybrid network this is the mainnet twin's market, since the mock has none.
   */
  async depth(token: Address): Promise<{ usdg: bigint; tiers: number[]; bestFee: number | null }> {
    const [client, target, usdg] = this.mainnetUniswap
      ? [this.mainnetUniswap, this.chain.twin(token), ROBINHOOD_ADDRESSES.usdg]
      : [this.uniswap, token, this.chain.d.usdg];
    if (!client || (this.chain.isMocks && !this.mainnetUniswap)) return { usdg: 0n, tiers: [], bestFee: null };
    const d = await client.depth(usdg, target);
    return { usdg: d.balance, tiers: d.fees, bestFee: d.deepestFee };
  }

  /** The real market: this network's own pools, or mainnet's when execution here is mocked. */
  private get market(): { client: UniswapV3Client; usdg: Address } | null {
    if (this.mainnetUniswap) return { client: this.mainnetUniswap, usdg: ROBINHOOD_ADDRESSES.usdg as Address };
    return this.uniswap ? { client: this.uniswap, usdg: this.chain.d.usdg } : null;
  }

  /** USD per ETH, 1e18-scaled, from what 0.01 WETH sells for in the real market. Null when no pool answers. */
  async ethUsd(): Promise<bigint | null> {
    const m = this.market;
    if (!m) return null;
    const probe = 10n ** 16n;
    const q = await m.client.bestExactInput(ROBINHOOD_ADDRESSES.weth, m.usdg, probe, this.via).catch(() => null);
    return q ? (usdgToWad(q.amountOut) * WAD) / probe : null;
  }

  /**
   * What a token costs in the real market right now, in USD per token (1e18-scaled): the price a small buy
   * pays, the price selling the same tokens back gets, and their midpoint. Both sides include the pool fee, so
   * the midpoint is the pool's own price. `token` is the mainnet token on a hybrid network.
   */
  async marketPrice(token: Address, probeUsdg = 100n * USDG_UNIT): Promise<{ buy: bigint; sell: bigint; mid: bigint; venue: string } | null> {
    const m = this.market;
    if (!m) return null;
    const target = this.chain.twin(token);
    const bought = await m.client.bestExactInput(m.usdg, target, probeUsdg, this.via);
    if (!bought || bought.amountOut === 0n) return null;
    const sold = await m.client.bestExactInput(target, m.usdg, bought.amountOut, this.via);
    if (!sold || sold.amountOut === 0n) return null;
    const buy = (usdgToWad(probeUsdg) * WAD) / bought.amountOut;
    const sell = (usdgToWad(sold.amountOut) * WAD) / bought.amountOut;
    return { buy, sell, mid: (buy + sell) / 2n, venue: bought.venue };
  }

  /** Warm the fork's state cache by quoting every token once (no-op cost on a real RPC). */
  async warmup(tokens: Address[]) {
    const probe = 50n * USDG_UNIT;
    await Promise.all(tokens.map((t) => this.bestExactInput(this.chain.d.usdg, t, probe).catch(() => null)));
  }

  /** Pools considered for a token (for display: "uniswap-v3:500 ($2.7M)"). */
  async poolsFor(token: Address) {
    if (!this.uniswap) return [];
    const pools = await this.uniswap.liquidPools(this.chain.d.usdg, token);
    return pools.map((p) => ({ fee: p.fee, pool: p.pool, usdg: p.balances[this.chain.d.usdg.toLowerCase()] ?? 0n }));
  }

  private fromQuote(q: Quote | null): VenueQuote | null {
    return q ? { venue: q.venue, amountIn: q.amountIn, amountOut: q.amountOut, route: q.route } : null;
  }

  /** Best exact-input quote across every route (or the mock venue). */
  async bestExactInput(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<VenueQuote | null> {
    if (amountIn <= 0n) return null;
    if (this.chain.isMocks) {
      const out = await this.chain.mockQuote(tokenIn, tokenOut, amountIn);
      return out && out > 0n ? { venue: "mock", amountIn, amountOut: out } : null;
    }
    return this.fromQuote((await this.uniswap?.bestExactInput(tokenIn, tokenOut, amountIn, this.via)) ?? null);
  }

  /** Best exact-output quote (least input) across every route. */
  async bestExactOutput(tokenIn: Address, tokenOut: Address, amountOut: bigint): Promise<VenueQuote | null> {
    if (amountOut <= 0n) return null;
    if (this.chain.isMocks) {
      // the mock venue is linear, so one probe of the input token prices any size
      const probe = 10n ** 18n;
      const outPerProbe = await this.chain.mockQuote(tokenIn, tokenOut, probe);
      if (!outPerProbe || outPerProbe === 0n) return null;
      const amountIn = (amountOut * probe) / outPerProbe + 1n;
      return { venue: "mock", amountIn, amountOut };
    }
    return this.fromQuote((await this.uniswap?.bestExactOutput(tokenIn, tokenOut, amountOut, this.via)) ?? null);
  }

  /**
   * Marginal price probe: a tiny-size quote for slippage measurement. Pass the route the full-size quote took,
   * so the comparison is between two sizes on the same pools rather than between two different routes.
   */
  async marginalOut(tokenIn: Address, tokenOut: Address, probeIn: bigint, route?: Route): Promise<bigint | null> {
    if (this.chain.isMocks) return this.chain.mockQuote(tokenIn, tokenOut, probeIn);
    if (!this.uniswap) return null;
    if (!route) return (await this.uniswap.bestExactInput(tokenIn, tokenOut, probeIn, this.via))?.amountOut ?? null;
    return (await this.uniswap.quoteExactInput(route, probeIn))?.amountOut ?? null;
  }

  private get router(): Address {
    return (this.uniswap?.deployment.swapRouter02 ?? ROBINHOOD_ADDRESSES.uniswapSwapRouter02) as Address;
  }

  exactInputLeg(q: VenueQuote, tokenIn: Address, tokenOut: Address, minOut: bigint, recipient: Address): Leg {
    if (q.venue === "mock" || !q.route) return mockVenueLeg({ venue: this.chain.d.venue!, tokenIn, tokenOut, amountIn: q.amountIn, minOut, recipient });
    if (q.route.fees.length === 1) {
      return uniswapExactInputSingleLeg({ router: this.router, tokenIn, tokenOut, fee: q.route.fees[0]!, amountIn: q.amountIn, amountOutMinimum: minOut, recipient });
    }
    return uniswapExactInputLeg({ router: this.router, tokens: q.route.tokens, fees: q.route.fees, amountIn: q.amountIn, amountOutMinimum: minOut, recipient });
  }

  exactOutputLeg(q: VenueQuote, tokenIn: Address, tokenOut: Address, maxIn: bigint, recipient: Address): Leg {
    if (q.venue === "mock" || !q.route) return mockVenueLeg({ venue: this.chain.d.venue!, tokenIn, tokenOut, amountIn: maxIn, minOut: q.amountOut, recipient });
    if (q.route.fees.length === 1) {
      return uniswapExactOutputSingleLeg({ router: this.router, tokenIn, tokenOut, fee: q.route.fees[0]!, amountOut: q.amountOut, amountInMaximum: maxIn, recipient });
    }
    return uniswapExactOutputLeg({ router: this.router, tokens: q.route.tokens, fees: q.route.fees, amountOut: q.amountOut, amountInMaximum: maxIn, recipient });
  }
}
