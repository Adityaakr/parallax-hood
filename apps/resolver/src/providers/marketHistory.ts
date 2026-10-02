import { logger } from "../log.js";
import type { Db } from "../db.js";

const log = logger("market-history");
const DAY = 86_400;

/**
 * Daily closing prices for the underlying stock itself, from Yahoo Finance's public chart endpoint (no key, two
 * years of daily bars). Chainlink publishes BSC feeds for the Mag 7 only, and a Uniswap pool's oracle keeps
 * days rather than months, so this is the only source that reaches back a year for names like Robinhood or
 * CoreWeave. It is display-only: returns and NAV read from it, nothing that executes or settles ever does.
 *
 * Bars are cached in SQLite and refreshed at most hourly. A ticker whose fetch fails stays absent rather than
 * being guessed at, and the caller says so.
 *
 * Two things protect the request that triggers a fetch. `prefetch` warms every ticker a page needs at once, so
 * an index of seven constituents costs one round trip rather than seven in a row. And when the endpoint stops
 * answering — which is what a datacenter IP gets from Yahoo — a breaker opens after three consecutive failures
 * and stays open for ten minutes, so a page costs one timeout rather than one per ticker.
 */
export class MarketHistory {
  private bars = new Map<string, { day: number; close: bigint }[]>();
  private meta = new Map<string, { name: string | null; fetchedAt: number }>();
  private inflight = new Map<string, Promise<void>>();
  private consecutiveFailures = 0;
  private breakerUntil = 0;

  constructor(private enabled: boolean, private db?: Db, private base = "https://query1.finance.yahoo.com") {
    db?.db.exec(`CREATE TABLE IF NOT EXISTS market_bars (ticker TEXT NOT NULL, day INTEGER NOT NULL, close TEXT NOT NULL, PRIMARY KEY (ticker, day));`);
    db?.db.exec(`CREATE TABLE IF NOT EXISTS market_meta (ticker TEXT PRIMARY KEY, name TEXT, fetched_at INTEGER NOT NULL);`);
  }

  /** Warm several tickers at once. Sequential awaits after this resolve from the in-flight map immediately. */
  async prefetch(tickers: string[]) {
    if (!this.enabled) return;
    const want = [...new Set(tickers.map((t) => t.toUpperCase()))];
    await Promise.all(want.map((t) => this.load(t).catch(() => [])));
  }

  /** Whether this ticker has daily bars to answer from (fetches them the first time it is asked). */
  async has(ticker: string): Promise<boolean> {
    return (await this.load(ticker)).length > 0;
  }

  /** The company name the provider returned, so a ticker collision is visible rather than silent. */
  nameOf(ticker: string): string | null {
    return this.meta.get(ticker.toUpperCase())?.name ?? null;
  }

