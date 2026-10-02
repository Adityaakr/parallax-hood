import type { Address } from "viem";
import { WAD, USDG_UNIT, applySlippage, formatWad, premiumBps, sharesForTokens, usdgToWad, type Leg, type Candidate, type Policy } from "@parallax-hood/sdk";
import type { RepresentationInfo, UnderlyingInfo } from "./chain.js";
import type { Venues, VenueQuote } from "./providers/venues.js";
import type { MarketStatus } from "./providers/marketHours.js";

export type ScoringContext = {
  underlying: UnderlyingInfo;
  usdgIn: bigint; // raw USDG, 6 decimals
  policy: Policy;
  referencePrice: bigint | null; // 1e18 USD per share
  market: MarketStatus;
  limits: { maxAttestationAge: number; maxRatioAge: number; buysPaused: boolean };
  usdg: Address;
  executor: Address; // contract that will execute the legs (router or vault): leg recipient
  gasUsd: bigint; // 1e18, estimated for the whole tx
  walletHoldings?: Map<string, bigint>; // token -> shares held by the wallet (for issuer cap on resulting holdings)
  now?: number;
};

export type ScoredCandidate = Candidate & {
  quote: VenueQuote | null;
  sharesOutBig: bigint;
  tokensOutBig: bigint;
  rep: RepresentationInfo;
};

export type Chosen = {
  legs: Leg[];
  sharesOut: bigint;
  minShares: bigint;
  usdgIn: bigint;
  split: Array<{ token: Address; bps: number }>;
  why: string;
};

const SPLIT_THRESHOLD_BPS = 20;
/* Ten times the reference price. Nothing above this is a price; it is a venue that failed to fill. */
const IMPLAUSIBLE_PREMIUM_BPS = 100_000;
const SPLITS = [9000, 8000, 7000, 6000, 5000, 4000, 3000, 2000, 1000];

export function reasonsForRegistry(rep: RepresentationInfo, limits: ScoringContext["limits"], now: number): string[] {
  const r: string[] = [];
  if (!rep.active) r.push("representation deprecated in registry");
  if (limits.buysPaused) r.push("buys paused by guardian");
  // Robinhood publishes no attestation a contract can read, so the registry here runs with that gate off
  // (an unbounded window). The check stays for any platform a registry does require one from.
  if (attestationRequired(limits)) {
    const attAge = now - rep.attestedAt;
    if (rep.attestedAt === 0) r.push("no attestation posted for platform");
    else if (attAge > limits.maxAttestationAge) r.push(`attestation stale (${(attAge / 3600).toFixed(1)}h > ${limits.maxAttestationAge / 3600}h)`);
  }
  if (rep.ratioSource === "KEEPER" && now - rep.ratioUpdatedAt > limits.maxRatioAge) {
    r.push(`keeper ratio stale (${((now - rep.ratioUpdatedAt) / 3600).toFixed(1)}h > ${limits.maxRatioAge / 3600}h)`);
  }
  if (rep.ratioSource === "ERC8056" && !rep.buyEligible && r.length === 0) r.push("multiplier moved beyond step bound (corporate action?); awaiting admin confirmation");
  return r;
}

/** A registry whose attestation window is a century or more has the gate switched off. */
export function attestationRequired(limits: { maxAttestationAge: number }): boolean {
  return limits.maxAttestationAge < 100 * 365 * 86_400;
}

