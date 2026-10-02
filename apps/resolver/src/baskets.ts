import { type Address, encodeFunctionData, getAddress, isAddress } from "viem";
import {
  BasketVaultAbi, WAD, applySlippage, formatWad, parseWad, parseUsdg, formatUsdg, usdgToWad, proRata, requiredShares, serializeLegs, sharesForTokens, tokensForShares, idToTicker, tickerToId,
  PolicySchema, feeOn, type Leg, type Policy,
} from "@parallax-hood/sdk";
import type { Chain, RepresentationInfo } from "./chain.js";
import type { Resolver } from "./resolve.js";
import { quoteHashOf } from "./quotes.js";
import { reasonsForRegistry } from "./scoring.js";
import { logger } from "./log.js";
import { PERIODS, type PriceHistory, type Period } from "./history.js";

const log = logger("baskets");
const MINT_BUFFER_BPS = 30n; // headroom on amountInMaximum; unspent USDG is refunded by the vault
/* Budget sizing. A dollar of NAV costs more than a dollar to buy: the protocol fee, the venues' spread over the
   reference price, and the max-in buffer. The real figure is measured on every plan; this is what a cold cache
   assumes, and the headroom keeps a slightly stale measurement from sizing an order above the buyer's budget. */
const COLD_MINT_COST_RATIO = 1.03;
const MINT_BUDGET_HEADROOM = 1.002;
const RATIO_SCALE = 1_000_000n;
/* the share gain a migration must clear before the keeper will spend gas on it */
const MIGRATION_MIN_GAIN_BPS = 30;

export class Baskets {
  constructor(private chain: Chain, private r: Resolver, private history: PriceHistory) {}

  /** ticker → the representation whose pool prices its history (null when no pool oracle reaches back). */
  private oracleTokens = new Map<string, { token: Address; ratio: bigint } | null>();
  /** basket → USDG spent per dollar of NAV on the last clean plan, the sizing input for a budgeted mint. */
  private mintCostRatio = new Map<string, number>();

  async resolveBasket(addressOrSymbol: string): Promise<Address> {
    if (isAddress(addressOrSymbol)) return getAddress(addressOrSymbol);
    const bySym = this.chain.d.baskets[addressOrSymbol];
    if (bySym) return bySym;
    const all = await this.chain.baskets();
    for (const b of all) {
      const m = await this.chain.basketMeta(b);
      if (m.symbol.toLowerCase() === addressOrSymbol.toLowerCase()) return b;
    }
    throw new Error(`unknown basket ${addressOrSymbol}`);
  }

  async list() {
    const all = await this.chain.baskets();
    return Promise.all(all.map((b) => this.summary(b)));
  }

  // ------------------------------------------------------------------
  // Cards, performance, allocation
  // ------------------------------------------------------------------

  /**
   * The smallest order worth quoting. Every leg of a mint has to buy at least one raw unit of its token, and a
   * one-dollar order across seven constituents is fourteen cents a leg: fillable, but the gas is a visible share
   * of it. Below a dollar the fee and the rounding stop being noise.
   */
  static readonly FLOOR_USD = 1;

  async minUsd(_constituents: { ticker: string }[], _allocation: { weightBps: number | null }[]) {
    return Baskets.FLOOR_USD;
  }

  /**
   * Price return of one unit over each period: Σ sharesPerUnit × price(t) across the constituents whose price
   * at that point can be sourced. Sources, in order: the Chainlink feed's own rounds, the underlying's daily
   * closes, else the deepest Uniswap v3 pool's TWAP oracle, which reaches back as far as its observation buffer
   * holds. A period is null unless every constituent can be priced then, and `coverageBps` says
   * how much of today's NAV the priced constituents are, so a partial figure is never mistaken for a full one.
   */
  async performance(constituents: { ticker: string; sharesPerUnit: string; referencePrice: string | null }[]) {
    const now = Math.floor(Date.now() / 1000);
    const priced = await Promise.all(constituents.map(async (c) => ({
      ...c,
      sps: BigInt(c.sharesPerUnit),
      nav: c.referencePrice ? (BigInt(c.sharesPerUnit) * parseWad(c.referencePrice)) / WAD : 0n,
      source: await this.priceSource(c.ticker),
    })));
    const navTotal = priced.reduce((a, c) => a + c.nav, 0n);
    const covered = priced.filter((c) => c.source !== null);
    const coverageBps = navTotal === 0n ? 0 : Number((covered.reduce((a, c) => a + c.nav, 0n) * 10_000n) / navTotal);
    const returns = {} as Record<Period, number | null>;
    const coverage = {} as Record<Period, number>;
    const used = new Set<string>();
    for (const [k, days] of Object.entries(PERIODS) as [Period, number][]) {
      let thenValue = 0n, nowValue = 0n, navPriced = 0n;
      for (const c of covered) {
        // one source answers both ends of this period for this constituent, so the figure never straddles two
        const pair = await this.pricePair(c.ticker, now - days * 86_400, now);
        if (!pair) continue;
        thenValue += (pair.then * c.sps) / WAD;
        nowValue += (pair.now * c.sps) / WAD;
        navPriced += c.nav;
        used.add(pair.source);
      }
      coverage[k] = navTotal === 0n ? 0 : Number((navPriced * 10_000n) / navTotal);
      returns[k] = thenValue === 0n ? null : Number(((nowValue - thenValue) * 10_000n) / thenValue);
    }
    const unpriced = priced.filter((c) => c.source === null).map((c) => c.ticker);
    const label = { chainlink: "chainlink rounds", market: "daily closes", pool: "uniswap v3 twap" } as const;
    return {
      returns, coverage, coverageBps, covered: covered.length, total: constituents.length, unpriced,
      source: used.size === 0 ? null : [...used].map((x) => label[x as keyof typeof label]).join(" + ") + ", price return, dividends excluded",
    };
  }

