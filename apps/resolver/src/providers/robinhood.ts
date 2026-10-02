import { z } from "zod";
import { getAddress, type Address } from "viem";
import { logger } from "../log.js";

const log = logger("robinhood");

/**
 * Robinhood's own read-only Stock Token API (https://api.robinhood.com/rhj, documented at
 * docs.robinhood.com/chain/stock-token-apis): asset metadata, live quotes and corporate actions, straight from
 * the issuer. Three things to keep straight, all from that page:
 *   - `/prices` bid and ask are the underlying equity's, per share and not multiplier-adjusted, which is the
 *     unit Parallax quotes in. `tokenBid` / `tokenAsk` are the same quote per token.
 *   - each endpoint is cached upstream (assets 1 minute, prices 15 seconds, corporate actions 1 hour), so
 *     asking more often than that returns the same answer. The memo windows below match.
 *   - the per-symbol price route is the one to use; the unfiltered one returns every asset.
 * Every response is zod-validated. A failed call returns the last good answer while it is still young and null
 * after that: the caller shows "unavailable", never a number that was not read.
 */
const Decimal = z.string().regex(/^\d+(\.\d+)?$/);
const DeploymentSchema = z.object({ contractAddress: z.string(), chainId: z.number() }).passthrough();
const TradingStatus = z.string();
const SessionSchema = z.object({ whole: TradingStatus.nullish(), fractional: TradingStatus.nullish() }).passthrough();
const AssetSchema = z.object({
  id: z.string(),
  tokenSymbol: z.string(),
  tokenName: z.string().nullish(),
  deployments: z.array(DeploymentSchema).default([]),
  currentMultiplier: Decimal,
  pendingMultiplier: z.string().nullish(),
  pendingMultiplierEffectiveTime: z.string().nullish(),
  status: z.string().nullish(),
  tradingCapabilities: z.object({ market: SessionSchema.nullish(), extended: SessionSchema.nullish(), overnight: SessionSchema.nullish() }).passthrough().nullish(),
  tokenDecimals: z.number().nullish(),
  isin: z.string().nullish(),
}).passthrough();
const AssetsResponse = z.object({ assets: z.array(AssetSchema) });

const QuoteSchema = z.object({
  tokenSymbol: z.string(),
  deployments: z.array(DeploymentSchema).default([]),
  bid: Decimal,
  ask: Decimal,
  currency: z.string().default("USD"),
  dailyTradingVolume: z.string().nullish(),
  isTradingHalt: z.boolean().default(false),
  generatedAt: z.string(),
  dailyHigh: z.string().nullish(),
  dailyLow: z.string().nullish(),
  tokenBid: z.string().nullish(),
  tokenAsk: z.string().nullish(),
}).passthrough();
const QuotesResponse = z.object({ quotes: z.array(QuoteSchema) });

const CorporateActionSchema = z.object({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  processDate: z.object({ year: z.number(), month: z.number(), day: z.number() }).nullish(),
  tokenSymbol: z.string(),
  deployments: z.array(DeploymentSchema).default([]),
  details: z.record(z.record(z.string())).default({}),
}).passthrough();
const CorporateActionsResponse = z.object({ corpActions: z.array(CorporateActionSchema) });

export type Session = { whole: boolean; fractional: boolean };
export type IssuerAsset = {
  symbol: string;
  name: string | null;
  /** the token on Robinhood Chain mainnet (4663), as the issuer lists it */
  token: Address | null;
  status: string | null;
  multiplier: string;
  pendingMultiplier: { multiplier: string; effectiveAt: number | null } | null;
  /** which of Robinhood's sessions the underlying trades in; null when the issuer does not say */
  sessions: { market: Session; extended: Session; overnight: Session } | null;
  isin: string | null;
};
export type IssuerQuote = {
  symbol: string;
  token: Address | null;
  /** USD per underlying share */
  bid: string;
  ask: string;
  /** USD per token (the same quote with the multiplier applied), when the issuer sends it */
  tokenBid: string | null;
  tokenAsk: string | null;
  dailyHigh: string | null;
  dailyLow: string | null;
  /** the underlying's volume for the day, in shares */
  dailyVolume: string | null;
  halted: boolean;
  generatedAt: number;
};
export type CorporateAction = {
  id: string;
  /** e.g. CASH_DIVIDEND, FORWARD_SPLIT */
  type: string;
  /** IN_PROGRESS or COMPLETED */
  status: string;
  /** the issuer's scheduling date, YYYY-MM-DD; for a split, the day the multiplier changes. Not a payable date. */
  processDate: string | null;
  symbol: string;
  /** one sentence built only from the fields the issuer sent */
  summary: string;
  details: Record<string, string>;
};

