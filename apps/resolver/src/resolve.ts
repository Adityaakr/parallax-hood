import { type Address, type Hex, encodeFunctionData, isAddress, getAddress } from "viem";
import {
  ShareRouterAbi, WAD, USDG_UNIT, parseWad, formatWad, parseUsdg, formatUsdg, usdgToWad, serializeLegs, tickerToId, sharesForTokens, PolicySchema, type Policy, type ResolveResult,
  feeOn } from "@parallax-hood/sdk";
import type { Chain, UnderlyingInfo } from "./chain.js";
import { Venues } from "./providers/venues.js";
import { PoolOracle } from "./providers/poolOracle.js";
import { MarketHistory } from "./providers/marketHistory.js";
import { computedMarketStatus, type MarketStatus } from "./providers/marketHours.js";
import { RobinhoodApi, type IssuerAsset, type IssuerQuote } from "./providers/robinhood.js";
import { scoreBuy, scoreSell, attestationRequired, type ScoredCandidate } from "./scoring.js";
import { Simulator } from "./simulate.js";
import { quoteHashOf } from "./quotes.js";
import type { Db } from "./db.js";
import { logger } from "./log.js";

const log = logger("resolve");

export type ReferencePrice = { price: bigint; source: string; updatedAt: number | null; alt?: { source: string; price: bigint } };

/** What the issuer itself says about a stock right now, read from Robinhood's API. */
export type IssuerView = {
  source: string;
  /** the mainnet token the issuer lists for this symbol; it matched the one this network trades or stands in for */
  token: Address;
  status: IssuerAsset["status"];
  isin: string | null;
  multiplier: string;
  pendingMultiplier: IssuerAsset["pendingMultiplier"];
  sessions: IssuerAsset["sessions"];
  /** null when the quote route did not answer; the asset fields above still stand */
  quote: (Omit<IssuerQuote, "symbol" | "token"> & { mid: string }) | null;
};

export class Resolver {
  readonly venues: Venues;
  /** Pool-oracle history for the representations Chainlink has no feed for. */
  readonly poolOracle: PoolOracle;
  /** Daily closes of the underlying stock, for the periods no onchain source reaches. */
  readonly marketHistory: MarketHistory;
  readonly sim: Simulator;
  /** Robinhood's own API: quotes, sessions and corporate actions for the real tokens. Off on a pure mock network. */
  readonly issuer: RobinhoodApi;
  constructor(readonly chain: Chain, readonly db: Db) {
    this.venues = new Venues(chain);
    this.poolOracle = new PoolOracle(chain);
    this.marketHistory = new MarketHistory(chain.cfg.MARKET_HISTORY && !chain.isMocks, db, chain.cfg.MARKET_HISTORY_URL);
    this.sim = new Simulator(chain);
    this.issuer = new RobinhoodApi(chain.cfg.issuerApi);
  }

  /** "live" when prices and ratios are read from Robinhood Chain; "fixture" when a mock venue stands in for them. */
  get dataSource(): "live" | "fixture" {
    return this.chain.isMocks && !this.chain.isHybrid ? "fixture" : "live";
  }

  // ------------------------------------------------------------------
  // Shared inputs
  // ------------------------------------------------------------------

  async underlyingByTicker(ticker: string): Promise<UnderlyingInfo> {
    const id = tickerToId(ticker.toUpperCase());
    const u = await this.chain.underlying(id);
    if (!u.active && u.representations.length === 0) throw new Error(`unknown underlying ${ticker}`);
    return u;
  }