  /**
   * Prices at both ends of a period from a single source, so the return carries no gap between sources. A
   * Chainlink feed wins where it exists; for the 24h figure a pool oracle is preferred over a daily close,
   * which by then is hours old; otherwise the daily closes, which are the only series that reaches back a year.
   */
  private async pricePair(ticker: string, then: number, now: number): Promise<{ then: bigint; now: bigint; source: string } | null> {
    const order = now - then <= 86_400 ? (["chainlink", "pool", "market"] as const) : (["chainlink", "market", "pool"] as const);
    for (const source of order) {
      if (source === "market") {
        // closes step back to the previous session when both ends land on the same bar, so a "1 day" figure
        // over a closed market is the last session's move rather than zero
        const p = await this.r.marketHistory.pair(ticker, then, now);
        if (p && p.then > 0n && p.now > 0n) return { ...p, source };
        continue;
      }
      const [a, b] = await Promise.all([this.priceFrom(ticker, then, now, source), this.priceFrom(ticker, now, now, source)]);
      if (a && b && a > 0n && b > 0n) return { then: a, now: b, source };
    }
    return null;
  }

  /** USD per underlying share at `ts` from one named source, or null when that source cannot answer. */
  private async priceFrom(ticker: string, ts: number, now: number, source: "chainlink" | "market" | "pool"): Promise<bigint | null> {
    if (source === "chainlink") return this.history.hasHistory(ticker) ? this.history.priceAt(ticker, ts) : null;
    if (source === "market") return this.r.marketHistory.priceAt(ticker, ts);
    const o = await this.oracleToken(ticker);
    if (!o || o.ratio === 0n) return null;
    const perToken = await this.r.poolOracle.tokenPriceAgo(o.token, Math.max(0, now - ts));
    // the pool prices the issuer's token; a share is that over the issuer ratio
    return perToken === null ? null : (perToken * WAD) / o.ratio;
  }

  /**
   * Which source prices `ticker`'s history, in order of standing: its Chainlink feed (onchain rounds), then the
   * underlying's daily closes (reaches two years), then a Uniswap pool's TWAP oracle (live but only days deep). Whichever is chosen answers *both* ends of a return, so no figure straddles two
   * sources and inherits the gap between them.
   */
  private async priceSource(ticker: string): Promise<"chainlink" | "market" | "pool" | null> {
    if (this.history.hasHistory(ticker)) return "chainlink";
    if (await this.r.marketHistory.has(ticker)) return "market";
    return (await this.oracleToken(ticker)) ? "pool" : null;
  }

  /** The representation whose pool we read history from: the deepest-pooled one that the registry knows. */
  private async oracleToken(ticker: string): Promise<{ token: Address; ratio: bigint } | null> {
    const key = ticker.toUpperCase();
    if (this.oracleTokens.has(key)) return this.oracleTokens.get(key)!;
    let out: { token: Address; ratio: bigint } | null = null;
    const u = await this.chain.underlying(tickerToId(ticker)).catch(() => null);
    for (const rep of u?.representations ?? []) {
      if ((await this.r.poolOracle.reachSeconds(rep.token)) > 0) { out = { token: rep.token, ratio: rep.ratio }; break; }
    }
    this.oracleTokens.set(key, out);
    return out;
  }

  /** USD per underlying *share* at `ts`, from this ticker's standing source. */
  private async priceAt(ticker: string, ts: number, now: number): Promise<bigint | null> {
    const source = await this.priceSource(ticker);
    return source === null ? null : this.priceFrom(ticker, ts, now, source);
  }

  /**
   * Per-constituent weight by value today, the 24h move and a 7-day sparkline where a source reaches.
   * `priceSource` names where the history came from, or null when there is none. `fundamentals` is always null
   * here: no source on Robinhood Chain publishes company figures, and none are invented.
   */
  async allocation(constituents: { ticker: string; sharesPerUnit: string; referencePrice: string | null }[]) {
    const navs = constituents.map((c) => (c.referencePrice ? (BigInt(c.sharesPerUnit) * parseWad(c.referencePrice)) / WAD : 0n));
    const total = navs.reduce((a, v) => a + v, 0n);
    const brands = this.chain.catalogue.brands();
    const now = Math.floor(Date.now() / 1000);
    return Promise.all(constituents.map(async (c, i) => {
      const meta = brands.get(c.ticker.toUpperCase());
      const source = await this.priceSource(c.ticker);
      const [ret, series, live24h] = await Promise.all([
        source === "chainlink" ? this.history.returns(c.ticker) : this.sourceReturns(c.ticker, now),
        source === "chainlink" ? this.history.series(c.ticker, 7, 14) : source === "market" ? this.r.marketHistory.series(c.ticker, 7, 14) : this.poolSeries(c.ticker, now),
        // a pool oracle is live where a daily close is a day old, so it wins the 24h figure when it reaches
        this.poolChange24h(c.ticker, now),
      ]);
      return {
        ticker: c.ticker, name: meta?.name ?? null, logoUrl: meta?.logoUrl ?? null,
        weightBps: total === 0n ? null : Number((navs[i]! * 10_000n) / total),
        valuePerUnitUsd: formatWad(navs[i]!, 4), priceUsd: c.referencePrice,
        change24hBps: live24h ?? ret?.d1 ?? null, sparkline: series?.map((p) => Number(BigInt(p.price) / 10n ** 14n) / 10_000) ?? null,
        priceSource: source, fundamentals: null,
      };
    }));
  }

  /** The 24h move straight from the pool oracle, when its buffer reaches a day back. */
  private async poolChange24h(ticker: string, now: number): Promise<number | null> {
    const o = await this.oracleToken(ticker);
    if (!o) return null;
    const [then, cur] = await Promise.all([
      this.r.poolOracle.tokenPriceAgo(o.token, 86_400),
      this.r.poolOracle.tokenPriceAgo(o.token, 0),
    ]);
    return then && cur && then > 0n ? Number(((cur - then) * 10_000n) / then) : null;
  }