const tradable = (s: string | null | undefined) => s === "TRADING_STATUS_TRADABLE";
const session = (s: z.infer<typeof SessionSchema> | null | undefined): Session => ({ whole: tradable(s?.whole), fractional: tradable(s?.fractional) });
const mainnetToken = (deployments: { contractAddress: string; chainId: number }[]): Address | null => {
  const d = deployments.find((x) => x.chainId === 4663);
  try {
    return d ? getAddress(d.contractAddress) : null;
  } catch {
    return null;
  }
};
const strip = (v: string, prefix: string) => (v.startsWith(prefix) ? v.slice(prefix.length) : v);
const nonZero = (v: string | null | undefined) => (v && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0 ? v : null);

/** One sentence for a corporate action, from the issuer's own fields and nothing else. */
export function describeAction(type: string, d: Record<string, string>): string {
  switch (type) {
    case "CASH_DIVIDEND": return `Cash dividend of ${d.rate ?? "?"} USD per share`;
    case "STOCK_DIVIDEND": return `Stock dividend of ${d.rate ?? "?"} shares per share`;
    case "FORWARD_SPLIT": return `Forward split ${d.newRate ?? "?"} for ${d.oldRate ?? "?"}`;
    case "REVERSE_SPLIT": return `Reverse split ${d.newRate ?? "?"} for ${d.oldRate ?? "?"}`;
    default: return type.toLowerCase().replace(/_/g, " ");
  }
}

type Memo<T> = { at: number; v: T };

export class RobinhoodApi {
  private assetsMemo: Memo<Map<string, IssuerAsset>> | null = null;
  private actionsMemo: Memo<CorporateAction[]> | null = null;
  private quoteMemo = new Map<string, Memo<IssuerQuote>>();
  private inflight = new Map<string, Promise<unknown>>();

  /** `base` null switches the provider off: every read answers null and nothing leaves the process. */
  constructor(readonly base: string | null, private readonly fetcher: typeof fetch = fetch, private readonly timeoutMs = 8_000) {}

  get enabled() {
    return this.base !== null;
  }

