import { BinanceWeb3Client, FixtureMissingError, type RwaToken } from "@parallax-hood/binance-client";
import type { Config } from "../config.js";
import { logger } from "../log.js";
import type { MarketStatus } from "./marketHours.js";

const log = logger("binance");

/** What Binance publishes about the underlying company itself, for names Chainlink does not cover. */
export type Fundamentals = {
  high52W: number | null;
  low52W: number | null;
  marketCapUsd: number | null;
  peRatioTtm: number | null;
  pbRatio: number | null;
  dividendYield: number | null;
  volumeShares24h: number | null;
};

export type BinanceTokenInfo = {
  token: string;
  symbol: string;
  platformId: string;
  underlyingTicker: string | null;
  tokenToShareRatio: string | null;
  tokenPrice: string | null;
  referencePrice: string | null;
  statusInfo: RwaToken["statusInfo"];
  volume24h: string | null;
  logoUrl: string | null;
  underlyingName: string | null;
};

/**
 * Binance Web3 API as a *provider*: availability is explicit. In fixtures mode with no recorded fixture the
 * provider answers `null` and the resolver labels the field as unavailable instead of inventing data.
 */
export class BinanceProvider {
  readonly client: BinanceWeb3Client;
  readonly available: boolean;
  private tokenList: Map<string, BinanceTokenInfo> | null = null;
  private tokenListAt = 0;

  /** Maps a token to the one the catalogue knows (a mock's mainnet twin); identity by default. */
  alias: (token: string) => string = (t) => t;

  constructor(cfg: Config) {
    this.client = new BinanceWeb3Client({
      apiKey: cfg.BINANCE_WEB3_API_KEY,
      apiSecret: cfg.BINANCE_WEB3_API_SECRET,
      mode: cfg.BINANCE_CLIENT_MODE,
      fixturesDir: cfg.FIXTURES_DIR,
      logger: { info: (...a) => log.debug(String(a[0])), warn: (...a) => log.warn(String(a[0])) },
    });
    this.available = this.client.mode !== "fixtures";
  }

  get mode() {
    return this.client.mode;
  }