  /** Returns over the standard periods, each from whichever single source can answer both of its ends. */
  private async sourceReturns(ticker: string, now: number): Promise<Record<Period, number | null> | null> {
    const out = {} as Record<Period, number | null>;
    let any = false;
    for (const [k, days] of Object.entries(PERIODS) as [Period, number][]) {
      const pair = await this.pricePair(ticker, now - days * 86_400, now);
      out[k] = pair ? Number(((pair.now - pair.then) * 10_000n) / pair.then) : null;
      any ||= pair !== null;
    }
    return any ? out : null;
  }

  /** A sparkline from the pool oracle, over whatever window its observation buffer still holds. */
  private async poolSeries(ticker: string, now: number): Promise<{ t: number; price: string }[] | null> {
    const o = await this.oracleToken(ticker);
    if (!o) return null;
    const reach = await this.r.poolOracle.reachSeconds(o.token);
    if (reach === 0) return null;
    const points = 12;
    const out: { t: number; price: string }[] = [];
    for (let i = points - 1; i >= 0; i--) {
      const t = now - Math.round((reach * i) / (points - 1));
      const p = await this.priceAt(ticker, t, now);
      if (p) out.push({ t, price: p.toString() });
    }
    return out.length > 1 ? out : null;
  }

  private cardMeta(symbol: string) {
    const idx = this.chain.fileIndices().find((i) => i.symbol === symbol);
    return { thesis: idx?.thesis ?? null, why: idx ? Object.fromEntries(idx.constituents.map((c) => [c.ticker, c.why ?? null])) : {} };
  }

  /** What the index page lists: deployed vaults where they exist, otherwise the curated definitions priced live. */
  /**
   * The index shelf, served from the last good snapshot.
   *
   * Pricing three indices walks Chainlink rounds, probes pool depth and asks two HTTP sources, which is fine on
   * a laptop and minutes on a box whose RPC and upstreams throttle it. So a request never computes it: it takes
   * the snapshot, and if that snapshot is older than the refresh window it kicks a refresh it does not wait for.
   * The snapshot survives a restart in the key-value table, so even a cold boot answers immediately with the
   * last figures and says how old they are.
   */
  private snapshot: { at: number; cards: Awaited<ReturnType<Baskets["cards"]>> } | null = null;
  private refreshing: Promise<unknown> | null = null;
  private static readonly SNAPSHOT_FRESH_MS = 45_000;

  private snapshotKey() {
    return `cards:${this.chain.cfg.CHAIN_ID}`;
  }

  private readSnapshot() {
    if (this.snapshot) return this.snapshot;
    const raw = this.r.db.getKv(this.snapshotKey());
    if (!raw) return null;
    try {
      this.snapshot = JSON.parse(raw) as NonNullable<Baskets["snapshot"]>;
      return this.snapshot;
    } catch {
      return null;
    }
  }

  async refreshCards() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.cards()
      .then((cards) => {
        this.snapshot = { at: Date.now(), cards };
        this.r.db.setKv(this.snapshotKey(), JSON.stringify(this.snapshot));
        log.info("index shelf priced", { baskets: cards.length });
      })
      .catch((e) => log.warn("index shelf refresh failed", { err: (e as Error).message }))
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  /** What `/baskets` answers with: the snapshot, plus when it was taken. */
  async cardsCached() {
    const have = this.readSnapshot();
    if (!have) {
      await this.refreshCards();
      return { at: this.snapshot?.at ?? Date.now(), cards: this.snapshot?.cards ?? [] };
    }
    if (Date.now() - have.at > Baskets.SNAPSHOT_FRESH_MS) void this.refreshCards();
    return have;
  }

  async cards() {
    if (this.chain.isQuoteOnly) {
      return Promise.all(this.chain.fileIndices().map(async (idx) => {
        const constituents = await Promise.all(idx.constituents.map(async (c) => {
          const u = await this.chain.underlying(tickerToId(c.ticker)).catch(() => null);
          const ref = u ? await this.r.referencePrice(u) : null;
          return { ticker: c.ticker, sharesPerUnit: c.sharesPerUnit, referencePrice: ref ? formatWad(ref.price, 4) : null };
        }));
        const nav = constituents.reduce((a, c) => a + (c.referencePrice ? (BigInt(c.sharesPerUnit) * parseWad(c.referencePrice)) / WAD : 0n), 0n);
        const allocation = await this.allocation(constituents);
        return { symbol: idx.symbol, name: idx.name, deployed: false, address: null, thesis: idx.thesis, navPerUnitUsd: formatWad(nav, 4), minUsd: await this.minUsd(constituents, allocation), performance: await this.performance(constituents), allocation };
      }));
    }
    const list = await this.list();
    // warm every ticker's daily bars in one round trip: asking for them constituent by constituent turns one
    // slow upstream into nineteen of them in a row
    await this.r.marketHistory.prefetch(list.flatMap((b) => b.constituents.map((c) => c.ticker)));
    return Promise.all(list.map(async (b) => {
      const allocation = await this.allocation(b.constituents);
      return { ...b, deployed: true, ...this.cardMeta(b.symbol), minUsd: await this.minUsd(b.constituents, allocation), performance: await this.performance(b.constituents), allocation };
    }));
  }

  /** A deployed basket's summary with the card fields on top. */
  async enrich(summary: Awaited<ReturnType<Baskets["summary"]>>) {
    await this.r.marketHistory.prefetch(summary.constituents.map((c) => c.ticker));
    const allocation = await this.allocation(summary.constituents);
    return { ...summary, deployed: true, ...this.cardMeta(summary.symbol), minUsd: await this.minUsd(summary.constituents, allocation), performance: await this.performance(summary.constituents), allocation };
  }

