import { createPublicClient, http, custom, type Address, type Hex, type PublicClient, type Transport } from "viem";
import {
  StockRegistryAbi, BasketVaultAbi, BasketFactoryAbi, Erc20Abi, Erc8056Abi, ChainlinkAggregatorAbi,
  MockSwapTargetAbi, CHAINS, idToTicker, tickerToId, mockTwins, type Deployment, type MockTwin,
} from "@parallax-hood/sdk";
import type { Config } from "./config.js";
import { Catalogue } from "./providers/catalogue.js";

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
   * Hybrid: mock token → its mainnet twin. Built from the deployment's `mocks` (symbol → mock address) and the
   * universe file (symbol → real token), so every market read for a mock resolves against the real token while
   * execution stays on this network.
   */
  private readonly twins: Map<string, MockTwin>;
  /** Robinhood Chain mainnet reads (Chainlink, pool depth) when this network cannot answer them itself. */
  readonly mainnet: PublicClient;
  /** The verified token, feed and index list. */
  readonly catalogue: Catalogue;

  constructor(readonly cfg: Config) {
    // No JSON-RPC batching (anvil mishandles batched eth_call with reverts); multicall3 batches plain reads.
    const transport = cfg.network === "fork" ? throttledHttp(cfg.rpcUrl, Number(process.env.FORK_MAX_INFLIGHT ?? 3)) : http(cfg.rpcUrl);
    this.client = createPublicClient({ chain: cfg.chain, transport, batch: { multicall: cfg.chain.contracts?.multicall3 ? { wait: 8 } : false } });
    this.d = cfg.deployment;
    this.mainnet = cfg.network === "robinhood"
      ? this.client
      : createPublicClient({ chain: CHAINS.robinhood, transport: http(cfg.ROBINHOOD_RPC_URL), batch: { multicall: { wait: 16 } } });
    this.catalogue = new Catalogue(cfg.UNIVERSE_FILE);
    this.twins = cfg.hybrid && this.d.mocks ? mockTwins(this.d, this.catalogue.universe.representations) : new Map();
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
    if (this.cfg.quoteOnly) return { maxAttestationAge: Number.MAX_SAFE_INTEGER, maxRatioAge: 12 * 3600, maxRatioStepBps: 500, buysPaused: false };
    return this.memo("limits", 30_000, async () => {
    const [maxAttestationAge, maxRatioAge, maxRatioStepBps, buysPaused] = await Promise.all([
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "maxAttestationAge" }),
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "maxRatioAge" }),
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "maxRatioStepBps" }),
      this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "buysPaused" }),
    ]);
    // a registry with the attestation gate switched off stores the largest uint64, which a JS number cannot hold
    const cap = (v: bigint) => (v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v));
    return { maxAttestationAge: cap(maxAttestationAge), maxRatioAge: cap(maxRatioAge), maxRatioStepBps: Number(maxRatioStepBps), buysPaused };
    });
  }

  /** Protocol fee (bps of USDG notional) and recipient, from the registry; quote-only reports the configured default. */
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
    if (ratioSource === "ERC8056") pending = await this.pendingMultiplier(token, ratio[0]);
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
   * A multiplier change the issuer has scheduled but that is not in force yet: `newUIMultiplier()` taking effect
   * at `effectiveAt()`. Before anything is scheduled the pair simply mirrors the current multiplier and the time
   * it last changed, so a pending change is one that is both different and still in the future.
   */
  private async pendingMultiplier(token: Address, current: bigint): Promise<RepresentationInfo["pendingMultiplier"]> {
    try {
      const [next, eff, now] = await Promise.all([
        this.client.readContract({ address: token, abi: Erc8056Abi, functionName: "newUIMultiplier" }),
        this.client.readContract({ address: token, abi: Erc8056Abi, functionName: "effectiveAt" }),
        this.now(),
      ]);
      return next !== current && Number(eff) > now ? { multiplier: next, effectiveAt: Number(eff) } : null;
    } catch {
      return null; // not an ERC-8056 token with the scheduled-update views
    }
  }

  /** The curated index definitions from the universe file, for networks where the vaults are not deployed. */
  fileIndices() {
    return this.catalogue.universe.indices;
  }

  /**
   * Quote-only universe: with no registry deployed, the universe file stands in for it. Ratios still come from
   * the chain, read from each token's own `uiMultiplier()`.
   */
  private universeCache: UnderlyingInfo[] | null = null;
  private async fileUniverse(): Promise<UnderlyingInfo[]> {
    if (this.universeCache) return this.universeCache;
    const cfg = this.catalogue.universe;
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
        const token = r.token;
        let ratio = BigInt(r.initialRatio);
        if (r.source === "ERC8056") {
          // live shares-per-token straight from the token itself
          try {
            ratio = await this.client.readContract({ address: token, abi: Erc8056Abi, functionName: "uiMultiplier" });
          } catch {
            /* keep the value recorded in the universe file */
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
          pendingMultiplier: r.source === "ERC8056" ? await this.pendingMultiplier(token, ratio) : null,
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
    let s: string;
    try {
      s = await this.client.readContract({ address: token, abi: Erc20Abi, functionName: "symbol" });
    } catch {
      s = token.slice(0, 8);
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
    const [name, symbol, totalSupply, constituents, usdgBal] = await Promise.all([
      this.client.readContract({ ...v, functionName: "name" }),
      this.client.readContract({ ...v, functionName: "symbol" }),
      this.client.readContract({ ...v, functionName: "totalSupply" }),
      this.client.readContract({ ...v, functionName: "constituents" }),
      this.balanceOf(this.d.usdg, basket),
    ]);
    return { name, symbol, totalSupply, constituents: constituents.map((c) => ({ ...c, ticker: idToTicker(c.underlyingId) })), usdgBalance: usdgBal };
  }

  async basketComposition(basket: Address) {
    return this.memo(`comp:${basket}`, 1_500, () => this.client.readContract({ address: basket, abi: BasketVaultAbi, functionName: "composition" }));
  }

  // ---- reference prices ----

  /**
   * The registry's own reference price for an underlying: USD per underlying share, 1e18-scaled. This is the
   * number the mandate's floor is computed from, so quoting against it means the resolver and the contract can
   * never disagree about what "the reference" is. Zero when the registry has neither a feed nor a posted price.
   */
  async registryPrice(id: Hex): Promise<{ price: bigint; updatedAt: number } | null> {
    if (this.cfg.quoteOnly) return null;
    return this.memo(`ref:${id}`, 5_000, async () => {
      try {
        const [price, updatedAt] = await this.client.readContract({ address: this.d.registry, abi: StockRegistryAbi, functionName: "referencePrice", args: [id] });
        return price > 0n ? { price, updatedAt: Number(updatedAt) } : null;
      } catch {
        return null;
      }
    });
  }

  /**
   * The Chainlink feed for a ticker, read directly. On Robinhood Chain this prices the *token*, with the
   * ERC-8056 multiplier already in it; the caller divides by the token's ratio to get a share price.
   */
  async chainlinkPrice(ticker: string): Promise<{ price: bigint; decimals: number; updatedAt: number; feed: Address } | null> {
    const feed = this.catalogue.feed(ticker);
    if (!feed || (this.isMocks && !this.isHybrid)) return null;
    // the fork holds the feed itself; a hybrid mock network reads it from mainnet
    const client = this.isHybrid ? this.mainnet : this.client;
    return this.memo(`cl:${ticker}`, 5_000, async () => {
      try {
        const [round, dec] = await Promise.all([
          client.readContract({ address: feed, abi: ChainlinkAggregatorAbi, functionName: "latestRoundData" }),
          client.readContract({ address: feed, abi: ChainlinkAggregatorAbi, functionName: "decimals" }),
        ]);
        return round[1] > 0n ? { price: round[1], decimals: dec, updatedAt: Number(round[3]), feed } : null;
      } catch {
        return null;
      }
    });
  }

  /** The live multiplier of a mainnet token, for a hybrid network pricing a mock against its twin's feed. */
  async mainnetMultiplier(token: Address): Promise<bigint | null> {
    return this.memo(`mult:${token}`, 60_000, async () => {
      try {
        return await this.mainnet.readContract({ address: token, abi: Erc8056Abi, functionName: "uiMultiplier" });
      } catch {
        return null;
      }
    });
  }

  // ---- venues ----

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