  /**
   * Reference price in USD per underlying share. Where the registry is deployed with a feed it is the registry's
   * own answer, which is the number the mandate's floor uses. Otherwise the Chainlink feed is read directly and,
   * because Robinhood Chain's stock feeds price the token with its multiplier in it, divided by the token's
   * ratio. A mock network without either falls back to the mock venue's price, and says so.
   */
  async referencePrice(u: UnderlyingInfo): Promise<ReferencePrice | null> {
    const hybrid = this.chain.isHybrid;
    // a hybrid network prices against the real market, not against the mock registry's posted number
    if (!hybrid) {
      const onchain = await this.chain.registryPrice(u.id);
      if (onchain) {
        const fed = this.chain.catalogue.feed(u.ticker) !== null && !this.chain.isMocks;
        return { price: onchain.price, source: fed ? `chainlink:${u.ticker}/USD via registry` : "registry reference price", updatedAt: onchain.updatedAt };
      }
    }
    const cl = await this.chain.chainlinkPrice(u.ticker);
    const rep = u.representations[0];
    if (cl && rep) {
      const perToken = (cl.price * WAD) / 10n ** BigInt(cl.decimals);
      // the feed belongs to the mainnet token: on a hybrid network that is the mock's twin, with its own multiplier
      const ratio = hybrid ? await this.chain.mainnetMultiplier(this.chain.twin(rep.token)) : rep.ratio;
      if (ratio && ratio > 0n) return { price: (perToken * WAD) / ratio, source: hybrid ? `chainlink:${u.ticker}/USD on Robinhood Chain mainnet` : `chainlink:${u.ticker}/USD`, updatedAt: cl.updatedAt };
    }
    if (this.chain.isMocks && rep) {
      // mock venue: share price = token price / ratio of the first representation
      const px = await this.chain.mockPrice(rep.token);
      if (px) return { price: (px * WAD) / rep.ratio, source: "mock-venue (labeled fixture)", updatedAt: null };
    }
    return null;
  }

  /**
   * The issuer's asset record and live quote for an underlying. The issuer is keyed by symbol, so the answer is
   * only used when the token it lists on chain 4663 is the one this network trades (or, on a hybrid network,
   * the one its mock stands in for): a symbol that pointed at some other contract is dropped, not shown.
   */
  async issuerView(u: UnderlyingInfo): Promise<IssuerView | null> {
    if (!this.issuer.enabled) return null;
    const [asset, quote] = await Promise.all([this.issuer.asset(u.ticker), this.issuer.quote(u.ticker)]);
    if (!asset?.token) return null;
    const ours = u.representations.map((r) => this.chain.twin(r.token).toLowerCase());
    if (!ours.includes(asset.token.toLowerCase())) {
      log.warn("issuer lists a different token for this symbol; ignoring its record", { ticker: u.ticker, issuer: asset.token });
      return null;
    }
    let q: IssuerView["quote"] = null;
    if (quote && (!quote.token || quote.token.toLowerCase() === asset.token.toLowerCase())) {
      const { symbol: _s, token: _t, ...rest } = quote;
      q = { ...rest, mid: formatWad((parseWad(quote.bid) + parseWad(quote.ask)) / 2n, 4) };
    }
    return { source: "api.robinhood.com/rhj", token: asset.token, status: asset.status, isin: asset.isin, multiplier: asset.multiplier, pendingMultiplier: asset.pendingMultiplier, sessions: asset.sessions, quote: q };
  }

  /**
   * Whether the reference is moving. The schedule is Chainlink's 24/5 one, computed; a trading halt reported by
   * the issuer overrides it, because a halted stock has no live price whatever the clock says.
   */
  async marketStatus(u: UnderlyingInfo): Promise<MarketStatus> {
    if (this.chain.isMocks && !this.chain.isHybrid) return { open: u.marketState.open, nextOpenTime: null, nextCloseTime: null, source: "registry" };
    const quote = await this.issuer.quote(u.ticker).catch(() => null);
    if (quote?.halted) return { open: false, nextOpenTime: null, nextCloseTime: null, source: "issuer", reason: "HALTED" };
    return computedMarketStatus();
  }

  private ethUsd: { at: number; price: bigint } | null = null;

  /**
   * USD per ETH, 1e18-scaled, from the deepest WETH/USDG pool: this network's, or mainnet's when execution here
   * is mocked. Cached for a minute; null when no pool answers.
   */
  private async ethUsdPrice(): Promise<bigint | null> {
    if (this.ethUsd && Date.now() - this.ethUsd.at < 60_000) return this.ethUsd.price;
    const price = await this.venues.ethUsd();
    if (!price) return null;
    this.ethUsd = { at: Date.now(), price };
    return price;
  }