  /** Quote-only detail for an index that is defined but not deployed on this network. */
  async plannedDetail(symbol: string) {
    const card = (await this.cards()).find((c) => c.symbol.toLowerCase() === symbol.toLowerCase());
    if (!card) throw new Error(`unknown basket ${symbol}`);
    const idx = this.chain.fileIndices().find((i) => i.symbol === card.symbol)!;
    const universe = await this.chain.allUnderlyings();
    // the issuers the vault would buy from, with nothing held yet
    const reps = async (ticker: string) => Promise.all((universe.find((u) => u.ticker === ticker)?.representations ?? []).map(async (r) => {
      const depth = await this.r.venues.depth(r.token).catch(() => ({ usdg: 0n, tiers: [] as number[], bestFee: null }));
      return {
        token: r.token, symbol: r.symbol, platform: r.platform, tokens: "0", shares: "0", shareBps: 0, buyEligible: r.buyEligible,
        ratio: r.ratio.toString(), ratioSource: r.ratioSource,
        poolUsdg: depth.usdg.toString(), poolFees: depth.tiers, route: depth.tiers.length > 0 ? "pool" : "none",
      };
    }));
    return { ...card, totalSupply: "0", usdgBalance: "0", navSource: "chainlink reference prices (display only)", backingOk: true, issuerMix: [], why: Object.fromEntries(idx.constituents.map((c) => [c.ticker, c.why ?? null])),
      constituents: await Promise.all(idx.constituents.map(async (c) => {
        const a = card.allocation.find((x) => x.ticker === c.ticker);
        return {
          ticker: c.ticker, sharesPerUnit: c.sharesPerUnit, weightBps: a?.weightBps ?? c.weightBps, requiredShares: "0", heldShares: "0",
          backingRatio: null, maxIssuerBps: 10_000, capActive: false, singleIssuer: false,
          referencePrice: a?.priceUsd ?? null, valuePerUnitUsd: a?.valuePerUnitUsd ?? null, representations: await reps(c.ticker),
        };
      })) };
  }

  async summary(basket: Address) {
    const meta = await this.chain.basketMeta(basket);
    const comp = await this.chain.basketComposition(basket);
    const constituents = [];
    let navPerUnit = 0n; // 1e18 USD
    let navKnown = true;
    let issuerMix: Record<string, bigint> = {};
    let totalShares = 0n;
    // registry + reference reads per constituent are independent; a public RPC makes them expensive in series
    const priced = await Promise.all(comp.map(async (c) => {
      const u = await this.chain.underlying(c.underlyingId);
      return { u, ref: await this.r.referencePrice(u) };
    }));
    for (let i = 0; i < comp.length; i++) {
      const c = comp[i]!;
      const ticker = idToTicker(c.underlyingId);
      const { u, ref } = priced[i]!;
      if (ref) navPerUnit += (c.sharesPerUnit * ref.price) / WAD;
      else navKnown = false;
      const reps = await Promise.all(c.representations.map(async (rv) => {
        const info = u.representations.find((x) => x.token.toLowerCase() === rv.token.toLowerCase());
        const platform = idToTicker(rv.platformId);
        issuerMix[platform] = (issuerMix[platform] ?? 0n) + rv.shares;
        // what could be filled onchain right now: an empty vault says nothing about where a mint would route
        const depth = await this.r.venues.depth(rv.token).catch(() => ({ usdg: 0n, tiers: [] as number[], bestFee: null }));
        return {
          token: rv.token, symbol: info?.symbol ?? rv.token, platform, tokens: rv.tokens.toString(), shares: rv.shares.toString(),
          shareBps: rv.shareBps, buyEligible: rv.buyEligible, ratio: info?.ratio.toString() ?? null, ratioSource: info?.ratioSource ?? null,
          poolUsdg: depth.usdg.toString(), poolFees: depth.tiers, route: depth.tiers.length > 0 ? "pool" : "none",
        };
      }));
      totalShares += c.heldShares;
      const eligibleCount = reps.filter((x) => x.buyEligible).length;
      constituents.push({
        ticker, underlyingId: c.underlyingId, sharesPerUnit: c.sharesPerUnit.toString(), requiredShares: c.requiredShares.toString(),
        heldShares: c.heldShares.toString(),
        backingRatio: c.requiredShares === 0n ? null : Number((c.heldShares * 1_000_000n) / c.requiredShares) / 1_000_000,
        maxIssuerBps: c.maxIssuerBps, capActive: c.maxIssuerBps < 10_000 && eligibleCount >= 2, singleIssuer: eligibleCount < 2,
        referencePrice: ref ? formatWad(ref.price, 4) : null,
        // the constituent's share of one unit in dollars, at today's reference price
        valuePerUnitUsd: ref ? formatWad((c.sharesPerUnit * ref.price) / WAD, 4) : null,
        representations: reps,
      });
    }
    for (const c of constituents) {
      // weight by value, so the vault table reads like the allocation even with nothing minted
      const nav = c.valuePerUnitUsd ? parseWad(c.valuePerUnitUsd) : 0n;
      (c as { weightBps?: number | null }).weightBps = navPerUnit === 0n || !navKnown ? null : Number((nav * 10_000n) / navPerUnit);
    }
    const backingOk = constituents.every((c) => c.backingRatio === null || c.backingRatio >= 1);
    const mix = Object.entries(issuerMix).map(([platform, shares]) => ({ platform, bps: totalShares === 0n ? 0 : Number((shares * 10_000n) / totalShares) }));
    return {
      address: basket, name: meta.name, symbol: meta.symbol, totalSupply: meta.totalSupply.toString(), usdgBalance: meta.usdgBalance.toString(),
      navPerUnitUsd: navKnown ? formatWad(navPerUnit, 4) : null, navSource: navKnown ? "chainlink/onchain (display only)" : "unavailable",
      backingOk, issuerMix: mix, constituents,
    };
  }

  // ------------------------------------------------------------------
  // Mint
  // ------------------------------------------------------------------

