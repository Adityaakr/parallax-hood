import { type Address, type Hex, encodeFunctionData, isAddress, getAddress } from "viem";
import {
  ShareRouterAbi, WAD, parseWad, formatWad, serializeLegs, tickerToId, sharesForTokens, PolicySchema, type Policy, type ResolveResult,
  BSC_ADDRESSES, ChainlinkAggregatorAbi, feeOn } from "@parallax-hood/sdk";
import type { Chain, UnderlyingInfo } from "./chain.js";
import { Venues } from "./providers/venues.js";
import { BinanceProvider } from "./providers/binance.js";
import { PoolOracle } from "./providers/poolOracle.js";
import { MarketHistory } from "./providers/marketHistory.js";
import { computedMarketStatus, type MarketStatus } from "./providers/marketHours.js";
import { scoreBuy, scoreSell, type ScoredCandidate } from "./scoring.js";
import { Simulator } from "./simulate.js";
import { quoteHashOf } from "./quotes.js";
import type { Db } from "./db.js";
import { logger } from "./log.js";

const log = logger("resolve");
const BNB_USD_FEED = "0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE" as Address;

export type ReferencePrice = { price: bigint; source: string; updatedAt: number | null; alt?: { source: string; price: bigint } };

export class Resolver {
  readonly venues: Venues;
  /** Pool-oracle history for the representations Chainlink has no feed for. */
  readonly poolOracle: PoolOracle;
  /** Daily closes of the underlying stock, for the periods no onchain source reaches. */
  readonly marketHistory: MarketHistory;
  readonly sim: Simulator;
  constructor(readonly chain: Chain, readonly binance: BinanceProvider, readonly db: Db) {
    this.venues = new Venues(chain, binance);
    this.poolOracle = new PoolOracle(chain);
    this.marketHistory = new MarketHistory(chain.cfg.MARKET_HISTORY && !chain.isMocks, db, chain.cfg.MARKET_HISTORY_URL);
    this.sim = new Simulator(chain);
  }