  /** Close at or before `ts` (1e18-scaled USD), or null when the series does not reach back that far. */
  async priceAt(ticker: string, ts: number): Promise<bigint | null> {
    const bars = await this.load(ticker);
    if (bars.length === 0) return null;
    const day = Math.floor(ts / DAY);
    if (day < bars[0]!.day) return null; // older than the series: say nothing rather than clamp
    let lo = 0, hi = bars.length - 1, best: bigint | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid]!.day <= day) { best = bars[mid]!.close; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  /**
   * The two closes a return over [then, now] is measured between. When both land on the same bar — a period
   * shorter than the gap since the last session, i.e. "1 day" while the market is shut — the earlier end steps
   * back to the previous session, so the figure is a real close-to-close move rather than zero.
   */
  async pair(ticker: string, thenTs: number, nowTs: number): Promise<{ then: bigint; now: bigint } | null> {
    const bars = await this.load(ticker);
    if (bars.length < 2) return null;
    const idx = (ts: number) => {
      const day = Math.floor(ts / DAY);
      if (day < bars[0]!.day) return -1;
      let lo = 0, hi = bars.length - 1, best = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid]!.day <= day) { best = mid; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    const j = idx(nowTs);
    let i = idx(thenTs);
    if (j <= 0 || i < 0) return null;
    if (i >= j) i = j - 1;
    return { then: bars[i]!.close, now: bars[j]!.close };
  }

  /** Which daily bar answers for `ts` (its UTC day number), or null when the series does not reach it. */
  async barDay(ticker: string, ts: number): Promise<number | null> {
    const bars = await this.load(ticker);
    const day = Math.floor(ts / DAY);
    if (bars.length === 0 || day < bars[0]!.day) return null;
    let lo = 0, hi = bars.length - 1, best: number | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (bars[mid]!.day <= day) { best = bars[mid]!.day; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  /** How far back this ticker's series reaches, in seconds. */
  async reachSeconds(ticker: string): Promise<number> {
    const bars = await this.load(ticker);
    return bars.length === 0 ? 0 : Math.max(0, Math.floor(Date.now() / 1000) - bars[0]!.day * DAY);
  }

  /** Price return over each standard period, as bps, from the daily closes. */
  async returns(ticker: string): Promise<Record<string, number | null> | null> {
    const bars = await this.load(ticker);
    if (bars.length === 0) return null;
    const now = Math.floor(Date.now() / 1000);
    const last = bars[bars.length - 1]!.close;
    const at = (ts: number) => {
      const day = Math.floor(ts / DAY);
      let lo = 0, hi = bars.length - 1, best: bigint | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid]!.day <= day) { best = bars[mid]!.close; lo = mid + 1; } else hi = mid - 1;
      }
      return best;
    };
    const out: Record<string, number | null> = {};
    for (const [k, days] of Object.entries({ d1: 1, d7: 7, m1: 30, m6: 182, y1: 365 })) {
      const then = at(now - days * DAY);
      out[k] = then && then > 0n ? Number(((last - then) * 10_000n) / then) : null;
    }
    return out;
  }

  /** `points` closes over the last `days`, oldest first. */
  async series(ticker: string, days: number, points: number): Promise<{ t: number; price: string }[] | null> {
    const bars = await this.load(ticker);
    if (bars.length === 0) return null;
    const now = Math.floor(Date.now() / 1000);
    const out: { t: number; price: string }[] = [];
    for (let i = points - 1; i >= 0; i--) {
      const t = now - Math.round((days * DAY * i) / (points - 1));
      const p = await this.priceAt(ticker, t);
      if (p) out.push({ t, price: p.toString() });
    }
    return out.length > 1 ? out : null;
  }

  private async load(ticker: string): Promise<{ day: number; close: bigint }[]> {
    const key = ticker.toUpperCase();
    if (!this.enabled) return [];
    const cached = this.bars.get(key);
    const meta = this.meta.get(key) ?? this.readMeta(key);
    if (cached && meta && Date.now() - meta.fetchedAt < 3_600_000) return cached;
    if (!cached) {
      const rows = (this.db?.db.prepare("SELECT day, close FROM market_bars WHERE ticker = ? ORDER BY day").all(key) ?? []) as { day: number; close: string }[];
      if (rows.length > 0) this.bars.set(key, rows.map((r) => ({ day: r.day, close: BigInt(r.close) })));
    }
    if (meta && Date.now() - meta.fetchedAt < 3_600_000) return this.bars.get(key) ?? [];
    if (Date.now() < this.breakerUntil) return this.bars.get(key) ?? [];
    let p = this.inflight.get(key);
    if (!p) {
      p = this.fetch(key).finally(() => this.inflight.delete(key));
      this.inflight.set(key, p);
    }
    await p;
    return this.bars.get(key) ?? [];
  }

  private readMeta(key: string) {
    const row = this.db?.db.prepare("SELECT name, fetched_at FROM market_meta WHERE ticker = ?").get(key) as { name: string | null; fetched_at: number } | undefined;
    if (!row) return null;
    const m = { name: row.name, fetchedAt: row.fetched_at };
    this.meta.set(key, m);
    return m;
  }

  private async fetch(key: string) {
    const url = `${this.base}/v8/finance/chart/${encodeURIComponent(key)}?range=2y&interval=1d`;
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; parallax-resolver)" }, signal: AbortSignal.timeout(8_000) });
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = (await res.json()) as {
        chart?: { result?: { timestamp?: number[]; meta?: { longName?: string; shortName?: string }; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
      };
      const r = body.chart?.result?.[0];
      const ts = r?.timestamp ?? [];
      const closes = r?.indicators?.quote?.[0]?.close ?? [];
      const bars: { day: number; close: bigint }[] = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closes[i];
        if (c === null || c === undefined || !Number.isFinite(c) || c <= 0) continue;
        bars.push({ day: Math.floor(ts[i]! / DAY), close: BigInt(Math.round(c * 1e6)) * 10n ** 12n });
      }
      if (bars.length === 0) throw new Error("no bars");
      this.bars.set(key, bars);
      const name = r?.meta?.longName ?? r?.meta?.shortName ?? null;
      const m = { name, fetchedAt: Date.now() };
      this.meta.set(key, m);
      const ins = this.db?.db.prepare("INSERT OR REPLACE INTO market_bars(ticker, day, close) VALUES (?,?,?)");
      for (const b of bars) ins?.run(key, b.day, b.close.toString());
      this.db?.db.prepare("INSERT OR REPLACE INTO market_meta(ticker, name, fetched_at) VALUES (?,?,?)").run(key, name, m.fetchedAt);
      this.consecutiveFailures = 0;
      log.debug("bars", { ticker: key, bars: bars.length, name });
    } catch (e) {
      // keep whatever is cached; a ticker with nothing stays unpriced and the UI says so
      this.meta.set(key, { name: this.meta.get(key)?.name ?? null, fetchedAt: Date.now() });
      // remember the miss across a restart too, or a cold boot pays the timeout for every ticker again
      this.db?.db.prepare("INSERT OR REPLACE INTO market_meta(ticker, name, fetched_at) VALUES (?,?,?)")
        .run(key, this.meta.get(key)?.name ?? null, Date.now());
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= 3 && Date.now() >= this.breakerUntil) {
        this.breakerUntil = Date.now() + 600_000;
        log.warn("daily bars: endpoint unreachable, pausing for 10 minutes", { after: this.consecutiveFailures });
      }
      log.warn("daily bars unavailable", { ticker: key, err: (e as Error).message });
    }
  }
}
