/**
 * Price history from Chainlink round data. Every past round of a feed stays onchain, so the price at any
 * timestamp is a binary search over roundIds: real, verifiable history, no estimates. Only underlyings
 * with a feed in the universe file have it; everything else reports `null` and the UI says so.
 *
 * Round ids are `phaseId << 64 | aggregatorRoundId`; the search stays inside the latest phase, so history
 * reaches back to when that phase began and no further. Past rounds never change, so every round read is kept in
 * SQLite and every later search is bounded by the rounds already known: the first lookup on a feed costs
 * ~20 reads, the next ones a handful.
 *
 * History always comes from Robinhood Chain mainnet, even when the app runs on a fork or the testnet: it is
 * the same chain history, and reading it through anvil would forward every round upstream.
 *
 * A Robinhood stock feed prices the token, multiplier included, so a series from it is the token's price. The
 * multiplier moves by a dividend at a time, which is small against a day's price move but is not nothing: the
 * return figures are the token's total return, which is what a holder of the token actually earns.
 */
import { type Address, type PublicClient, parseAbi } from "viem";
import type { Db } from "./db.js";
import { logger } from "./log.js";

const log = logger("history");
const ABI = parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
  "function decimals() view returns (uint8)",
]);
const DAY = 86_400;
const MASK64 = (1n << 64n) - 1n;
export const PERIODS = { d1: 1, d7: 7, m1: 30, m6: 182, y1: 365 } as const;
export type Period = keyof typeof PERIODS;

type Round = { agg: bigint; price: bigint; at: number };

export class PriceHistory {
  /** feed → rounds known so far, sorted by aggregator round id (updatedAt is monotone in it) */
  private known = new Map<string, Round[]>();
  /** (feed, timestamp bucketed to the hour) → price, so repeated anchors cost nothing */
  private at = new Map<string, bigint | null>();
  private decimals = new Map<string, number>();
  private latest = new Map<string, { phase: bigint; r: Round; fetchedAt: number }>();

  constructor(private client: PublicClient, private enabled: boolean, private feeds: (ticker: string) => Address | null, private db?: Db) {
    db?.db.exec(`CREATE TABLE IF NOT EXISTS chainlink_rounds (feed TEXT NOT NULL, agg TEXT NOT NULL, price TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (feed, agg));`);
  }

  feedFor(ticker: string): Address | null {
    return this.enabled ? this.feeds(ticker) : null;
  }

  hasHistory(ticker: string) {
    return this.feedFor(ticker) !== null;
  }

  private rounds(feed: Address): Round[] {
    let list = this.known.get(feed);
    if (!list) {
      const rows = (this.db?.db.prepare("SELECT agg, price, at FROM chainlink_rounds WHERE feed = ? ORDER BY length(agg), agg").all(feed) ?? []) as { agg: string; price: string; at: number }[];
      list = rows.map((r) => ({ agg: BigInt(r.agg), price: BigInt(r.price), at: r.at }));
      this.known.set(feed, list);
    }
    return list;
  }

  private remember(feed: Address, r: Round) {
    const list = this.rounds(feed);
    let i = list.length;
    while (i > 0 && list[i - 1]!.agg > r.agg) i--;
    if (list[i]?.agg === r.agg) return;
    list.splice(i, 0, r);
    this.db?.db.prepare("INSERT OR IGNORE INTO chainlink_rounds(feed, agg, price, at) VALUES (?,?,?,?)").run(feed, r.agg.toString(), r.price.toString(), r.at);
  }

  private async round(feed: Address, phase: bigint, agg: bigint): Promise<Round | null> {
    const list = this.rounds(feed);
    const hit = list.find((r) => r.agg === agg);
    if (hit) return hit;
    try {
      const r = await this.client.readContract({ address: feed, abi: ABI, functionName: "getRoundData", args: [(phase << 64n) | agg] });
      if (r[3] === 0n) return null;
      // The first rounds of each Robinhood stock feed (21 to 23 June 2026) were published 1e10 too large. No
      // 8-decimal stock price reaches 1e15, so anything above it is one of those rounds and is not a price.
      if (r[1] > 10n ** 15n) return null;
      const out = { agg, price: r[1], at: Number(r[3]) };
      this.remember(feed, out);
      return out;
    } catch {
      return null;
    }
  }