  /** What the transaction costs in USD (1e18-scaled) at the current gas price, for `legs` swap legs. */
  async gasUsd(legs = 1): Promise<bigint> {
    try {
      // Robinhood Chain orders first come, first served: there is no priority fee, so the base fee is the price.
      // A local anvil adds a suggested tip to eth_gasPrice that the real chain would never charge.
      const gasPrice = (await this.chain.client.getBlock()).baseFeePerGas ?? (await this.chain.client.getGasPrice());
      const units = 150_000n + 120_000n * BigInt(legs);
      // A mock chain on its own snapshot has no ETH market: $3,000 is a round placeholder that only ever prices
      // mock gas there. A hybrid one prices this network's gas at mainnet's live ETH price.
      const ethUsd = this.chain.isMocks && !this.chain.isHybrid ? 3_000n * WAD : await this.ethUsdPrice();
      return ethUsd ? (gasPrice * units * ethUsd) / WAD : 0n;
    } catch {
      return 0n;
    }
  }

  async walletHoldings(u: UnderlyingInfo, wallet?: Address): Promise<Map<string, bigint> | undefined> {
    if (!wallet) return undefined;
    const m = new Map<string, bigint>();
    for (const r of u.representations) {
      const bal = await this.chain.balanceOf(r.token, wallet);
      m.set(r.token.toLowerCase(), sharesForTokens(bal, r.ratio));
    }
    return m;
  }

  // ------------------------------------------------------------------
  // Single stock buy / sell
  // ------------------------------------------------------------------

  async resolveBuy(p: { ticker: string; usdAmount: string; policy?: Partial<Policy>; wallet?: string; recipient?: string }): Promise<ResolveResult> {
    const policy = PolicySchema.parse(p.policy ?? {});
    const u = await this.underlyingByTicker(p.ticker);
    const usdgIn = parseUsdg(p.usdAmount);
    if (usdgIn <= 0n) throw new Error("usdAmount must be at least one millionth of a USDG");
    const wallet = p.wallet && isAddress(p.wallet) ? getAddress(p.wallet) : undefined;
    const recipient = p.recipient && isAddress(p.recipient) ? getAddress(p.recipient) : wallet;
    const [ref, market, limits, gasUsd, holdings, fee] = await Promise.all([
      this.referencePrice(u), this.marketStatus(u), this.chain.limits(), this.gasUsd(2), this.walletHoldings(u, wallet), this.chain.fee(),
    ]);
    const now = await this.chain.now();
    /*
     * The registry decides how stale an attestation may be, and the policy may only tighten that. Before this,
     * the policy carried its own default of 36 hours, so raising the registry's window left every representation
     * blocked by a number nobody had asked for and the two could drift apart silently.
     */
    if (p.policy?.maxAttestationAgeHours === undefined && attestationRequired(limits)) policy.maxAttestationAgeHours = limits.maxAttestationAge / 3600;
    const { candidates, chosen } = await scoreBuy(this.venues, {
      underlying: u, usdgIn, policy, referencePrice: ref?.price ?? null, market, limits, usdg: this.chain.d.usdg,
      executor: this.chain.d.router, gasUsd, walletHoldings: holdings, now,
    });

    let status: ResolveResult["status"] = chosen ? "ok" : "no_route";
    if (!market.open && !policy.allowClosedMarket && chosen) status = "queued_until_open";

    const record = {
      underlying: u.ticker,
      side: "buy" as const,
      usdAmount: formatUsdg(usdgIn),
      timestamp: now,
      referencePrice: ref ? formatWad(ref.price, 6) : "0",
      referenceSource: ref?.source ?? "unavailable",
      marketOpen: market.open,
      marketSource: market.source,
      nextOpenTime: market.nextOpenTime,
      candidates: candidates.map(stripCandidate),
      chosen: chosen
        ? { legs: serializeLegs(chosen.legs), sharesOut: chosen.sharesOut.toString(), minShares: chosen.minShares.toString(), usdgIn: chosen.usdgIn.toString(), split: chosen.split, why: chosen.why }
        : null,
      // the protocol fee is charged on the notional spent, on top of it; the router pulls usdgIn + fee and refunds the unspent rest
      fee: { bps: fee.bps, usdg: chosen ? feeOn(chosen.usdgIn, fee.bps).toString() : "0", totalUsdgIn: chosen ? (chosen.usdgIn + feeOn(chosen.usdgIn, fee.bps)).toString() : "0", recipient: fee.recipient, onInKindRedeem: false },
      status,
      policy,
      dataSource: this.dataSource,
      executable: !this.chain.isQuoteOnly,
      gasUsd: formatWad(gasUsd, 6),
      chainId: this.chain.cfg.CHAIN_ID,
      router: this.chain.d.router,
      recipient: recipient ?? null,
    };
    const quoteHash = quoteHashOf(record);

    let tx: ResolveResult["tx"] = null;
    let simulation: ResolveResult["simulation"] = null;
    if (chosen && status === "ok" && recipient && !this.chain.isQuoteOnly) {
      const totalIn = chosen.usdgIn + feeOn(chosen.usdgIn, fee.bps);
      const data = encodeFunctionData({
        abi: ShareRouterAbi,
        functionName: "buyShares",
        args: [u.id, totalIn, chosen.minShares, chosen.legs, recipient, quoteHash],
      });
      tx = { to: this.chain.d.router, data, value: "0", from: wallet, chainId: this.chain.cfg.CHAIN_ID };
      if (wallet) {
        const s = await this.sim.simulate({ from: wallet, to: this.chain.d.router, data, usdgSpender: this.chain.d.router, usdgAmount: totalIn });
        simulation = { ok: s.ok, gasUsed: s.gasUsed, error: s.error };
        (record as Record<string, unknown>).approvalNeeded = s.approvalNeeded;
        if (s.gasUsed) tx.gas = ((BigInt(s.gasUsed) * 12n) / 10n).toString();
        if (!s.ok) {
          log.warn("simulation failed; withholding tx", { ticker: u.ticker, error: s.error });
          tx = null;
        }
      }
    }
    const out = { ...record, tx, simulation, quoteHash } as ResolveResult & Record<string, unknown>;
    this.db.putQuote(quoteHash, "buy", JSON.stringify(out), { underlying: u.ticker });
    return out;
  }

