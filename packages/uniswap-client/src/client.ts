import { type Address, type PublicClient, zeroAddress } from "viem";
import { z } from "zod";
import { FactoryAbi, PoolAbi, QuoterV2Abi, Erc20BalanceAbi } from "./abis.js";
import type { UniswapV3Deployment } from "./deployments.js";
import { type Route, encodePath, reversePath, routeLabel } from "./path.js";

/** One pool of a pair, with what it holds right now. */
export type Pool = {
  fee: number;
  pool: Address;
  token0: Address;
  /** In-range liquidity. Zero means the pool exists but nothing is quoted at the current price. */
  liquidity: bigint;
  /** Token balances of the pool, keyed by lower-cased token address. */
  balances: Record<string, bigint>;
};

const positive = z.bigint().positive();
const QuoteSchema = z.object({
  amountIn: positive,
  amountOut: positive,
  route: z.object({ tokens: z.array(z.string()).min(2), fees: z.array(z.number().int().positive()).min(1) }),
  gasEstimate: z.bigint().nonnegative(),
  ticksCrossed: z.number().int().nonnegative(),
});

/** A price for a route at a size. `venue` is the label a receipt carries, e.g. "uniswap-v3:500". */
export type Quote = {
  venue: string;
  amountIn: bigint;
  amountOut: bigint;
  route: Route;
  /** The quoter's own gas estimate for the swap, in gas units. */
  gasEstimate: bigint;
  /** Initialized ticks the swap crosses: a rough read of how deep into the book the size reaches. */
  ticksCrossed: number;
};