  /**
   * Quote a mint against a USDG budget: the caller says what it is willing to spend, and the quote comes back
   * sized so `maxUsdgIn` — the ceiling the vault may pull, fee included — does not exceed it. Units are priced
   * at NAV times the last measured cost of a dollar of NAV; if that estimate overshoots, the plan runs once
   * more with the cost this plan just measured. One pass when warm, two when cold or after a spread move.
   */
  private async quoteMintForBudget(p: { basket: string; budgetUsdg: string; policy?: Partial<Policy>; wallet?: string; recipient?: string }) {
    const budget = parseUsdg(p.budgetUsdg);
    if (budget <= 0n) throw new Error("budget must be positive");
    const first = await this.planMint(p);
    if (first.problems.length || BigInt(first.maxUsdgIn) <= budget) return first;
    const second = await this.planMint(p);
    if (second.problems.length || BigInt(second.maxUsdgIn) <= budget) return second;
    return { ...second, tx: null, problems: [...second.problems, `the cheapest route for this index needs ${formatUsdg(BigInt(second.maxUsdgIn), 2)} USDG, more than the ${formatUsdg(budget, 2)} budget`] };
  }

  /** Quote a mint, sized either by units, by NAV value (`usdAmount`) or by what the buyer will spend (`budgetUsdg`). */
  async quoteMint(p: { basket: string; units?: string; usdAmount?: string; budgetUsdg?: string; policy?: Partial<Policy>; wallet?: string; recipient?: string }) {
    if (p.budgetUsdg) return this.quoteMintForBudget({ ...p, budgetUsdg: p.budgetUsdg });
    return this.planMint(p);
  }