  async resolveSell(p: { ticker: string; representation?: string; tokenAmount?: string; usdAmount?: string; policy?: Partial<Policy>; wallet?: string; recipient?: string }) {
    const policy = PolicySchema.parse(p.policy ?? {});
    const u = await this.underlyingByTicker(p.ticker);
    const wallet = p.wallet && isAddress(p.wallet) ? getAddress(p.wallet) : undefined;
    const recipient = p.recipient && isAddress(p.recipient) ? getAddress(p.recipient) : wallet;
    const ref = await this.referencePrice(u);
    const now = await this.chain.now();

    // Which representations to consider: the one given, else everything the wallet holds.
    let reps = u.representations.filter((r) => r.sellEligible);
    if (p.representation) reps = reps.filter((r) => r.token.toLowerCase() === p.representation!.toLowerCase());
    const results = [];
    for (const rep of reps) {
      let amount: bigint;
      if (p.tokenAmount) amount = parseWad(p.tokenAmount);
      else if (wallet) amount = await this.chain.balanceOf(rep.token, wallet);
      else throw new Error("tokenAmount or wallet is required for a sell");
      if (p.usdAmount && ref) {
        // convert desired USD to tokens at reference price
        const shares = (parseWad(p.usdAmount) * WAD) / ref.price;
        const tokens = (shares * WAD) / rep.ratio;
        amount = tokens < amount || !wallet ? tokens : amount;
      }
      if (amount <= 0n) continue;
      const s = await scoreSell(this.venues, { usdg: this.chain.d.usdg, executor: this.chain.d.router, policy, rep, tokenAmount: amount, referencePrice: ref?.price ?? null });
      results.push({ rep, amount, s });
    }
    const viable = results.filter((r) => r.s).sort((a, b) => (a.s!.usdPerShare > b.s!.usdPerShare ? -1 : 1));
    const best = viable[0];
    // the fee comes out of the USDG received; the onchain minimum is net of it
    const fee = await this.chain.fee();
    const net = (gross: bigint) => gross - feeOn(gross, fee.bps);
    const record = {
      underlying: u.ticker,
      side: "sell" as const,
      fee: { bps: fee.bps, usdg: best ? feeOn(best.s!.usdgOut, fee.bps).toString() : "0", netUsdgOut: best ? net(best.s!.usdgOut).toString() : "0", recipient: fee.recipient, onInKindRedeem: false },
      timestamp: now,
      referencePrice: ref ? formatWad(ref.price, 6) : "0",
      referenceSource: ref?.source ?? "unavailable",
      candidates: results.map((r) => ({
        platform: r.rep.platform, token: r.rep.token, symbol: r.rep.symbol, ratio: r.rep.ratio.toString(), tokenAmount: r.amount.toString(),
        venue: r.s?.quote.venue ?? "none", usdgOut: r.s?.usdgOut.toString() ?? "0", shares: r.s?.shares.toString() ?? "0",
        usdPerShare: r.s ? formatWad(r.s.usdPerShare, 6) : "0", premiumBps: r.s?.premiumBps ?? 0, eligible: Boolean(r.s),
        reasons: r.s ? [] : ["no pool can fill this size"],
      })),
      chosen: best
        ? { representation: best.rep.token, tokenAmount: best.amount.toString(), usdgOut: net(best.s!.usdgOut).toString(), minUsdgOut: net(best.s!.minUsdgOut).toString(), legs: serializeLegs(best.s!.legs), why: `${best.rep.symbol} via ${best.s!.quote.venue}: ${formatWad(best.s!.usdPerShare, 4)} USD/share (${best.s!.premiumBps} bps vs reference)` }
        : null,
      status: best ? ("ok" as const) : ("no_route" as const),
      policy,
      dataSource: this.dataSource,
      executable: !this.chain.isQuoteOnly,
      chainId: this.chain.cfg.CHAIN_ID,
      router: this.chain.d.router,
      recipient: recipient ?? null,
    };
    const quoteHash = quoteHashOf(record);
    let tx: ResolveResult["tx"] = null;
    let simulation: ResolveResult["simulation"] = null;
    if (best && recipient) {
      const data = encodeFunctionData({
        abi: ShareRouterAbi, functionName: "sellShares",
        args: [u.id, best.rep.token, best.amount, net(best.s!.minUsdgOut), best.s!.legs, recipient, quoteHash],
      });
      tx = { to: this.chain.d.router, data, value: "0", from: wallet, chainId: this.chain.cfg.CHAIN_ID };
      if (wallet) {
        const s = await this.sim.simulate({ from: wallet, to: this.chain.d.router, data });
        simulation = { ok: s.ok, gasUsed: s.gasUsed, error: s.error };
        if (!s.ok) tx = null;
      }
    }
    const out = { ...record, tx, simulation, quoteHash };
    this.db.putQuote(quoteHash, "sell", JSON.stringify(out), { underlying: u.ticker });
    return out;
  }

