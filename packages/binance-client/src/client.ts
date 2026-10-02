import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { buildHeaders, encodeQuery } from "./signing.js";
import { TokenBucket, TtlCache, withBackoff } from "./rateLimit.js";
import {
  AggregatedQuoteSchema, BuildSwapSchema, EnvelopeSchema, GasPriceSchema, RwaPlatformSchema, RwaPriceSchema, RwaSearchResultSchema,
  RwaTokenSchema, RwaUnderlyingMarketSchema, RwaUnderlyingProfileSchema, SimulateResultSchema, TopLiquidityPoolSchema,
} from "./schemas.js";

export const BASE_URL = "https://web3.binance.com/build";

export type ClientMode = "live" | "fixtures" | "record";

export type BinanceClientOptions = {
  apiKey?: string;
  apiSecret?: string;
  /** live: signed HTTP. fixtures: replay from fixturesDir, never touches the network. record: live + write fixtures. */
  mode?: ClientMode;
  fixturesDir?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  logger?: { info: (...a: unknown[]) => void; warn: (...a: unknown[]) => void };
  recvWindow?: number;
  /** per-endpoint RPS (docs default 5) and per-key per-minute (docs default 1200). */
  rps?: number;
  perMinute?: number;
};

export class BinanceApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string | number,
    public readonly retryAfterMs?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