  private async get<T>(path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      const res = await this.fetcher(`${this.base}${path}`, { signal: ctl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return schema.parse(await res.json());
    } finally {
      clearTimeout(timer);
    }
  }

  /** One request per key at a time, however many callers ask. */
  private once<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const hit = this.inflight.get(key) as Promise<T> | undefined;
    if (hit) return hit;
    const p = fn().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  /** Every Stock Token the issuer lists, by symbol. Fresh for a minute; kept for ten when the API stops answering. */
  async assets(): Promise<Map<string, IssuerAsset> | null> {
    if (!this.base) return null;
    const m = this.assetsMemo;
    if (m && Date.now() - m.at < 60_000) return m.v;
    try {
      const v = await this.once("assets", async () => {
        const { assets } = await this.get("/assets", AssetsResponse);
        const out = new Map<string, IssuerAsset>();
        for (const a of assets) {
          const caps = a.tradingCapabilities;
          const eff = a.pendingMultiplierEffectiveTime ? Math.floor(Date.parse(a.pendingMultiplierEffectiveTime) / 1000) : null;
          out.set(a.tokenSymbol.toUpperCase(), {
            symbol: a.tokenSymbol,
            name: a.tokenName ?? null,
            token: mainnetToken(a.deployments),
            status: a.status ? strip(a.status, "ASSET_STATUS_") : null,
            multiplier: a.currentMultiplier,
            pendingMultiplier: nonZero(a.pendingMultiplier) ? { multiplier: a.pendingMultiplier!, effectiveAt: eff !== null && Number.isFinite(eff) ? eff : null } : null,
            sessions: caps ? { market: session(caps.market), extended: session(caps.extended), overnight: session(caps.overnight) } : null,
            isin: a.isin ?? null,
          });
        }
        return out;
      });
      this.assetsMemo = { at: Date.now(), v };
      return v;
    } catch (e) {
      log.warn("assets unavailable", { err: (e as Error).message });
      return m && Date.now() - m.at < 600_000 ? m.v : null;
    }
  }

  async asset(symbol: string): Promise<IssuerAsset | null> {
    return (await this.assets())?.get(symbol.toUpperCase()) ?? null;
  }

  /**
   * The issuer's live quote for one symbol. Fresh for fifteen seconds, the upstream cache window; a failed call
   * hands back the last quote for up to two minutes, and it still carries its own `generatedAt`.
   */
  async quote(symbol: string): Promise<IssuerQuote | null> {
    if (!this.base) return null;
    const key = symbol.toUpperCase();
    const m = this.quoteMemo.get(key);
    if (m && Date.now() - m.at < 15_000) return m.v;
    try {
      const v = await this.once(`quote:${key}`, async () => {
        const { quotes } = await this.get(`/prices/${encodeURIComponent(key)}`, QuotesResponse);
        const q = quotes.find((x) => x.tokenSymbol.toUpperCase() === key);
        if (!q) throw new Error(`no quote for ${key}`);
        const at = Math.floor(Date.parse(q.generatedAt) / 1000);
        if (!Number.isFinite(at)) throw new Error(`bad generatedAt for ${key}`);
        return {
          symbol: q.tokenSymbol, token: mainnetToken(q.deployments), bid: q.bid, ask: q.ask,
          tokenBid: nonZero(q.tokenBid), tokenAsk: nonZero(q.tokenAsk), dailyHigh: nonZero(q.dailyHigh), dailyLow: nonZero(q.dailyLow),
          dailyVolume: nonZero(q.dailyTradingVolume), halted: q.isTradingHalt, generatedAt: at,
        } satisfies IssuerQuote;
      });
      this.quoteMemo.set(key, { at: Date.now(), v });
      return v;
    } catch (e) {
      log.warn("quote unavailable", { symbol: key, err: (e as Error).message });
      return m && Date.now() - m.at < 120_000 ? m.v : null;
    }
  }

  /** Corporate actions the issuer has processed or scheduled, newest first; for one symbol when given. */
  async corporateActions(symbol?: string): Promise<CorporateAction[] | null> {
    if (!this.base) return null;
    const pick = (all: CorporateAction[]) => (symbol ? all.filter((a) => a.symbol.toUpperCase() === symbol.toUpperCase()) : all);
    const m = this.actionsMemo;
    if (m && Date.now() - m.at < 3_600_000) return pick(m.v);
    try {
      const v = await this.once("actions", async () => {
        const { corpActions } = await this.get("/corporate-actions", CorporateActionsResponse);
        return corpActions.map((a): CorporateAction => {
          const type = strip(a.type, "CORPORATE_ACTION_TYPE_");
          const details = Object.values(a.details)[0] ?? {};
          const p = a.processDate;
          return {
            id: a.id, type, status: strip(a.status, "CORPORATE_ACTION_STATUS_"),
            processDate: p ? `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}` : null,
            symbol: a.tokenSymbol, summary: describeAction(type, details), details,
          };
        });
      });
      this.actionsMemo = { at: Date.now(), v };
      return pick(v);
    } catch (e) {
      log.warn("corporate actions unavailable", { err: (e as Error).message });
      return m && Date.now() - m.at < 6 * 3_600_000 ? pick(m.v) : null;
    }
  }
}