  // ------------------------------------------------------------------
  // Stocks list
  // ------------------------------------------------------------------

  async stocks(query?: string) {
    const all = await this.chain.allUnderlyings();
    const brands = this.chain.catalogue.brands();
    const q = query?.trim().toUpperCase();
    const list = q ? all.filter((u) => u.ticker.includes(q) || u.representations.some((r) => r.symbol.toUpperCase().includes(q))) : all;
    const out = [];
    for (const u of list) {
      const [ref, market, issuer] = await Promise.all([this.referencePrice(u), this.marketStatus(u), this.issuerView(u).catch(() => null)]);
      const reps = await Promise.all(u.representations.map(async (r) => {
        const depth = await this.venues.depth(r.token).catch(() => ({ usdg: 0n, tiers: [] as number[], bestFee: null }));
        return {
          token: r.token, symbol: r.symbol, platform: r.platform, ratio: r.ratio.toString(), ratioSource: r.ratioSource, ratioUpdatedAt: r.ratioUpdatedAt,
          pendingMultiplier: r.pendingMultiplier ? { multiplier: r.pendingMultiplier.multiplier.toString(), effectiveAt: r.pendingMultiplier.effectiveAt } : null,
          attestedAt: r.attestedAt, buyEligible: r.buyEligible, sellEligible: r.sellEligible, active: r.active,
          // USDG in this token's direct pools, and which fee tiers hold it
          poolUsdg: depth.usdg.toString(), poolFees: depth.tiers,
        };
      }));
      const brand = brands.get(u.ticker.toUpperCase()) ?? null;
      out.push({
        ticker: u.ticker, id: u.id, active: u.active, name: brand?.name ?? null, logoUrl: brand?.logoUrl ?? null,
        referencePrice: ref ? formatWad(ref.price, 4) : null, referenceSource: ref?.source ?? "unavailable", referenceUpdatedAt: ref?.updatedAt ?? null,
        market, issuer, representations: reps,
      });
    }
    return { dataSource: this.dataSource, stocks: out };
  }
}

function stripCandidate(c: ScoredCandidate) {
  const { quote: _q, sharesOutBig: _s, tokensOutBig: _t, rep: _r, ...rest } = c;
  return rest;
}
