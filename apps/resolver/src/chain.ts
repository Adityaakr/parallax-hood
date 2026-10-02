import { readFileSync, existsSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { REPO_ROOT } from "./config.js";
import { createPublicClient, http, custom, type Address, type Hex, type PublicClient, type Transport, getAddress } from "viem";
import { bsc } from "viem/chains";
import {
  StockRegistryAbi, BasketVaultAbi, BasketFactoryAbi, Erc20Abi, Erc8056Abi, ChainlinkAggregatorAbi, PancakeQuoterV2Abi,
  MockSwapTargetAbi, idToTicker, tickerToId, BSC_ADDRESSES, MAINNET_REPRESENTATIONS, mockTwins, type Deployment, type MockTwin,
} from "@parallax-hood/sdk";
import type { Config } from "./config.js";

export type RatioSource = "KEEPER" | "ERC8056";

export type RepresentationInfo = {
  token: Address;
  underlyingId: Hex;
  ticker: string;
  platformId: Hex;
  platform: string;
  symbol: string;
  decimals: number;
  ratioSource: RatioSource;
  active: boolean;
  ratio: bigint;
  ratioUpdatedAt: number;
  pendingMultiplier: { multiplier: bigint; effectiveAt: number } | null;
  attestedAt: number;
  buyEligible: boolean;
  sellEligible: boolean;
};

export type UnderlyingInfo = {
  id: Hex;
  ticker: string;
  active: boolean;
  marketState: { open: boolean; updatedAt: number };
  representations: RepresentationInfo[];
};

/**
 * HTTP transport with a cap on in-flight requests. A local anvil fork serves every cold read by fetching state from
 * a public upstream; dozens of parallel eth_calls make it stall for minutes. Mainnet RPCs do not need this.
 */
function throttledHttp(url: string, maxInFlight: number): Transport {
  const inner = http(url, { timeout: 120_000 });
  let active = 0;
  const queue: Array<() => void> = [];
  const acquire = () => new Promise<void>((r) => (active < maxInFlight ? (active++, r()) : queue.push(() => (active++, r()))));
  const release = () => {
    active--;
    queue.shift()?.();
  };
  return (opts) => {
    const t = inner(opts);
    return custom({
      request: async (args) => {
        await acquire();
        try {
          return await t.request(args as never);
        } finally {
          release();
        }
      },
    })(opts);
  };
}

/** Thin, typed reads over the deployed contracts + external venues. Every method is a pure RPC read. */
export class Chain {
  readonly client: PublicClient;
  readonly d: Deployment;
  private symbolCache = new Map<string, string>();
  private ttl = new Map<string, { v: unknown; exp: number }>();

  /** Tiny TTL memo for hot registry reads (block-ish freshness; every quote path still re-reads ratios via the quoter). */
  private async memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
    const hit = this.ttl.get(key);
    if (hit && hit.exp > Date.now()) return hit.v as T;
    const v = await fn();
    this.ttl.set(key, { v, exp: Date.now() + ttlMs });
    return v;
  }
  invalidate() {
    this.ttl.clear();
  }

  /**
   * Hybrid demo: mock token → its mainnet twin. Built from the deployment's `mocks` (symbol → mock address) and
   * bsc.json (symbol → real token), so every market read for a mock resolves against the real token while
   * execution stays on this network.
   */
  private readonly twins: Map<string, MockTwin>;
  /** Mainnet reads (Chainlink) when this network cannot answer them itself. */
  readonly mainnet: PublicClient;

  constructor(readonly cfg: Config) {
    // No JSON-RPC batching (anvil mishandles batched eth_call with reverts); multicall3 batches plain reads.
    const transport = cfg.network === "fork" ? throttledHttp(cfg.rpcUrl, Number(process.env.FORK_MAX_INFLIGHT ?? 3)) : http(cfg.rpcUrl);
    this.client = createPublicClient({ chain: cfg.chain, transport, batch: { multicall: cfg.chain.contracts?.multicall3 ? { wait: 8 } : false } });
    this.d = cfg.deployment;
    this.mainnet = cfg.network === "bsc" ? this.client : createPublicClient({ chain: bsc, transport: http(cfg.BSC_RPC_URL) });
    const file = cfg.UNIVERSE_FILE ?? resolvePath(REPO_ROOT, "contracts/script/config/bsc.json");
    this.twins = cfg.hybrid && this.d.mocks
      ? mockTwins(this.d, (JSON.parse(readFileSync(file, "utf8")) as { representations: { ticker: string; platform: string; symbol: string; token: string }[] }).representations)
      : new Map();
  }

  get isMocks() {
    return Boolean(this.d.venue);
  }

  get isHybrid() {
    return this.cfg.hybrid;
  }

  /** The mainnet token a mock token stands in for, or the token itself when there is no twin. */
  twin(token: Address | string): Address {
    return this.twins.get(token.toLowerCase())?.token ?? (token as Address);
  }

  twinInfo(token: Address | string) {
    return this.twins.get(token.toLowerCase()) ?? null;
  }

  /** No contracts deployed: quote everything, execute nothing. */
  get isQuoteOnly() {
    return this.cfg.quoteOnly;
  }

  // ---- registry ----

  async underlyingIds(): Promise<Hex[]> {
    return [...(await this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "underlyingIds" }))];
  }

  /**
   * The chain's clock, not the process's. Every freshness rule the registry enforces is measured against
   * `block.timestamp`; a local clock that drifts — or a fork whose time was advanced — would otherwise report a
   * representation as fresh that the contract has already aged out. Memoized for a few seconds, wall clock if
   * the node cannot be reached.
   */
  async now(): Promise<number> {
    try {
      return await this.memo("now", 5_000, async () => Number((await this.client.getBlock()).timestamp));
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  }

  async limits() {
    // quote-only: no registry to read, so use the same defaults the contracts ship with
    if (this.cfg.quoteOnly) return { maxAttestationAge: 36 * 3600, maxRatioAge: 12 * 3600, maxRatioStepBps: 500, buysPaused: false };
    return this.memo("limits", 30_000, async () => {
    const [maxAttestationAge, maxRatioAge, maxRatioStepBps, buysPaused] = await Promise.all([
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "maxAttestationAge" }),
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "maxRatioAge" }),
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "maxRatioStepBps" }),
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "buysPaused" }),
    ]);
    return { maxAttestationAge: Number(maxAttestationAge), maxRatioAge: Number(maxRatioAge), maxRatioStepBps: Number(maxRatioStepBps), buysPaused };
    });
  }

  /** Protocol fee (bps of USDT notional) and recipient, from the registry; quote-only reports the configured default. */
  async fee(): Promise<{ bps: number; recipient: Address | null }> {
    if (this.cfg.quoteOnly) return { bps: this.cfg.PROTOCOL_FEE_BPS, recipient: null };
    return this.memo("fee", 30_000, async () => {
      const [bps, recipient] = await this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "fee" });
      return { bps: Number(bps), recipient: recipient === "0x0000000000000000000000000000000000000000" ? null : recipient };
    });
  }

  async underlying(id: Hex): Promise<UnderlyingInfo> {
    if (this.cfg.quoteOnly) {
      const hit = (await this.fileUniverse()).find((u) => u.id === id);
      if (!hit) throw new Error(`unknown underlying ${id}`);
      return hit;
    }
    return this.memo(`u:${id}`, 10_000, () => this.underlyingUncached(id));
  }

  private async underlyingUncached(id: Hex): Promise<UnderlyingInfo> {
    const reg = { address: this.d.registry, abi: StockRegistryAbi } as const;
    const [u, ms, reps] = await Promise.all([
      this.client.readContract({ ...reg, functionName: "getUnderlying", args: [id] }),
      this.client.readContract({ ...reg, functionName: "marketState", args: [id] }),
      this.client.readContract({ ...reg, functionName: "representationsOf", args: [id] }),
    ]);
    const representations = await Promise.all(reps.map((t) => this.representation(t)));
    return {
      id,
      ticker: u.ticker || idToTicker(id),
      active: u.active,
      marketState: { open: ms.open, updatedAt: Number(ms.updatedAt) },
      representations,
    };
  }

  async representation(token: Address): Promise<RepresentationInfo> {
    const reg = { address: this.d.registry, abi: StockRegistryAbi } as const;
    const [r, ratio, buy, sell] = await Promise.all([
      this.client.readContract({ ...reg, functionName: "getRepresentation", args: [token] }),
      this.client.readContract({ ...reg, functionName: "ratioOf", args: [token] }),
      this.client.readContract({ ...reg, functionName: "isBuyEligible", args: [token] }),
      this.client.readContract({ ...reg, functionName: "isSellEligible", args: [token] }),
    ]);
    const attestedAt = await this.client.readContract({ ...reg, functionName: "attestedAt", args: [r.platformId] });
    const ratioSource: RatioSource = r.ratioSource === 1 ? "ERC8056" : "KEEPER";
    let pending: RepresentationInfo["pendingMultiplier"] = null;
    if (ratioSource === "ERC8056") {
      try {
        const [m, eff] = await this.client.readContract({ address: token, abi: Erc8056Abi, functionName: "pendingMultiplier" });
        if (eff !== 0n) pending = { multiplier: m, effectiveAt: Number(eff) };
      } catch {
        /* token without pendingMultiplier */
      }
    }
    return {
      token,
      underlyingId: r.underlyingId,
      ticker: idToTicker(r.underlyingId),
      platformId: r.platformId,
      platform: idToTicker(r.platformId),
      symbol: await this.symbol(token),
      decimals: r.decimals,
      ratioSource,
      active: r.active,
      ratio: ratio[0],
      ratioUpdatedAt: Number(ratio[1]),
      pendingMultiplier: pending,
      attestedAt: Number(attestedAt),
      buyEligible: buy,
      sellEligible: sell,
    };
  }

  /**
   * Quote-only universe: the registry lives in contracts/script/config/<network>.json instead of onchain.
   * Ratios still come from the chain for ERC-8056 tokens; keeper-sourced ratios come from the generated config
   * (regenerate it with scripts/gen-universe.ts to refresh them from the Binance catalogue).
   */
  /** The curated index definitions from the same config file, for networks where the vaults are not deployed. */
  fileIndices(): { name: string; symbol: string; thesis: string; unitValueUsd: number; constituents: { ticker: string; weightBps: number; sharesPerUnit: string; why?: string }[] }[] {
    const file = this.cfg.UNIVERSE_FILE ?? resolvePath(REPO_ROOT, "contracts/script/config/bsc.json");
    if (!existsSync(file)) return [];
    return (JSON.parse(readFileSync(file, "utf8")) as { indices?: ReturnType<Chain["fileIndices"]> }).indices ?? [];
  }
  private universeCache: UnderlyingInfo[] | null = null;
  private async fileUniverse(): Promise<UnderlyingInfo[]> {
    if (this.universeCache) return this.universeCache;
    const file = this.cfg.UNIVERSE_FILE ?? resolvePath(REPO_ROOT, "contracts/script/config/bsc.json");
    if (!existsSync(file)) return [];
    const cfg = JSON.parse(readFileSync(file, "utf8")) as {
      representations: { ticker: string; platform: string; symbol: string; token: string; source: string; initialRatio: string }[];
    };
    const byTicker = new Map<string, typeof cfg.representations>();
    for (const r of cfg.representations) {
      const list = byTicker.get(r.ticker) ?? [];
      list.push(r);
      byTicker.set(r.ticker, list);
    }
    const now = Math.floor(Date.now() / 1000);
    const out: UnderlyingInfo[] = [];
    for (const [ticker, reps] of byTicker) {
      const representations: RepresentationInfo[] = [];
      for (const r of reps) {
        const token = getAddress(r.token);
        let ratio = BigInt(r.initialRatio);
        if (r.source === "ERC8056") {
          // live shares-per-token straight from the token itself
          try {
            ratio = await this.client.readContract({ address: token, abi: Erc8056Abi, functionName: "uiMultiplier" });
          } catch {
            /* keep the catalogue value */
          }
        }
        representations.push({
          token,
          underlyingId: tickerToId(ticker),
          ticker,
          platformId: tickerToId(r.platform),
          platform: r.platform,
          symbol: r.symbol,
          decimals: 18,
          ratioSource: r.source === "ERC8056" ? "ERC8056" : "KEEPER",
          active: true,
          ratio,
          ratioUpdatedAt: now,
          pendingMultiplier: null,
          attestedAt: now,
          buyEligible: true,
          sellEligible: true,
        });
      }
      out.push({ id: tickerToId(ticker), ticker, active: true, marketState: { open: true, updatedAt: now }, representations });
    }
    this.universeCache = out;
    return out;
  }

  async allUnderlyings(): Promise<UnderlyingInfo[]> {
    if (this.cfg.quoteOnly) return this.fileUniverse();
    const ids = await this.underlyingIds();
    return Promise.all(ids.map((id) => this.underlying(id)));
  }

  async symbol(token: Address): Promise<string> {
    const k = token.toLowerCase();
    const hit = this.symbolCache.get(k);
    if (hit) return hit;
    const known = MAINNET_REPRESENTATIONS.find((m) => m.token.toLowerCase() === k);
    let s = known?.symbol;
    if (!s) {
      try {
        s = await this.client.readContract({ address: token, abi: Erc20Abi, functionName: "symbol" });
      } catch {
        s = token.slice(0, 8);
      }
    }
    this.symbolCache.set(k, s);
    return s;
  }

  async balanceOf(token: Address, owner: Address): Promise<bigint> {
    return this.client.readContract({ address: token, abi: Erc20Abi, functionName: "balanceOf", args: [owner] });
  }

  async allowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
    return this.client.readContract({ address: token, abi: Erc20Abi, functionName: "allowance", args: [owner, spender] });
  }

  async sharesForTokens(token: Address, amount: bigint): Promise<bigint> {
    return this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "sharesForTokens", args: [token, amount] });
  }

  async tokensForShares(token: Address, shares: bigint): Promise<bigint> {
    return this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "tokensForShares", args: [token, shares] });
  }

  // ---- baskets ----

  async baskets(): Promise<Address[]> {
    return [...(await this.client.readContract({ address: this.d.factory, abi: BasketFactoryAbi, functionName: "baskets" }))];
  }

  async basketMeta(basket: Address) {
    const v = { address: basket, abi: BasketVaultAbi } as const;
    const [name, symbol, totalSupply, constituents, usdtBal] = await Promise.all([
      this.client.readContract({ ...v, functionName: "name" }),
      this.client.readContract({ ...v, functionName: "symbol" }),
      this.client.readContract({ ...v, functionName: "totalSupply" }),
      this.client.readContract({ ...v, functionName: "constituents" }),
      this.balanceOf(this.d.usdt, basket),
    ]);
    return { name, symbol, totalSupply, constituents: constituents.map((c) => ({ ...c, ticker: idToTicker(c.underlyingId) })), usdtBalance: usdtBal };
  }

  async basketComposition(basket: Address) {
    return this.memo(`comp:${basket}`, 1_500, () => this.client.readContract({ address: basket, abi: BasketVaultAbi, functionName: "composition" }));
  }

  // ---- reference prices ----

  async chainlinkPrice(ticker: string): Promise<{ price: bigint; decimals: number; updatedAt: number; feed: Address } | null> {
    const feed = BSC_ADDRESSES.chainlink[ticker];
    if (!feed || (this.isMocks && !this.isHybrid)) return null;
    // the fork holds the feed itself; a hybrid mock network reads it from mainnet
    const client = this.isHybrid ? this.mainnet : this.client;
    return this.memo(`cl:${ticker}`, 5_000, async () => {
    try {
      const [round, dec] = await Promise.all([
        client.readContract({ address: feed, abi: ChainlinkAggregatorAbi, functionName: "latestRoundData" }),
        client.readContract({ address: feed, abi: ChainlinkAggregatorAbi, functionName: "decimals" }),
      ]);
      return { price: round[1], decimals: dec, updatedAt: Number(round[3]), feed };
    } catch {
      return null;
    }
    });
  }

  // ---- venues ----

  /** PancakeSwap v3 exact-input quote for one fee tier. Returns null when the pool is missing/illiquid. */
  async pancakeQuoteExactInput(tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number): Promise<bigint | null> {
    try {
      const { result } = await this.client.simulateContract({
        address: BSC_ADDRESSES.pancakeQuoterV2,
        abi: PancakeQuoterV2Abi,
        functionName: "quoteExactInputSingle",
        args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
      });
      return result[0] > 0n ? result[0] : null;
    } catch {
      return null;
    }
  }

  async pancakeQuoteExactOutput(tokenIn: Address, tokenOut: Address, amountOut: bigint, fee: number): Promise<bigint | null> {
    try {
      const { result } = await this.client.simulateContract({
        address: BSC_ADDRESSES.pancakeQuoterV2,
        abi: PancakeQuoterV2Abi,
        functionName: "quoteExactOutputSingle",
        args: [{ tokenIn, tokenOut, amount: amountOut, fee, sqrtPriceLimitX96: 0n }],
      });
      return result[0] > 0n ? result[0] : null;
    } catch {
      return null;
    }
  }

  /** Mock venue (testnet/local): deterministic price. */
  async mockQuote(tokenIn: Address, tokenOut: Address, amountIn: bigint): Promise<bigint | null> {
    if (!this.d.venue) return null;
    try {
      return await this.client.readContract({ address: this.d.venue, abi: MockSwapTargetAbi, functionName: "quote", args: [tokenIn, tokenOut, amountIn] });
    } catch {
      return null;
    }
  }

  async mockPrice(token: Address): Promise<bigint | null> {
    if (!this.d.venue) return null;
    return this.client.readContract({ address: this.d.venue, abi: MockSwapTargetAbi, functionName: "price", args: [token] });
  }

  tickerId(ticker: string): Hex {
    return tickerToId(ticker.toUpperCase());
  }
}