async function quoteCandidate(v: Venues, ctx: ScoringContext, rep: RepresentationInfo, usdgIn: bigint): Promise<ScoredCandidate> {
  const now = ctx.now ?? Math.floor(Date.now() / 1000);
  const reasons = reasonsForRegistry(rep, ctx.limits, now);
  const registryEligible = rep.buyEligible;
  const needsAttestation = attestationRequired(ctx.limits);
  // no age is reported where the registry does not ask for an attestation: there is nothing it would be the age of
  const attestationAgeHours = !needsAttestation || rep.attestedAt === 0 ? null : (now - rep.attestedAt) / 3600;

  const base: Omit<ScoredCandidate, "quote" | "sharesOutBig" | "tokensOutBig"> = {
    platform: rep.platform as Candidate["platform"],
    token: rep.token,
    symbol: rep.symbol,
    ratio: rep.ratio.toString(),
    ratioSource: rep.ratioSource,
    venue: "none",
    tokensOut: "0",
    sharesOut: "0",
    effectiveCostUsd: formatWad(usdgToWad(usdgIn) + ctx.gasUsd, 6),
    costPerShareUsd: "0",
    premiumBps: 0,
    pricePremiumBps: 0,
    slippageBps: 0,
    priceImpactBps: 0,
    attestationAgeHours,
    marketOpen: ctx.market.open,
    registryEligible,
    eligible: false,
    reasons,
    rep,
  };

  // policy: platform exclusion
  if (ctx.policy.excludePlatforms.includes(base.platform)) reasons.push(`platform ${base.platform} excluded by policy`);
  // policy: attestation age
  if (needsAttestation) {
    if (attestationAgeHours !== null && attestationAgeHours > ctx.policy.maxAttestationAgeHours) {
      reasons.push(`attestation ${attestationAgeHours.toFixed(1)}h older than policy max ${ctx.policy.maxAttestationAgeHours}h`);
    }
    if (attestationAgeHours === null && !reasons.some((r) => r.includes("attestation"))) reasons.push("attestation age unknown");
  }

  const q = await v.bestExactInput(ctx.usdg, rep.token, usdgIn);
  if (!q) {
    reasons.push("no pool can fill this size");
    return { ...base, quote: null, sharesOutBig: 0n, tokensOutBig: 0n };
  }
  const shares = sharesForTokens(q.amountOut, rep.ratio);
  if (shares === 0n) {
    reasons.push("quote returned zero shares");
    return { ...base, quote: q, sharesOutBig: 0n, tokensOutBig: q.amountOut, venue: q.venue };
  }
  const usdIn = usdgToWad(usdgIn); // USDG at $1, in the 1e18 scale prices use
  const costPerShare = ((usdIn + ctx.gasUsd) * WAD) / shares; // effective, includes gas (spec)
  const prem = ctx.referencePrice ? premiumBps(costPerShare, ctx.referencePrice) : 0;
  const pricePrem = ctx.referencePrice ? premiumBps((usdIn * WAD) / shares, ctx.referencePrice) : 0; // ex-gas, for display

  // slippage vs marginal price: probe the same route with 0.1 % of size (min 1 USDG)
  const probe = usdgIn / 1000n > USDG_UNIT ? usdgIn / 1000n : USDG_UNIT;
  const mOut = probe >= usdgIn ? null : await v.marginalOut(ctx.usdg, rep.token, probe, q.route);
  let slippage = 0;
  if (mOut && mOut > 0n) {
    const expected = (mOut * usdgIn) / probe;
    slippage = expected > q.amountOut ? Number(((expected - q.amountOut) * 10_000n) / expected) : 0;
  }
  if (slippage > ctx.policy.maxSlippageBps) reasons.push(`slippage ${slippage} bps > policy max ${ctx.policy.maxSlippageBps} bps`);
  if (ctx.referencePrice) {
    const cap = ctx.market.open ? ctx.policy.maxPremiumBps : ctx.policy.maxClosedMarketPremiumBps;
    /*
     * A quote that returns dust is a malfunction, not an expensive fill: an order far larger than a thin pool
     * holds walks the whole range and comes back with a sliver, which scores as a premium in the millions of
     * basis points. True, and useless to read. Past ten times the reference it is reported as what it is, and
     * the honest premium is still in the record for anyone who wants it.
     */
    if (prem > IMPLAUSIBLE_PREMIUM_BPS) {
      reasons.push(`venue returned an implausible quote: ${formatWad(costPerShare, 2)} per share against a ${formatWad(ctx.referencePrice ?? 0n, 2)} reference`);
    } else if (prem > cap) {
      reasons.push(`premium ${prem} bps > policy max ${cap} bps (${ctx.market.open ? "market open" : "market closed"})`);
    }
  }
  // issuer cap on the wallet's resulting holdings for this underlying
  if (ctx.walletHoldings && ctx.policy.maxIssuerBps < 10_000) {
    let total = 0n;
    let platformShares = 0n;
    for (const r of ctx.underlying.representations) {
      const h = ctx.walletHoldings.get(r.token.toLowerCase()) ?? 0n;
      total += h;
      if (r.platform === rep.platform) platformShares += h;
    }
    total += shares;
    platformShares += shares;
    const bps = Number((platformShares * 10_000n) / total);
    if (bps > ctx.policy.maxIssuerBps) reasons.push(`would put ${bps} bps of your ${rep.ticker} with ${rep.platform} (policy max ${ctx.policy.maxIssuerBps})`);
  }

  const eligible = registryEligible && reasons.length === 0;
  return {
    ...base,
    venue: q.venue,
    tokensOut: q.amountOut.toString(),
    sharesOut: shares.toString(),
    costPerShareUsd: formatWad(costPerShare, 6),
    premiumBps: prem,
    pricePremiumBps: pricePrem,
    slippageBps: slippage,
    priceImpactBps: slippage,
    eligible,
    quote: q,
    sharesOutBig: shares,
    tokensOutBig: q.amountOut,
  };
}

function rank(cands: ScoredCandidate[], policy: Policy): ScoredCandidate[] {
  const eligible = cands.filter((c) => c.eligible);
  eligible.sort((a, b) => (a.sharesOutBig > b.sharesOutBig ? -1 : a.sharesOutBig < b.sharesOutBig ? 1 : 0));
  // preferred platforms win ties within 10 bps of the best
  if (policy.preferPlatforms.length && eligible.length > 1) {
    const best = eligible[0]!;
    const idx = eligible.findIndex((c) => policy.preferPlatforms.includes(c.platform) && Number(((best.sharesOutBig - c.sharesOutBig) * 10_000n) / best.sharesOutBig) <= 10);
    if (idx > 0) {
      const [p] = eligible.splice(idx, 1);
      eligible.unshift(p!);
    }
  }
  const rest = cands.filter((c) => !c.eligible);
  return [...eligible, ...rest];
}