  private async safe<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof FixtureMissingError) log.debug("fixture missing", { key: e.key });
      else log.warn("binance call failed", { err: (e as Error).message });
      return null;
    }
  }

  /**
   * Brand per underlying ticker from the catalogue: logo and company name. Keyed by ticker (not address) so the
   * mock token sets used on testnet and locally still show the real company, and labeled as catalogue data.
   */
  async brands(): Promise<Map<string, { logoUrl: string | null; name: string | null }>> {
    const tokens = await this.tokens();
    const m = new Map<string, { logoUrl: string | null; name: string | null }>();
    if (!tokens) return m;
    for (const t of tokens.values()) {
      if (!t.underlyingTicker) continue;
      const key = t.underlyingTicker.toUpperCase();
      const cur = m.get(key);
      // prefer an entry that actually carries a logo
      if (!cur || (!cur.logoUrl && t.logoUrl)) m.set(key, { logoUrl: t.logoUrl, name: t.underlyingName });
    }
    return m;
  }

  /** One aggregator quote across every venue Binance routes to (AMMs plus the RFQ market makers). */
  async aggregatorQuote(p: { fromTokenAddress: string; toTokenAddress: string; amount: string; userWalletAddress?: string }) {
    const list = await this.safe(() =>
      this.client.aggregatedQuote({ binanceChainId: "56", fromTokenAddress: p.fromTokenAddress, toTokenAddress: p.toTokenAddress, amount: p.amount, userWalletAddress: p.userWalletAddress ?? "0x000000000000000000000000000000000000dEaD" }),
    );
    return list?.[0] ?? null;
  }

  /** Executable calldata for an aggregator route. `userWalletAddress` is the taker, i.e. the contract that calls. */
  async aggregatorSwap(p: { fromTokenAddress: string; toTokenAddress: string; amount: string; userWalletAddress: string; quoteId: string; slippagePercent: string }) {
    const res = await this.safe(() => this.client.buildSwapTransaction({ binanceChainId: "56", ...p }));
    const tx = (res as { tx?: { to?: string; data?: string } } | null)?.tx ?? (res as { to?: string; data?: string } | null);
    return tx?.to && tx?.data ? { to: tx.to, data: tx.data } : null;
  }

  /** All RWA tokens on BSC keyed by lowercase address. Cached 60 s. */
  async tokens(): Promise<Map<string, BinanceTokenInfo> | null> {
    if (this.tokenList && Date.now() - this.tokenListAt < 60_000) return this.tokenList;
    const list = await this.safe(() => this.client.rwaTokens({ binanceChainId: "56" }));
    if (!list) return this.tokenList; // keep the last good list if any
    const m = new Map<string, BinanceTokenInfo>();
    for (const t of list) {
      m.set(t.tokenContractAddress.toLowerCase(), {
        token: t.tokenContractAddress,
        symbol: t.tokenSymbol,
        platformId: t.platformId,
        underlyingTicker: t.underlyingTicker ?? null,
        tokenToShareRatio: t.tokenToShareRatio ?? null,
        tokenPrice: t.tokenPrice ?? null,
        referencePrice: t.referencePrice ?? null,
        statusInfo: t.statusInfo ?? null,
        logoUrl: t.tokenLogoUrl ?? null,
        underlyingName: (t as { underlyingName?: string | null }).underlyingName ?? null,
        volume24h: t.volume24h ?? null,
      });
    }
    this.tokenList = m;
    this.tokenListAt = Date.now();
    return m;
  }

  private fundamentalsCache = new Map<string, { at: number; value: Fundamentals | null }>();

  async token(address: string): Promise<BinanceTokenInfo | null> {
    const m = await this.tokens();
    return m?.get(this.alias(address).toLowerCase()) ?? null;
  }

  /**
   * The underlying's own market figures from Binance's RWA endpoint: the 52-week range, market cap, P/E, payout
   * and 24h share volume. No time series is offered there, so this is what a name without a Chainlink feed can
   * still show. Cached per token for an hour.
   */
  async fundamentals(tokenAddress: string): Promise<Fundamentals | null> {
    const key = this.alias(tokenAddress).toLowerCase();
    const hit = this.fundamentalsCache.get(key);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.value;
    let value: Fundamentals | null = null;
    try {
      const m = await this.client.rwaUnderlyingMarket({ binanceChainId: "56", tokenContractAddress: this.alias(tokenAddress) });
      const d = (m.marketData ?? {}) as Record<string, string | null | undefined>;
      const num = (v: string | null | undefined) => (v === null || v === undefined || v === "" ? null : Number(v));
      const high = num(d.high52W), low = num(d.low52W);
      value = high === null && low === null && num(d.marketCap) === null
        ? null
        : { high52W: high, low52W: low, marketCapUsd: num(d.marketCap), peRatioTtm: num(d.peRatioTTM), pbRatio: num(d.pbRatio), dividendYield: num(d.dividendYield), volumeShares24h: num(d.volumeShares24H) };
    } catch (e) {
      if (!(e instanceof FixtureMissingError)) log.debug("fundamentals unavailable", { token: tokenAddress, err: (e as Error).message });
    }
    this.fundamentalsCache.set(key, { at: Date.now(), value });
    return value;
  }

  /** Market status for an underlying from any of its tokens' statusInfo. */
  async marketStatus(tokenAddresses: string[]): Promise<MarketStatus | null> {
    const m = await this.tokens();
    if (!m) return null;
    for (const a of tokenAddresses) {
      const t = m.get(this.alias(a).toLowerCase());
      const s = t?.statusInfo;
      if (s && typeof s.openState === "boolean") {
        return { open: s.openState, nextOpenTime: s.nextOpenTime ?? null, nextCloseTime: s.nextCloseTime ?? null, source: "binance", reason: s.reasonCode ?? undefined };
      }
    }
    return null;
  }

  async attestation(token: string): Promise<{ daily?: { url: string; updatedAt?: number }; monthly?: { url: string; updatedAt?: number } } | null> {
    const p = await this.safe(() => this.client.rwaUnderlyingProfile({ binanceChainId: "56", tokenContractAddress: this.alias(token) }));
    if (!p?.protections) return null;
    const out: { daily?: { url: string; updatedAt?: number }; monthly?: { url: string; updatedAt?: number } } = {};
    for (const [k, v] of Object.entries(p.protections)) {
      if (!v?.url) continue;
      const entry = { url: v.url, updatedAt: v.updatedAt ?? undefined };
      if (/daily/i.test(k)) out.daily = entry;
      else if (/monthly/i.test(k)) out.monthly = entry;
    }
    return out;
  }

  /** Aggregated quote (may be RFQ). For comparison and for EOA execution; not contract-executable when RFQ. */
  async aggregatedQuote(p: { from: string; to: string; amount: bigint; wallet: string }) {
    return this.safe(() =>
      this.client.aggregatedQuote({ binanceChainId: "56", fromTokenAddress: p.from, toTokenAddress: p.to, amount: p.amount.toString(), userWalletAddress: p.wallet }),
    );
  }

  async simulate(txs: Array<{ from: string; to: string; data: string; value?: string }>) {
    return this.safe(() => this.client.simulateTransactions({ binanceChainId: "56", transactions: txs }));
  }
}