  private async planMint(p: { basket: string; units?: string; usdAmount?: string; budgetUsdg?: string; policy?: Partial<Policy>; wallet?: string; recipient?: string }) {
    const policy = PolicySchema.parse(p.policy ?? {});
    const basket = await this.resolveBasket(p.basket);
    const meta = await this.chain.basketMeta(basket);
    const comp = await this.chain.basketComposition(basket);
    const summary = await this.summary(basket);
    const wallet = p.wallet && isAddress(p.wallet) ? getAddress(p.wallet) : undefined;
    const recipient = p.recipient && isAddress(p.recipient) ? getAddress(p.recipient) : wallet;

    let units: bigint;
    if (p.units) units = parseWad(p.units);
    // a budget is what the buyer spends, so size the units on the last measured cost of a dollar of NAV
    else if (p.budgetUsdg && summary.navPerUnitUsd) units = (usdgToWad(parseUsdg(p.budgetUsdg)) * WAD * RATIO_SCALE) / (parseWad(summary.navPerUnitUsd) * BigInt(Math.round((this.mintCostRatio.get(basket) ?? COLD_MINT_COST_RATIO) * MINT_BUDGET_HEADROOM * Number(RATIO_SCALE))));
    else if (p.usdAmount && summary.navPerUnitUsd) units = (parseWad(p.usdAmount) * WAD) / parseWad(summary.navPerUnitUsd);
    else throw new Error("units, a budget, or usdAmount with a known NAV, is required");
    if (units <= 0n) throw new Error("units must be positive");

    const legs: Leg[] = [];
    const breakdown = [];
    let maxUsdgIn = 0n;
    let expectedUsdg = 0n;
    const fee = await this.chain.fee();
    const problems: string[] = [];
    const now = await this.chain.now();
    const limits = await this.chain.limits();

    for (let i = 0; i < comp.length; i++) {
      const c = comp[i]!;
      const u = await this.chain.underlying(c.underlyingId);
      const ref = await this.r.referencePrice(u);
      // the vault requires this call's legs to deliver every constituent's share of `units` (audit F-1): existing
      // slack stays with the holders who built it, so size the need on the units alone.
      let needed = requiredShares(units, c.sharesPerUnit);
      // 1 bps safety margin on shares so tiny ratio drift between quote and execution cannot under-deliver
      needed = needed + needed / 10_000n + 1n;
      const eligible = u.representations.filter((r) => r.buyEligible && !policy.excludePlatforms.includes(r.platform as Policy["excludePlatforms"][number]));
      // why each one is out, in the registry's own terms: a constituent that cannot be bought should say whether
      // an attestation aged out, a keeper ratio aged out, or a policy excluded it — never just "0 eligible"
      const rejected = u.representations
        .filter((r) => !eligible.includes(r))
        .map((r) => {
          const why = policy.excludePlatforms.includes(r.platform as Policy["excludePlatforms"][number])
            ? ["excluded by policy"]
            : reasonsForRegistry(r, limits, now);
          return `${r.symbol}: ${why.length ? why.join("; ") : "not buy-eligible in the registry"}`;
        });
      const heldByPlatform = new Map<string, bigint>();
      for (const rv of c.representations) heldByPlatform.set(idToTicker(rv.platformId), (heldByPlatform.get(idToTicker(rv.platformId)) ?? 0n) + rv.shares);
      const capActive = c.maxIssuerBps < 10_000 && u.representations.filter((r) => r.buyEligible).length >= 2;
      const totalAfter = c.heldShares + needed;
      // 20 bps haircut on the cap so ceil-rounded fills cannot land a hair above it onchain
      const capShares = capActive ? (totalAfter * BigInt(c.maxIssuerBps) * 9_980n) / 100_000_000n : totalAfter;

      // price every eligible representation for the full need (exact output), then allocate best-first within caps
      const priced = [];
      for (const rep of eligible) {
        const tokens = tokensForShares(needed, rep.ratio);
        const q = needed === 0n ? null : await this.r.venues.bestExactOutput(this.chain.d.usdg, rep.token, tokens);
        priced.push({ rep, tokens, q, costPerShare: q ? (usdgToWad(q.amountIn) * WAD) / needed : null });
      }
      priced.sort((a, b) => (a.costPerShare === null ? 1 : b.costPerShare === null ? -1 : a.costPerShare < b.costPerShare ? -1 : 1));
      let remaining = needed;
      const fills = [];
      for (const cand of priced) {
        if (remaining === 0n) break;
        if (!cand.q) continue;
        const room = capActive ? capShares - (heldByPlatform.get(cand.rep.platform) ?? 0n) : remaining;
        const take = room < remaining ? (room > 0n ? room : 0n) : remaining;
        if (take === 0n) continue;
        const tokens = tokensForShares(take, cand.rep.ratio);
        const q = take === needed ? cand.q : await this.r.venues.bestExactOutput(this.chain.d.usdg, cand.rep.token, tokens);
        if (!q) continue;
        const maxIn = q.amountIn + (q.amountIn * MINT_BUFFER_BPS) / 10_000n + 1n;
        legs.push(this.r.venues.exactOutputLeg(q, this.chain.d.usdg, cand.rep.token, maxIn, basket));
        maxUsdgIn += maxIn;
        expectedUsdg += q.amountIn;
        heldByPlatform.set(cand.rep.platform, (heldByPlatform.get(cand.rep.platform) ?? 0n) + take);
        fills.push({
          token: cand.rep.token, symbol: cand.rep.symbol, platform: cand.rep.platform, venue: q.venue, shares: take.toString(), tokens: tokens.toString(),
          usdgIn: q.amountIn.toString(), maxUsdgIn: maxIn.toString(), costPerShareUsd: formatWad((usdgToWad(q.amountIn) * WAD) / take, 4),
          premiumBps: ref ? Number((((usdgToWad(q.amountIn) * WAD) / take - ref.price) * 10_000n) / ref.price) : null,
        });
        remaining -= take;
      }
      if (remaining > 0n && needed > 0n) {
        const detail = eligible.length === 0
          ? `no representation is buy-eligible right now — ${rejected.join(" · ")}`
          : `${eligible.length} eligible representation(s); ${priced.filter((x) => !x.q).length} with no pool that can fill this size${capActive ? ", issuer cap active" : ""}${rejected.length ? `; also out: ${rejected.join(" · ")}` : ""}`;
        problems.push(`${idToTicker(c.underlyingId)}: could not source ${formatWad(remaining, 6)} shares (${detail})`);
      }
      breakdown.push({
        ticker: idToTicker(c.underlyingId), neededShares: needed.toString(), surplusShares: (c.heldShares > requiredShares(meta.totalSupply, c.sharesPerUnit) ? c.heldShares - requiredShares(meta.totalSupply, c.sharesPerUnit) : 0n).toString(),
        capActive, maxIssuerBps: c.maxIssuerBps, fills, unfilledShares: remaining.toString(),
        candidates: priced.map((x) => ({ symbol: x.rep.symbol, platform: x.rep.platform, costPerShareUsd: x.costPerShare ? formatWad(x.costPerShare, 4) : null, liquidity: Boolean(x.q) })),
      });
    }

    // the vault charges the fee on what it spends, out of the unspent remainder: maxUsdgIn must cover the fee on
    // the worst case, and the expected cost carries the fee on the expected spend
    const feeOnMax = feeOn(maxUsdgIn, fee.bps);
    const feeOnExpected = feeOn(expectedUsdg, fee.bps);
    maxUsdgIn += feeOnMax;
    // what a dollar of NAV actually costs to buy right now (spread + buffer + fee), so a budget can be sized
    if (summary.navPerUnitUsd && !problems.length) {
      const navValue = (units * parseWad(summary.navPerUnitUsd)) / WAD;
      if (navValue > 0n) this.mintCostRatio.set(basket, Number(usdgToWad(maxUsdgIn)) / Number(navValue));
    }
    const record = {
      kind: "mint", basket, symbol: meta.symbol, units: units.toString(), timestamp: now, policy, dataSource: this.r.dataSource,
      navPerUnitUsd: summary.navPerUnitUsd, expectedUsdg: (expectedUsdg + feeOnExpected).toString(), maxUsdgIn: maxUsdgIn.toString(),
      fee: { bps: fee.bps, usdg: feeOnExpected.toString(), recipient: fee.recipient, onInKindRedeem: false },
      legs: serializeLegs(legs), breakdown, problems, status: problems.length ? "no_route" : "ok", chainId: this.chain.cfg.CHAIN_ID, recipient: recipient ?? null,
    };
    const quoteHash = quoteHashOf(record);
    let tx = null;
    let simulation = null;
    if (!problems.length && recipient) {
      const data = encodeFunctionData({ abi: BasketVaultAbi, functionName: "mint", args: [units, maxUsdgIn, legs, recipient, quoteHash] });
      tx = { to: basket, data, value: "0", from: wallet, chainId: this.chain.cfg.CHAIN_ID } as { to: string; data: string; value: string; from?: string; chainId: number; gas?: string };
      if (wallet) {
        const s = await this.r.sim.simulate({ from: wallet, to: basket, data: data, usdgSpender: basket, usdgAmount: maxUsdgIn });
        simulation = { ok: s.ok, gasUsed: s.gasUsed, error: s.error, approvalNeeded: s.approvalNeeded };
        if (s.gasUsed) tx.gas = ((BigInt(s.gasUsed) * 12n) / 10n).toString();
        if (!s.ok) {
          log.warn("mint simulation failed; withholding tx", { basket, error: s.error });
          tx = null;
        }
      }
    }
    const out = { ...record, tx, simulation, quoteHash, usdg: this.chain.d.usdg, limits };
    this.r.db.putQuote(quoteHash, "mint", JSON.stringify(out), { basket });
    return out;
  }

  // ------------------------------------------------------------------
  // Redeem
  // ------------------------------------------------------------------