  private async latestRound(feed: Address) {
    const cached = this.latest.get(feed);
    if (cached && Date.now() - cached.fetchedAt < 60_000) return cached;
    const r = await this.client.readContract({ address: feed, abi: ABI, functionName: "latestRoundData" });
    const out = { phase: r[0] >> 64n, r: { agg: r[0] & MASK64, price: r[1], at: Number(r[3]) }, fetchedAt: Date.now() };
    this.latest.set(feed, out);
    return out;
  }

  private async dec(feed: Address) {
    const d = this.decimals.get(feed);
    if (d !== undefined) return d;
    const v = await this.client.readContract({ address: feed, abi: ABI, functionName: "decimals" });
    this.decimals.set(feed, v);
    return v;
  }

  /** The feed's price (1e18-scaled USD) at or just before `ts`, or null if the phase does not reach back that far. */
  async priceAt(ticker: string, ts: number): Promise<bigint | null> {
    const feed = this.feedFor(ticker);
    if (!feed) return null;
    const key = `${feed}:${Math.floor(ts / 3600)}`;
    if (this.at.has(key)) return this.at.get(key)!;
    const { phase, r: latest } = await this.latestRound(feed);
    const dec = await this.dec(feed);
    const scale = (p: bigint) => (p * 10n ** 18n) / 10n ** BigInt(dec);
    if (ts >= latest.at) { this.at.set(key, scale(latest.price)); return scale(latest.price); }

    // bound the search by the rounds already known on either side of ts
    let lo = 1n, hi = latest.agg, best: Round | null = null;
    for (const r of this.rounds(feed)) {
      if (r.at <= ts) { best = r; lo = r.agg + 1n; }
      else { hi = r.agg - 1n; break; }
    }
    let reads = 0;
    while (lo <= hi) {
      const mid = (lo + hi) / 2n;
      const r = await this.round(feed, phase, mid);
      reads++;
      if (!r) { lo = mid + 1n; continue; } // gaps at the very start of a phase
      if (r.at <= ts) { best = r; lo = mid + 1n; } else hi = mid - 1n;
    }
    log.debug("priceAt", { ticker, ts, reads, round: best?.agg.toString() ?? null });
    const out = best ? scale(best.price) : null;
    this.at.set(key, out);
    return out;
  }

  /** Price returns over the standard periods, as bps, from onchain rounds. */
  async returns(ticker: string, now = Math.floor(Date.now() / 1000)): Promise<Record<Period, number | null> | null> {
    if (!this.hasHistory(ticker)) return null;
    const cur = await this.priceAt(ticker, now);
    if (!cur) return null;
    // the five anchors are independent binary searches over the same feed: run them together, because each one
    // is a dozen sequential eth_calls and doing them in series is what made a page take minutes on a slow RPC
    const entries = Object.entries(PERIODS) as [Period, number][];
    const thens = await Promise.all(entries.map(([, days]) => this.priceAt(ticker, now - days * DAY)));
    const out = {} as Record<Period, number | null>;
    entries.forEach(([k], i) => {
      const then = thens[i];
      out[k] = then && then > 0n ? Number(((cur - then) * 10_000n) / then) : null;
    });
    return out;
  }

  /** `points` samples over the last `days`, oldest first, for sparklines. */
  async series(ticker: string, days: number, points: number, now = Math.floor(Date.now() / 1000)): Promise<{ t: number; price: string }[] | null> {
    if (!this.hasHistory(ticker)) return null;
    const stamps = Array.from({ length: points }, (_, i) => now - Math.round((days * DAY * (points - 1 - i)) / (points - 1)));
    const prices = await Promise.all(stamps.map((t) => this.priceAt(ticker, t)));
    return stamps.flatMap((t, i) => (prices[i] ? [{ t, price: prices[i]!.toString() }] : []));
  }
}