export type UniswapV3ClientOptions = {
  client: PublicClient;
  deployment: UniswapV3Deployment;
  /**
   * Skip a pool whose balance of this token is below the given raw amount (lower-cased address → raw units).
   * Dust pools never win a quote and cost a round trip each, so they are dropped before quoting.
   */
  minPoolBalance?: Record<string, bigint>;
  /** Give up on a single quote call after this long and treat the tier as unavailable. */
  quoteTimeoutMs?: number;
  /** How long a pool's liquidity and balances are reused. Pool addresses themselves never change. */
  poolTtlMs?: number;
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const pairKey = (a: Address, b: Address) => [a.toLowerCase(), b.toLowerCase()].sort().join(":");

/**
 * Quotes Uniswap v3 straight from the chain: pools from the factory, prices from QuoterV2. There is no API in
 * between, so a quote is exactly what the same swap would return in the same block, and anything the chain
 * cannot answer comes back as `null` rather than as a guess.
 */
export class UniswapV3Client {
  readonly deployment: UniswapV3Deployment;
  private readonly client: PublicClient;
  private readonly minPoolBalance: Record<string, bigint>;
  private readonly quoteTimeoutMs: number;
  private readonly poolTtlMs: number;
  private poolAddresses = new Map<string, Promise<{ fee: number; pool: Address }[]>>();
  private poolState = new Map<string, { at: number; value: Pool[] }>();

  constructor(opts: UniswapV3ClientOptions) {
    this.client = opts.client;
    this.deployment = opts.deployment;
    this.minPoolBalance = Object.fromEntries(Object.entries(opts.minPoolBalance ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    this.quoteTimeoutMs = opts.quoteTimeoutMs ?? 25_000;
    this.poolTtlMs = opts.poolTtlMs ?? 60_000;
  }

  /** Every fee tier at which a pool for the pair has been created. Cached for the life of the client. */
  private addresses(a: Address, b: Address): Promise<{ fee: number; pool: Address }[]> {
    const key = pairKey(a, b);
    let hit = this.poolAddresses.get(key);
    if (!hit) {
      hit = Promise.all(
        this.deployment.fees.map(async (fee) => {
          const pool = await this.client.readContract({ address: this.deployment.factory, abi: FactoryAbi, functionName: "getPool", args: [a, b, fee] });
          return pool === zeroAddress ? null : { fee, pool };
        }),
      ).then((list) => list.filter((p): p is { fee: number; pool: Address } => p !== null));
      // a failed lookup must not be remembered as "no pools"
      hit.catch(() => this.poolAddresses.delete(key));
      this.poolAddresses.set(key, hit);
    }
    return hit;
  }

  /** Pools of the pair with their liquidity and balances, including empty ones. */
  async pools(a: Address, b: Address): Promise<Pool[]> {
    const key = pairKey(a, b);
    const hit = this.poolState.get(key);
    if (hit && Date.now() - hit.at < this.poolTtlMs) return hit.value;
    const found = await this.addresses(a, b);
    const value = await Promise.all(
      found.map(async ({ fee, pool }) => {
        const [liquidity, token0, balA, balB] = await Promise.all([
          this.client.readContract({ address: pool, abi: PoolAbi, functionName: "liquidity" }),
          this.client.readContract({ address: pool, abi: PoolAbi, functionName: "token0" }),
          this.client.readContract({ address: a, abi: Erc20BalanceAbi, functionName: "balanceOf", args: [pool] }),
          this.client.readContract({ address: b, abi: Erc20BalanceAbi, functionName: "balanceOf", args: [pool] }),
        ]);
        return { fee, pool, token0, liquidity, balances: { [a.toLowerCase()]: balA, [b.toLowerCase()]: balB } } satisfies Pool;
      }),
    );
    this.poolState.set(key, { at: Date.now(), value });
    return value;
  }

  /** Pools worth quoting: in-range liquidity, and at least the configured minimum of each token that has one. */
  async liquidPools(a: Address, b: Address): Promise<Pool[]> {
    return (await this.pools(a, b)).filter((p) => {
      if (p.liquidity === 0n) return false;
      for (const [token, bal] of Object.entries(p.balances)) {
        const min = this.minPoolBalance[token];
        if (min !== undefined && bal < min) return false;
      }
      return true;
    });
  }

  /** Total of `token` sitting in the pair's liquid pools, and the tier that holds the most of it. */
  async depth(token: Address, other: Address): Promise<{ balance: bigint; fees: number[]; deepestFee: number | null }> {
    const pools = await this.liquidPools(token, other);
    let balance = 0n;
    let deepest: Pool | null = null;
    for (const p of pools) {
      const bal = p.balances[token.toLowerCase()] ?? 0n;
      balance += bal;
      if (!deepest || bal > (deepest.balances[token.toLowerCase()] ?? 0n)) deepest = p;
    }
    return { balance, fees: pools.map((p) => p.fee), deepestFee: deepest?.fee ?? null };
  }

  private toQuote(route: Route, amountIn: bigint, amountOut: bigint, gasEstimate: bigint, ticksCrossed: number): Quote | null {
    const parsed = QuoteSchema.safeParse({ amountIn, amountOut, route, gasEstimate, ticksCrossed });
    return parsed.success ? { venue: routeLabel(route.fees), amountIn, amountOut, route, gasEstimate, ticksCrossed } : null;
  }

  /** Exact-input quote along `route`. Null when the route cannot fill (no pool, no liquidity, revert, timeout). */
  async quoteExactInput(route: Route, amountIn: bigint): Promise<Quote | null> {
    if (amountIn <= 0n) return null;
    const call = async (): Promise<Quote | null> => {
      if (route.fees.length === 1) {
        const { result } = await this.client.simulateContract({
          address: this.deployment.quoterV2, abi: QuoterV2Abi, functionName: "quoteExactInputSingle",
          args: [{ tokenIn: route.tokens[0]!, tokenOut: route.tokens[1]!, amountIn, fee: route.fees[0]!, sqrtPriceLimitX96: 0n }],
        });
        return this.toQuote(route, amountIn, result[0], result[3], result[2]);
      }
      const { result } = await this.client.simulateContract({ address: this.deployment.quoterV2, abi: QuoterV2Abi, functionName: "quoteExactInput", args: [encodePath(route), amountIn] });
      return this.toQuote(route, amountIn, result[0], result[3], result[2].reduce((a, b) => a + b, 0));
    };
    return withTimeout(call().catch(() => null), this.quoteTimeoutMs);
  }

  /** Exact-output quote along `route` (written in swap order): the input needed to receive `amountOut`. */
  async quoteExactOutput(route: Route, amountOut: bigint): Promise<Quote | null> {
    if (amountOut <= 0n) return null;
    const call = async (): Promise<Quote | null> => {
      if (route.fees.length === 1) {
        const { result } = await this.client.simulateContract({
          address: this.deployment.quoterV2, abi: QuoterV2Abi, functionName: "quoteExactOutputSingle",
          args: [{ tokenIn: route.tokens[0]!, tokenOut: route.tokens[1]!, amount: amountOut, fee: route.fees[0]!, sqrtPriceLimitX96: 0n }],
        });
        return this.toQuote(route, result[0], amountOut, result[3], result[2]);
      }
      const { result } = await this.client.simulateContract({ address: this.deployment.quoterV2, abi: QuoterV2Abi, functionName: "quoteExactOutput", args: [encodePath(reversePath(route)), amountOut] });
      return this.toQuote(route, result[0], amountOut, result[3], result[2].reduce((a, b) => a + b, 0));
    };
    return withTimeout(call().catch(() => null), this.quoteTimeoutMs);
  }

  /**
   * Routes to try for a pair: every liquid single-hop tier, and, for each token in `via`, every pairing of a
   * liquid `tokenIn/via` pool with a liquid `via/tokenOut` pool. On Robinhood Chain some stocks are deeper
   * against WETH than against USDG, so the two-hop route through WETH is a real candidate, not a fallback.
   */
  async routes(tokenIn: Address, tokenOut: Address, via: Address[] = []): Promise<Route[]> {
    const direct = (await this.liquidPools(tokenIn, tokenOut)).map((p) => ({ tokens: [tokenIn, tokenOut], fees: [p.fee] }));
    const hops = await Promise.all(
      via
        .filter((v) => v.toLowerCase() !== tokenIn.toLowerCase() && v.toLowerCase() !== tokenOut.toLowerCase())
        .map(async (v) => {
          const [first, second] = await Promise.all([this.liquidPools(tokenIn, v), this.liquidPools(v, tokenOut)]);
          return first.flatMap((a) => second.map((b) => ({ tokens: [tokenIn, v, tokenOut], fees: [a.fee, b.fee] })));
        }),
    );
    return [...direct, ...hops.flat()];
  }

  /** The route that returns the most `tokenOut` for `amountIn`. */
  async bestExactInput(tokenIn: Address, tokenOut: Address, amountIn: bigint, via: Address[] = []): Promise<Quote | null> {
    const routes = await this.routes(tokenIn, tokenOut, via);
    const quotes = (await Promise.all(routes.map((r) => this.quoteExactInput(r, amountIn)))).filter((q): q is Quote => q !== null);
    return quotes.sort((a, b) => (a.amountOut > b.amountOut ? -1 : a.amountOut < b.amountOut ? 1 : 0))[0] ?? null;
  }

  /** The route that needs the least `tokenIn` to deliver `amountOut`. */
  async bestExactOutput(tokenIn: Address, tokenOut: Address, amountOut: bigint, via: Address[] = []): Promise<Quote | null> {
    const routes = await this.routes(tokenIn, tokenOut, via);
    const quotes = (await Promise.all(routes.map((r) => this.quoteExactOutput(r, amountOut)))).filter((q): q is Quote => q !== null);
    return quotes.sort((a, b) => (a.amountIn < b.amountIn ? -1 : a.amountIn > b.amountIn ? 1 : 0))[0] ?? null;
  }
}