  async quoteRedeem(p: { basket: string; units: string; inKind?: boolean; policy?: Partial<Policy>; wallet?: string; recipient?: string }) {
    const policy = PolicySchema.parse(p.policy ?? {});
    const basket = await this.resolveBasket(p.basket);
    const meta = await this.chain.basketMeta(basket);
    const comp = await this.chain.basketComposition(basket);
    const units = parseWad(p.units);
    if (units <= 0n) throw new Error("units must be positive");
    if (units > meta.totalSupply) throw new Error("units exceed total supply");
    const wallet = p.wallet && isAddress(p.wallet) ? getAddress(p.wallet) : undefined;
    const recipient = p.recipient && isAddress(p.recipient) ? getAddress(p.recipient) : wallet;
    const now = Math.floor(Date.now() / 1000);

    const legs: Leg[] = [];
    const slices = [];
    let usdgOut = 0n;
    let minUsdgOut = 0n;
    const usdgSlice = proRata(meta.usdgBalance, units, meta.totalSupply);
    for (const c of comp) {
      const u = await this.chain.underlying(c.underlyingId);
      const ref = await this.r.referencePrice(u);
      for (const rv of c.representations) {
        const amount = proRata(rv.tokens, units, meta.totalSupply);
        if (amount === 0n) continue;
        const rep = u.representations.find((x) => x.token.toLowerCase() === rv.token.toLowerCase())!;
        let sold: { venue: string; usdgOut: string; minUsdgOut: string } | null = null;
        if (!p.inKind) {
          const q = await this.r.venues.bestExactInput(rep.token, this.chain.d.usdg, amount);
          if (q) {
            const min = applySlippage(q.amountOut, policy.maxSlippageBps);
            legs.push(this.r.venues.exactInputLeg(q, rep.token, this.chain.d.usdg, min, basket));
            usdgOut += q.amountOut;
            minUsdgOut += min;
            sold = { venue: q.venue, usdgOut: q.amountOut.toString(), minUsdgOut: min.toString() };
          }
        }
        slices.push({
          ticker: idToTicker(c.underlyingId), token: rep.token, symbol: rep.symbol, platform: rep.platform, tokens: amount.toString(),
          shares: sharesForTokens(amount, rep.ratio).toString(), valueUsd: ref ? formatWad((sharesForTokens(amount, rep.ratio) * ref.price) / WAD, 4) : null,
          sold, deliveredInKind: !sold,
        });
      }
    }
    usdgOut += usdgSlice;
    minUsdgOut += usdgSlice;
    // a USDG redemption pays the fee out of the proceeds and the onchain minimum is net of it; in kind carries none
    const fee = await this.chain.fee();
    const feeUsdg = p.inKind ? 0n : feeOn(usdgOut, fee.bps);
    usdgOut -= feeUsdg;
    minUsdgOut -= p.inKind ? 0n : feeOn(minUsdgOut, fee.bps);
    const record = {
      kind: p.inKind ? "redeemInKind" : "redeem", basket, symbol: meta.symbol, units: units.toString(), timestamp: now, policy, dataSource: this.r.dataSource,
      usdgSlice: usdgSlice.toString(), usdgOut: usdgOut.toString(), minUsdgOut: minUsdgOut.toString(), legs: serializeLegs(legs), slices,
      fee: { bps: p.inKind ? 0 : fee.bps, usdg: feeUsdg.toString(), recipient: fee.recipient, onInKindRedeem: false },
      chainId: this.chain.cfg.CHAIN_ID, recipient: recipient ?? null, status: "ok",
    };
    const quoteHash = quoteHashOf(record);
    let tx = null;
    let simulation = null;
    if (recipient) {
      const data = p.inKind
        ? encodeFunctionData({ abi: BasketVaultAbi, functionName: "redeemInKind", args: [units, recipient] })
        : encodeFunctionData({ abi: BasketVaultAbi, functionName: "redeem", args: [units, minUsdgOut, legs, recipient, quoteHash] });
      tx = { to: basket, data, value: "0", from: wallet, chainId: this.chain.cfg.CHAIN_ID } as { to: string; data: string; value: string; from?: string; chainId: number; gas?: string };
      if (wallet) {
        const s = await this.r.sim.simulate({ from: wallet, to: basket, data });
        simulation = { ok: s.ok, gasUsed: s.gasUsed, error: s.error };
        if (s.gasUsed) tx.gas = ((BigInt(s.gasUsed) * 12n) / 10n).toString();
        if (!s.ok) tx = null;
      }
    }
    const out = { ...record, tx, simulation, quoteHash };
    this.r.db.putQuote(quoteHash, record.kind, JSON.stringify(out), { basket });
    return out;
  }

  // ------------------------------------------------------------------
  // Migrations
  // ------------------------------------------------------------------

  /**
   * The rebalance trail for one index: every `Migrated` the vault has emitted, newest first, joined to the scoring
   * record its quote hash points at, plus the date the index went live. The vault only ever rebalances *within* a
   * constituent — one issuer's representation for another's, and only when the shares held strictly increase — so a
   * row is a change of issuer, never a change of weight. What is missing from a row is a quote record this resolver
   * does not hold; the onchain numbers are always there.
   */
  async rebalances(p: { basket: string; limit?: number }) {
    const basket = await this.resolveBasket(p.basket);
    const meta = await this.chain.basketMeta(basket);
    const rows = this.r.db.listRebalances({ basket, limit: p.limit ?? 50 });
    const executed = rows.map((row, i) => {
      const q = this.r.db.getQuote(String(row.quote_hash));
      const rec = (q ? JSON.parse(q.json) : null) as null | {
        ticker: string; from: string; to: string; fractionBps: number; gainBps: number; why: string; sellTokens: string;
        sharesOut: string; sharesIn: string; heldSharesBefore?: string; heldSharesAfter?: string;
        split?: { symbol: string; platform: string; shares: string; sharesAfter: string }[];
      };
      const version = rows.length - i;
      return {
        txHash: String(row.tx_hash), blockNumber: Number(row.block_number), timestamp: Number(row.timestamp ?? 0), caller: String(row.caller),
        quoteHash: String(row.quote_hash), ticker: rec?.ticker ?? idToTicker(row.underlying_id as `0x${string}`), shareGain: String(row.share_gain),
        fromVersion: version, toVersion: version + 1,
        from: rec?.from ?? null, to: rec?.to ?? null, fractionBps: rec?.fractionBps ?? null, gainBps: rec?.gainBps ?? null,
        why: rec?.why ?? null, sellTokens: rec?.sellTokens ?? null, sharesOut: rec?.sharesOut ?? null, sharesIn: rec?.sharesIn ?? null,
        heldSharesBefore: rec?.heldSharesBefore ?? null, heldSharesAfter: rec?.heldSharesAfter ?? null, split: rec?.split ?? null,
        quoteRecord: Boolean(rec),
      };
    });
    let liveSince: { block: number; timestamp: number } | null = null;
    const deployBlock = this.chain.d.deployBlock;
    if (deployBlock !== undefined) {
      try {
        const b = await this.chain.client.getBlock({ blockNumber: BigInt(deployBlock) });
        liveSince = { block: deployBlock, timestamp: Number(b.timestamp) };
      } catch {
        liveSince = { block: deployBlock, timestamp: 0 };
      }
    }
    return { basket, symbol: meta.symbol, minGainBps: MIGRATION_MIN_GAIN_BPS, version: executed.length + 1, executed, liveSince };
  }