  get dataSource(): "live" | "fixture" {
    return this.binance.mode === "fixtures" ? "fixture" : "live";
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

  /** Reference price: Chainlink (onchain, live) first; Binance referencePrice as alternative/fallback; mock venue on mocks. */
  async referencePrice(u: UnderlyingInfo): Promise<ReferencePrice | null> {
    const cl = await this.chain.chainlinkPrice(u.ticker);
    let binancePx: bigint | null = null;
    for (const r of u.representations) {
      const t = await this.binance.token(r.token);
      if (t?.referencePrice) {
        binancePx = parseWad(t.referencePrice);
        break;
      }
    }
    if (cl) {
      const price = (cl.price * WAD) / 10n ** BigInt(cl.decimals);
      return { price, source: `chainlink:${u.ticker}/USD`, updatedAt: cl.updatedAt, alt: binancePx ? { source: "binance:referencePrice", price: binancePx } : undefined };
    }
    if (binancePx) return { price: binancePx, source: "binance:referencePrice", updatedAt: null };
    if (this.chain.isMocks) {
      // mock venue: share price = token price / ratio of the first representation
      const r = u.representations[0];
      if (r) {
        const px = await this.chain.mockPrice(r.token);
        if (px) return { price: (px * WAD) / r.ratio, source: "mock-venue (labeled fixture)", updatedAt: null };
      }
    }
    return null;
  }

  async marketStatus(u: UnderlyingInfo): Promise<MarketStatus> {
    const fromBinance = await this.binance.marketStatus(u.representations.map((r) => r.token));
    if (fromBinance) return fromBinance;
    if (this.chain.isMocks) return { open: u.marketState.open, nextOpenTime: null, nextCloseTime: null, source: "registry" };
    return computedMarketStatus();
  }

  async gasUsd(legs = 1): Promise<bigint> {
    try {
      const gasPrice = await this.chain.client.getGasPrice();
      const units = 150_000n + 120_000n * BigInt(legs);
      if (this.chain.isMocks) return gasPrice * units * 600n; // gas wei * USD/BNB = USD wad; assume BNB = $600 on mocks
      const r = await this.chain.client.readContract({ address: BNB_USD_FEED, abi: ChainlinkAggregatorAbi, functionName: "latestRoundData" });
      const bnbUsd = (r[1] * WAD) / 10n ** 8n; // USD wad per BNB
      return (gasPrice * units * bnbUsd) / WAD; // (wei * USDwad) / 1e18 = USD wad
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
    const usdtIn = parseWad(p.usdAmount);
    if (usdtIn <= 0n) throw new Error("usdAmount must be positive");
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
    if (p.policy?.maxAttestationAgeHours === undefined) policy.maxAttestationAgeHours = limits.maxAttestationAge / 3600;
    const { candidates, chosen } = await scoreBuy(this.venues, {
      underlying: u, usdtIn, policy, referencePrice: ref?.price ?? null, market, limits, usdt: this.chain.d.usdt,
      executor: this.chain.d.router, gasUsd, walletHoldings: holdings, now,
    });

    let status: ResolveResult["status"] = chosen ? "ok" : "no_route";
    if (!market.open && !policy.allowClosedMarket && chosen) status = "queued_until_open";

    // Aggregator legs are priced with a placeholder; fetch the real calldata now, with the executing contract as
    // the taker. A route that cannot be materialised leaves the transaction unbuilt and says why.
    let unroutable: string | null = null;
    if (chosen && status === "ok" && !this.chain.isQuoteOnly) {
      const legs = [...chosen.legs];
      for (let i = 0; i < legs.length && !unroutable; i++) {
        if (legs[i]!.data !== "0x") continue;
        const m = await this.venues.materializeLeg(legs[i]!, this.chain.d.router, BigInt(policy.maxSlippageBps));
        if (m.ok) legs[i] = m.leg;
        else unroutable = m.reason;
      }
      if (!unroutable) chosen.legs = legs;
    }

    const record = {
      underlying: u.ticker,
      side: "buy" as const,
      usdAmount: formatWad(usdtIn, 6),
      timestamp: now,
      referencePrice: ref ? formatWad(ref.price, 6) : "0",
      referenceSource: ref?.source ?? "unavailable",
      marketOpen: market.open,
      marketSource: market.source,
      nextOpenTime: market.nextOpenTime,
      candidates: candidates.map(stripCandidate),
      chosen: chosen
        ? { legs: serializeLegs(chosen.legs), sharesOut: chosen.sharesOut.toString(), minShares: chosen.minShares.toString(), usdtIn: chosen.usdtIn.toString(), split: chosen.split, why: chosen.why }
        : null,
      // the protocol fee is charged on the notional spent, on top of it; the router pulls usdtIn + fee and refunds the unspent rest
      fee: { bps: fee.bps, usdt: chosen ? feeOn(chosen.usdtIn, fee.bps).toString() : "0", totalUsdtIn: chosen ? (chosen.usdtIn + feeOn(chosen.usdtIn, fee.bps)).toString() : "0", recipient: fee.recipient, onInKindRedeem: false },
      status,
      policy,
      dataSource: this.dataSource,
      executable: !this.chain.isQuoteOnly,
      unroutable,
      gasUsd: formatWad(gasUsd, 6),
      chainId: this.chain.cfg.CHAIN_ID,
      router: this.chain.d.router,
      recipient: recipient ?? null,
    };
    const quoteHash = quoteHashOf(record);

    let tx: ResolveResult["tx"] = null;
    let simulation: ResolveResult["simulation"] = null;
    if (chosen && status === "ok" && recipient && !this.chain.isQuoteOnly && !unroutable) {
      const totalIn = chosen.usdtIn + feeOn(chosen.usdtIn, fee.bps);
      const data = encodeFunctionData({
        abi: ShareRouterAbi,
        functionName: "buyShares",
        args: [u.id, totalIn, chosen.minShares, chosen.legs, recipient, quoteHash],
      });
      tx = { to: this.chain.d.router, data, value: "0", from: wallet, chainId: this.chain.cfg.CHAIN_ID };
      if (wallet) {
        const s = await this.sim.simulate({ from: wallet, to: this.chain.d.router, data, usdtSpender: this.chain.d.router, usdtAmount: totalIn });
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
      const s = await scoreSell(this.venues, { usdt: this.chain.d.usdt, executor: this.chain.d.router, policy, rep, tokenAmount: amount, referencePrice: ref?.price ?? null });
      results.push({ rep, amount, s });
    }
    const viable = results.filter((r) => r.s).sort((a, b) => (a.s!.usdPerShare > b.s!.usdPerShare ? -1 : 1));
    const best = viable[0];
    // the fee comes out of the USDT received; the onchain minimum is net of it
    const fee = await this.chain.fee();
    const net = (gross: bigint) => gross - feeOn(gross, fee.bps);
    const record = {
      underlying: u.ticker,
      side: "sell" as const,
      fee: { bps: fee.bps, usdt: best ? feeOn(best.s!.usdtOut, fee.bps).toString() : "0", netUsdtOut: best ? net(best.s!.usdtOut).toString() : "0", recipient: fee.recipient, onInKindRedeem: false },
      timestamp: now,
      referencePrice: ref ? formatWad(ref.price, 6) : "0",
      referenceSource: ref?.source ?? "unavailable",
      candidates: results.map((r) => ({
        platform: r.rep.platform, token: r.rep.token, symbol: r.rep.symbol, ratio: r.rep.ratio.toString(), tokenAmount: r.amount.toString(),
        venue: r.s?.quote.venue ?? "none", usdtOut: r.s?.usdtOut.toString() ?? "0", shares: r.s?.shares.toString() ?? "0",
        usdPerShare: r.s ? formatWad(r.s.usdPerShare, 6) : "0", premiumBps: r.s?.premiumBps ?? 0, eligible: Boolean(r.s),
        reasons: r.s ? [] : ["no contract-executable AMM liquidity"],
      })),
      chosen: best
        ? { representation: best.rep.token, tokenAmount: best.amount.toString(), usdtOut: net(best.s!.usdtOut).toString(), minUsdtOut: net(best.s!.minUsdtOut).toString(), legs: serializeLegs(best.s!.legs), why: `${best.rep.symbol} via ${best.s!.quote.venue}: ${formatWad(best.s!.usdPerShare, 4)} USD/share (${best.s!.premiumBps} bps vs reference)` }
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
        args: [u.id, best.rep.token, best.amount, net(best.s!.minUsdtOut), best.s!.legs, recipient, quoteHash],
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
    const brands = await this.binance.brands();
    const q = query?.trim().toUpperCase();
    const list = q ? all.filter((u) => u.ticker.includes(q) || u.representations.some((r) => r.symbol.toUpperCase().includes(q))) : all;
    const out = [];
    for (const u of list) {
      const [ref, market] = await Promise.all([this.referencePrice(u), this.marketStatus(u)]);
      const reps = [];
      for (const r of u.representations) {
        const b = await this.binance.token(r.token);
        reps.push({
          token: r.token, symbol: r.symbol, platform: r.platform, ratio: r.ratio.toString(), ratioSource: r.ratioSource, ratioUpdatedAt: r.ratioUpdatedAt,
          pendingMultiplier: r.pendingMultiplier ? { multiplier: r.pendingMultiplier.multiplier.toString(), effectiveAt: r.pendingMultiplier.effectiveAt } : null,
          attestedAt: r.attestedAt, buyEligible: r.buyEligible, sellEligible: r.sellEligible, active: r.active,
          binance: b ? { tokenPrice: b.tokenPrice, referencePrice: b.referencePrice, tokenToShareRatio: b.tokenToShareRatio, volume24h: b.volume24h } : null,
        });
      }
      const brand = brands.get(u.ticker.toUpperCase()) ?? null;
      out.push({
        ticker: u.ticker, id: u.id, active: u.active, name: brand?.name ?? null, logoUrl: brand?.logoUrl ?? null,
        referencePrice: ref ? formatWad(ref.price, 4) : null, referenceSource: ref?.source ?? "unavailable", referenceUpdatedAt: ref?.updatedAt ?? null,
        market, representations: reps,
      });
    }
    return { dataSource: this.dataSource, binance: { mode: this.binance.mode, available: this.binance.available }, stocks: out };
  }
}

function stripCandidate(c: ScoredCandidate) {
  const { quote: _q, sharesOutBig: _s, tokensOutBig: _t, rep: _r, ...rest } = c;
  return rest;
}