/** Score every representation of the underlying for a buy of `usdgIn`, then pick the best single or split route. */
export async function scoreBuy(v: Venues, ctx: ScoringContext): Promise<{ candidates: ScoredCandidate[]; chosen: Chosen | null }> {
  const scored = await Promise.all(ctx.underlying.representations.map((rep) => quoteCandidate(v, ctx, rep, ctx.usdgIn)));
  const ranked = rank(scored, ctx.policy);
  const eligible = ranked.filter((c) => c.eligible && c.quote);
  if (eligible.length === 0) return { candidates: ranked, chosen: null };

  const best = eligible[0]!;
  let chosen: Chosen = single(v, ctx, best);

  // Split search when the single route slips more than the threshold and a second eligible route exists.
  if (eligible.length > 1 && best.slippageBps > SPLIT_THRESHOLD_BPS) {
    const second = eligible[1]!;
    let bestShares = best.sharesOutBig;
    for (const bps of SPLITS) {
      const a = (ctx.usdgIn * BigInt(bps)) / 10_000n;
      const b = ctx.usdgIn - a;
      const [qa, qb] = await Promise.all([v.bestExactInput(ctx.usdg, best.rep.token, a), v.bestExactInput(ctx.usdg, second.rep.token, b)]);
      if (!qa || !qb) continue;
      const shares = sharesForTokens(qa.amountOut, best.rep.ratio) + sharesForTokens(qb.amountOut, second.rep.ratio);
      if (shares > bestShares) {
        bestShares = shares;
        const legs = [
          v.exactInputLeg(qa, ctx.usdg, best.rep.token, applySlippage(qa.amountOut, ctx.policy.maxSlippageBps), ctx.executor),
          v.exactInputLeg(qb, ctx.usdg, second.rep.token, applySlippage(qb.amountOut, ctx.policy.maxSlippageBps), ctx.executor),
        ];
        chosen = {
          legs,
          sharesOut: shares,
          minShares: applySlippage(shares, ctx.policy.maxSlippageBps),
          usdgIn: ctx.usdgIn,
          split: [
            { token: best.rep.token, bps },
            { token: second.rep.token, bps: 10_000 - bps },
          ],
          why: `${bps / 100}/${(10_000 - bps) / 100} split across ${best.symbol} and ${second.symbol}: ${formatWad(shares, 6)} shares vs ${formatWad(best.sharesOutBig, 6)} single-route (single-route slippage ${best.slippageBps} bps)`,
        };
      }
    }
  }
  return { candidates: ranked, chosen };
}

function single(v: Venues, ctx: ScoringContext, c: ScoredCandidate): Chosen {
  const q = c.quote!;
  const legs = [v.exactInputLeg(q, ctx.usdg, c.rep.token, applySlippage(q.amountOut, ctx.policy.maxSlippageBps), ctx.executor)];
  const others = ctx.underlying.representations.length - 1;
  const why =
    `${c.symbol} (${c.platform}) via ${c.venue}: ${c.costPerShareUsd} USD/share, ${c.premiumBps >= 0 ? "+" : ""}${c.premiumBps} bps vs reference, ` +
    `slippage ${c.slippageBps} bps, ratio ${formatWad(c.rep.ratio, 6)} (${c.ratioSource})` +
    (others > 0 ? `; ${others} other representation${others > 1 ? "s" : ""} scored lower or excluded` : "");
  return { legs, sharesOut: c.sharesOutBig, minShares: applySlippage(c.sharesOutBig, ctx.policy.maxSlippageBps), usdgIn: ctx.usdgIn, split: [{ token: c.rep.token, bps: 10_000 }], why };
}

/** Sell side: quote token -> USDG for a specific representation and amount. */
export async function scoreSell(v: Venues, ctx: { usdg: Address; executor: Address; policy: Policy; rep: RepresentationInfo; tokenAmount: bigint; referencePrice: bigint | null }) {
  const q = await v.bestExactInput(ctx.rep.token, ctx.usdg, ctx.tokenAmount);
  if (!q) return null;
  const shares = sharesForTokens(ctx.tokenAmount, ctx.rep.ratio);
  const usdPerShare = shares > 0n ? (usdgToWad(q.amountOut) * WAD) / shares : 0n;
  const leg = v.exactInputLeg(q, ctx.rep.token, ctx.usdg, applySlippage(q.amountOut, ctx.policy.maxSlippageBps), ctx.executor);
  return {
    quote: q,
    usdgOut: q.amountOut,
    minUsdgOut: applySlippage(q.amountOut, ctx.policy.maxSlippageBps),
    shares,
    usdPerShare,
    premiumBps: ctx.referencePrice ? premiumBps(usdPerShare, ctx.referencePrice) : 0,
    legs: [leg],
  };
}