  /** Share-accretive migrations available right now for a basket (or all baskets). */
  async migrations(p: { basket?: string; minGainBps?: number } = {}) {
    const minGain = BigInt(p.minGainBps ?? MIGRATION_MIN_GAIN_BPS);
    const baskets = p.basket ? [await this.resolveBasket(p.basket)] : await this.chain.baskets();
    const out = [];
    for (const basket of baskets) {
      const comp = await this.chain.basketComposition(basket);
      const meta = await this.chain.basketMeta(basket);
      for (const c of comp) {
        const u = await this.chain.underlying(c.underlyingId);
        const capActive = c.maxIssuerBps < 10_000 && u.representations.filter((r) => r.buyEligible).length >= 2;
        for (const from of c.representations) {
          if (from.tokens === 0n) continue;
          const fromRep = u.representations.find((x) => x.token.toLowerCase() === from.token.toLowerCase())!;
          for (const toRep of u.representations) {
            if (toRep.token.toLowerCase() === from.token.toLowerCase() || !toRep.buyEligible) continue;
            for (const fracBps of [10_000n, 5_000n, 2_500n, 1_000n]) {
              const sellTokens = (from.tokens * fracBps) / 10_000n;
              if (sellTokens === 0n) continue;
              const q1 = await this.r.venues.bestExactInput(fromRep.token, this.chain.d.usdg, sellTokens);
              if (!q1) break;
              const q2 = await this.r.venues.bestExactInput(this.chain.d.usdg, toRep.token, q1.amountOut);
              if (!q2) break;
              const sharesOut = sharesForTokens(sellTokens, fromRep.ratio);
              const sharesIn = sharesForTokens(q2.amountOut, toRep.ratio);
              if (sharesIn <= sharesOut) continue;
              const gain = sharesIn - sharesOut;
              const gainBps = (gain * 10_000n) / sharesOut;
              if (gainBps < minGain) continue;
              // issuer cap post-state
              if (capActive) {
                const toPlatformAfter = c.representations.filter((x) => idToTicker(x.platformId) === toRep.platform).reduce((a, x) => a + x.shares, 0n) + sharesIn;
                const totalAfter = c.heldShares + gain;
                if ((toPlatformAfter * 10_000n) / totalAfter > BigInt(c.maxIssuerBps)) continue;
              }
              const legs = [
                this.r.venues.exactInputLeg(q1, fromRep.token, this.chain.d.usdg, applySlippage(q1.amountOut, 50), basket),
                this.r.venues.exactInputLeg(q2, this.chain.d.usdg, toRep.token, applySlippage(q2.amountOut, 50), basket),
              ];
              const minShareGain = applySlippage(gain, 5_000); // accept half the expected gain as the hard floor
              // the constituent's issuer split before and after this move, so the record can be read as a weight change
              const split = [...c.representations, ...(c.representations.some((x) => x.token.toLowerCase() === toRep.token.toLowerCase()) ? [] : [{ token: toRep.token, shares: 0n, tokens: 0n, platformId: tickerToId(toRep.platform) }])].map((rv) => {
                const rep = u.representations.find((x) => x.token.toLowerCase() === rv.token.toLowerCase());
                const delta = rv.token.toLowerCase() === fromRep.token.toLowerCase() ? -sharesOut : rv.token.toLowerCase() === toRep.token.toLowerCase() ? sharesIn : 0n;
                return { symbol: rep?.symbol ?? rv.token, platform: rep?.platform ?? idToTicker(rv.platformId), shares: rv.shares.toString(), sharesAfter: (rv.shares + delta).toString() };
              });
              const record = {
                kind: "migrate", basket, symbol: meta.symbol, ticker: idToTicker(c.underlyingId), from: fromRep.symbol, to: toRep.symbol, fractionBps: Number(fracBps),
                heldSharesBefore: c.heldShares.toString(), heldSharesAfter: (c.heldShares + gain).toString(), split,
                sellTokens: sellTokens.toString(), sharesOut: sharesOut.toString(), sharesIn: sharesIn.toString(), gain: gain.toString(), gainBps: Number(gainBps),
                minShareGain: minShareGain.toString(), legs: serializeLegs(legs), timestamp: Math.floor(Date.now() / 1000), chainId: this.chain.cfg.CHAIN_ID,
                why: `sell ${formatWad(sellTokens, 4)} ${fromRep.symbol} → ${formatUsdg(q1.amountOut, 2)} USDG → ${formatWad(q2.amountOut, 4)} ${toRep.symbol}: +${formatWad(gain, 6)} shares (+${gainBps} bps)`,
              };
              const quoteHash = quoteHashOf(record);
              const data = encodeFunctionData({ abi: BasketVaultAbi, functionName: "migrate", args: [c.underlyingId, legs, minShareGain, quoteHash] });
              this.r.db.putQuote(quoteHash, "migrate", JSON.stringify({ ...record, quoteHash }), { basket });
              out.push({ ...record, quoteHash, tx: { to: basket, data, value: "0", chainId: this.chain.cfg.CHAIN_ID } });
              break; // largest accretive fraction found for this pair
            }
          }
        }
      }
    }
    return out;
  }
}
