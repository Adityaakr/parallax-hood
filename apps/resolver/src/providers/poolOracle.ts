import { type Address, getAddress, parseAbi } from "viem";
import { ROBINHOOD_ADDRESSES, UNISWAP_V3_FEES, USDG_DECIMALS, UniswapV3FactoryAbi } from "@parallax-hood/sdk";
import type { Chain } from "../chain.js";
import { logger } from "../log.js";

const log = logger("pool-oracle");

const POOL_ABI = parseAbi([
  "function observe(uint32[] secondsAgos) view returns (int56[] tickCumulatives, uint160[] secondsPerLiquidityCumulativeX128s)",
  "function slot0() view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, uint8 feeProtocol, bool unlocked)",
  "function token0() view returns (address)",
  "function liquidity() view returns (uint128)",
]);

/**
 * Historical prices from a Uniswap v3 pool's own ring-buffer oracle, for a token whose Chainlink feed cannot
 * answer. `observe` returns the cumulative tick, so the average tick between two points is a time-weighted
 * price that no single trade can move, the same primitive Uniswap TWAP oracles use. The buffer is finite and
 * only as long as the pool's observation cardinality, so how far back a pool reaches depends on how often it
 * trades. Nothing is invented past the buffer: `tokenPriceAgo` returns null and the caller says so.
 */
export class PoolOracle {
  private pools = new Map<string, { pool: Address; usdgIsToken0: boolean } | null>();
  private prices = new Map<string, bigint | null>();

  constructor(private chain: Chain) {}

  /** USD per raw token `secondsAgo` ago (1e18-scaled), or null when the pool's buffer does not reach that far. */
  async tokenPriceAgo(token: Address, secondsAgo: number): Promise<bigint | null> {
    const p = await this.poolFor(token);
    if (!p) return null;
    const key = `${p.pool}:${Math.floor(secondsAgo / 900)}`; // 15-minute buckets: the same anchor costs one read
    const hit = this.prices.get(key);
    if (hit !== undefined) return hit;
    let out: bigint | null = null;
    try {
      if (secondsAgo <= 60) {
        // a zero-width window has no average: the pool's current tick is the price now
        const slot0 = await this.chain.client.readContract({ address: p.pool, abi: POOL_ABI, functionName: "slot0" });
        out = this.priceFromTick(slot0[1], p.usdgIsToken0);
      } else {
        const [cum] = await this.chain.client.readContract({ address: p.pool, abi: POOL_ABI, functionName: "observe", args: [[secondsAgo, 0]] });
        out = this.priceFromTick(Number((cum[1]! - cum[0]!) / BigInt(secondsAgo)), p.usdgIsToken0);
      }
    } catch {
      out = null; // "OLD": the observation buffer does not reach back this far
    }
    this.prices.set(key, out);
    return out;
  }

  /** How far back this token's pool can be read, in seconds (0 when it has no pool). Probes coarsely. */
  async reachSeconds(token: Address): Promise<number> {
    for (const secs of [30 * 86_400, 7 * 86_400, 2 * 86_400, 86_400, 6 * 3_600, 3_600]) {
      if ((await this.tokenPriceAgo(token, secs)) !== null) return secs;
    }
    return 0;
  }

  /** The deepest USDG pool for `token`, cached for the process. */
  private async poolFor(token: Address): Promise<{ pool: Address; usdgIsToken0: boolean } | null> {
    const key = token.toLowerCase();
    if (this.pools.has(key)) return this.pools.get(key)!;
    let best: { pool: Address; usdgIsToken0: boolean; liquidity: bigint } | null = null;
    for (const fee of UNISWAP_V3_FEES) {
      const pool = await this.chain.client
        .readContract({ address: ROBINHOOD_ADDRESSES.uniswapV3Factory, abi: UniswapV3FactoryAbi, functionName: "getPool", args: [token, this.chain.d.usdg, fee] })
        .catch(() => null);
      if (!pool || pool === "0x0000000000000000000000000000000000000000") continue;
      try {
        const [liquidity, slot0, token0] = await Promise.all([
          this.chain.client.readContract({ address: pool, abi: POOL_ABI, functionName: "liquidity" }),
          this.chain.client.readContract({ address: pool, abi: POOL_ABI, functionName: "slot0" }),
          this.chain.client.readContract({ address: pool, abi: POOL_ABI, functionName: "token0" }),
        ]);
        if (liquidity === 0n || slot0[3] < 2) continue; // no depth, or an oracle of one observation
        if (!best || liquidity > best.liquidity) best = { pool, usdgIsToken0: getAddress(token0) === getAddress(this.chain.d.usdg), liquidity };
      } catch { /* not a v3 pool we can read */ }
    }
    const out = best ? { pool: best.pool, usdgIsToken0: best.usdgIsToken0 } : null;
    log.debug("pool for token", { token, pool: out?.pool ?? null });
    this.pools.set(key, out);
    return out;
  }

  /**
   * 1.0001^tick as USD per whole token, 1e18-scaled. The tick prices raw units against raw units, and USDG has
   * 6 decimals where a stock token has 18, so the raw ratio is scaled up by the 12 decimals between them.
   */
  private priceFromTick(tick: number, usdgIsToken0: boolean): bigint {
    const raw = Math.pow(1.0001, usdgIsToken0 ? -tick : tick) * 10 ** (18 - USDG_DECIMALS);
    if (!Number.isFinite(raw) || raw <= 0) return 0n;
    return BigInt(Math.round(raw * 1e6)) * 10n ** 12n;
  }
}