export class FixtureMissingError extends Error {
  constructor(public readonly key: string, public readonly file: string) {
    super(`No fixture for ${key} (${file}). Run in "record" mode with an API key to capture it.`);
    this.name = "FixtureMissingError";
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

/** Cache TTLs per the spec: prices 5 s, profiles 1 h, platforms 24 h, token list 60 s, quotes never. */
const TTL = { price: 5_000, profile: 3_600_000, platforms: 86_400_000, tokens: 60_000, search: 300_000, market: 30_000, pools: 60_000 };

export class BinanceWeb3Client {
  readonly mode: ClientMode;
  private readonly fixturesDir: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly log: NonNullable<BinanceClientOptions["logger"]>;
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly minuteBucket: TokenBucket;
  private readonly cache = new TtlCache<unknown>();
  private readonly opts: BinanceClientOptions;

  constructor(opts: BinanceClientOptions = {}) {
    this.opts = opts;
    const hasKey = Boolean(opts.apiKey && opts.apiSecret);
    this.mode = opts.mode ?? (hasKey ? "live" : "fixtures");
    if (this.mode !== "fixtures" && !hasKey) throw new Error(`Binance client mode "${this.mode}" requires apiKey and apiSecret`);
    this.fixturesDir = opts.fixturesDir ?? join(process.cwd(), "fixtures", "binance");
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.log = opts.logger ?? { info: () => {}, warn: (...a) => console.warn(...a) };
    this.minuteBucket = new TokenBucket(opts.perMinute ?? 1200, (opts.perMinute ?? 1200) / 60);
  }

  get isFixtureMode() {
    return this.mode === "fixtures";
  }

  // ------------------------------------------------------------------
  // RWA data
  // ------------------------------------------------------------------

  async rwaPlatforms(platformId?: string) {
    const data = await this.get("/api/v1/dex/market/rwa/platforms", { platformId }, TTL.platforms);
    return z.array(RwaPlatformSchema).parse(data);
  }

  async rwaTokens(p: { binanceChainId?: string; platformId?: string; tabId?: number } = {}) {
    const data = await this.get("/api/v1/dex/market/rwa/tokens", p, TTL.tokens);
    return z.array(RwaTokenSchema).parse(data);
  }

  async rwaSearch(p: { keyword?: string; platformId?: string }) {
    const data = await this.get("/api/v1/dex/market/rwa/search", p, TTL.search);
    return z.array(RwaSearchResultSchema).parse(data);
  }

  async rwaPrice(p: { binanceChainId: string; tokenContractAddresses: string[] }) {
    if (p.tokenContractAddresses.length > 100) throw new Error("max 100 addresses per request");
    const data = await this.get(
      "/api/v1/dex/market/rwa/price",
      { binanceChainId: p.binanceChainId, tokenContractAddresses: p.tokenContractAddresses.join(",") },
      TTL.price,
    );
    return z.array(RwaPriceSchema).parse(data);
  }

  async rwaUnderlyingProfile(p: { binanceChainId: string; tokenContractAddress: string }) {
    const data = await this.get("/api/v1/dex/market/rwa/underlying-profile", p, TTL.profile);
    return RwaUnderlyingProfileSchema.parse(data);
  }

  async rwaUnderlyingMarket(p: { binanceChainId: string; tokenContractAddress: string }) {
    const data = await this.get("/api/v1/dex/market/rwa/underlying-market", p, TTL.market);
    return RwaUnderlyingMarketSchema.parse(data);
  }

  // ------------------------------------------------------------------
  // Market data
  // ------------------------------------------------------------------

  async topLiquidityPools(p: { binanceChainId: string; tokenContractAddress: string }) {
    const data = await this.get("/api/v1/dex/market/token/top-liquidity", p, TTL.pools);
    return z.array(TopLiquidityPoolSchema).parse(Array.isArray(data) ? data : (data as { list?: unknown[] })?.list ?? []);
  }

  // ------------------------------------------------------------------
  // Trading (aggregator)
  // ------------------------------------------------------------------

  async aggregatedQuote(p: {
    binanceChainId: string;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string; // raw units
    userWalletAddress?: string;
    vendor?: "LiquidMesh" | "Pancake" | "Jupiter";
    slippagePercent?: string;
  }) {
    const data = await this.get("/api/v1/dex/aggregator/quote", p, 0);
    return z.array(AggregatedQuoteSchema).parse(Array.isArray(data) ? data : [data]);
  }

  async buildSwapTransaction(p: {
    binanceChainId: string;
    fromTokenAddress: string;
    toTokenAddress: string;
    amount: string;
    userWalletAddress: string;
    quoteId: string;
    slippagePercent?: string;
  }) {
    const data = await this.get("/api/v1/dex/aggregator/swap", p, 0);
    return BuildSwapSchema.parse(data);
  }

  async approveTransaction(p: { binanceChainId: string; tokenContractAddress: string; amount: string; userWalletAddress?: string }) {
    return this.get("/api/v1/dex/aggregator/approve-transaction", p, 0);
  }

  async transactionStatus(p: { binanceChainId: string; txHash: string }) {
    return this.get("/api/v1/dex/aggregator/history", p, 0);
  }

  // ------------------------------------------------------------------
  // Transaction API
  // ------------------------------------------------------------------

  async simulateTransactions(p: { binanceChainId: string; transactions: Array<{ from: string; to: string; data: string; value?: string }> }) {
    const data = await this.post("/api/v1/dex/pre-transaction/simulate", p);
    return SimulateResultSchema.parse(data);
  }

  async gasPrice(p: { binanceChainId: string }) {
    const data = await this.get("/api/v1/dex/pre-transaction/gas-price", p, 5_000);
    return GasPriceSchema.parse(data);
  }

  async gasLimit(p: { binanceChainId: string; from: string; to: string; data: string; value?: string }) {
    return this.post("/api/v1/dex/pre-transaction/gas-limit", p);
  }

  async broadcastTransaction(p: { binanceChainId: string; evmTx: string }) {
    return this.post("/api/v1/dex/pre-transaction/broadcast-transaction", p);
  }

  // ------------------------------------------------------------------
  // Core request plumbing
  // ------------------------------------------------------------------

  private fixtureKey(method: string, path: string, query: string, body: string) {
    const h = createHash("sha256").update(`${method} ${path}?${query} ${body}`).digest("hex").slice(0, 16);
    const name = path.replace(/^\/api\/v1\/dex\//, "").replace(/\//g, "_");
    return { key: `${method} ${path}?${query}`, file: join(this.fixturesDir, name, `${h}.json`), dir: join(this.fixturesDir, name) };
  }

  private async get(path: string, params: Params, ttlMs: number): Promise<unknown> {
    const query = encodeQuery(params);
    const cacheKey = `GET ${path}?${query}`;
    if (ttlMs > 0) {
      const hit = this.cache.get(cacheKey);
      if (hit !== undefined) return hit;
    }
    const data = await this.request("GET", path, query, "");
    if (ttlMs > 0) this.cache.set(cacheKey, data, ttlMs);
    return data;
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    return this.request("POST", path, "", JSON.stringify(body));
  }

  private async request(method: "GET" | "POST", path: string, query: string, body: string): Promise<unknown> {
    const fx = this.fixtureKey(method, path, query, body);
    if (this.mode === "fixtures") {
      if (!existsSync(fx.file)) throw new FixtureMissingError(fx.key, fx.file);
      const doc = JSON.parse(readFileSync(fx.file, "utf8"));
      return doc.data;
    }
    const data = await withBackoff(() => this.rawRequest(method, path, query, body), {
      retries: 3,
      baseMs: 400,
      shouldRetry: (e) => e instanceof BinanceApiError && (e.status === 429 || e.status >= 500),
      onRetry: (e, attempt, delay) => this.log.warn(`binance retry ${attempt} in ${Math.round(delay)}ms: ${(e as Error).message}`),
    });
    if (this.mode === "record") {
      mkdirSync(fx.dir, { recursive: true });
      writeFileSync(
        fx.file,
        JSON.stringify({ _fixture: true, recordedAt: new Date().toISOString(), request: { method, path, query, body: body || undefined }, data }, null, 1),
      );
    }
    return data;
  }

  private bucket(path: string) {
    let b = this.buckets.get(path);
    if (!b) {
      b = new TokenBucket(this.opts.rps ?? 5, this.opts.rps ?? 5);
      this.buckets.set(path, b);
    }
    return b;
  }

  private async rawRequest(method: "GET" | "POST", path: string, query: string, body: string): Promise<unknown> {
    await this.minuteBucket.take();
    await this.bucket(path).take();
    const headers = buildHeaders({
      apiKey: this.opts.apiKey!,
      apiSecret: this.opts.apiSecret!,
      method,
      path,
      query,
      body,
      recvWindow: this.opts.recvWindow,
    });
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ""}`;
    const res = await this.fetchImpl(url, { method, headers, body: method === "POST" ? body : undefined });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-JSON body */
    }
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? "1");
      throw new BinanceApiError("rate limited", 429, undefined, (isFinite(ra) ? ra : 1) * 1000, json);
    }
    if (!res.ok) {
      const code = (json as { code?: string | number })?.code;
      const msg = (json as { msg?: string; message?: string })?.msg ?? (json as { message?: string })?.message ?? text.slice(0, 200);
      throw new BinanceApiError(`HTTP ${res.status} ${code ?? ""} ${msg}`, res.status, code, undefined, json);
    }
    const env = EnvelopeSchema.safeParse(json);
    if (!env.success) throw new BinanceApiError(`unexpected envelope: ${text.slice(0, 200)}`, res.status, undefined, undefined, json);
    const code = String(env.data.code);
    const ok = code === "0" || code === "000000" || env.data.success === true;
    if (!ok) throw new BinanceApiError(`API error ${code}: ${env.data.msg ?? env.data.message ?? ""}`, res.status, env.data.code, undefined, json);
    return env.data.data;
  }
}
