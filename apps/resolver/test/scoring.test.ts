import { describe, it, expect } from "vitest";
import { WAD, PolicySchema, tickerToId } from "@parallax-hood/sdk";
import { scoreBuy, reasonsForRegistry } from "../src/scoring.js";
import type { RepresentationInfo, UnderlyingInfo } from "../src/chain.js";
import type { Venues, VenueQuote } from "../src/providers/venues.js";

const USDT = "0x55d398326f99059fF775485246999027B3197955" as const;
const NVDAB = "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436" as const;
const NVDAON = "0xA9eE28C80f960B889dFbd1902055218cBa016F75" as const;
const ROUTER = "0x1000000000000000000000000000000000000001" as const;
const now = 1_800_000_000;

function rep(over: Partial<RepresentationInfo>): RepresentationInfo {
  return {
    token: NVDAB, underlyingId: tickerToId("NVDA"), ticker: "NVDA", platformId: tickerToId("bstock"), platform: "bstock", symbol: "NVDAB", decimals: 18,
    ratioSource: "ERC8056", active: true, ratio: 1000778000000000000n, ratioUpdatedAt: now, pendingMultiplier: null, attestedAt: now - 3600, buyEligible: true, sellEligible: true,
    ...over,
  };
}
const bstock = rep({});
const ondo = rep({ token: NVDAON, platformId: tickerToId("ondo"), platform: "ondo", symbol: "NVDAon", ratioSource: "KEEPER", ratio: 1003700000000000000n, attestedAt: now - 7200 });
const underlying: UnderlyingInfo = { id: tickerToId("NVDA"), ticker: "NVDA", active: true, marketState: { open: true, updatedAt: now }, representations: [bstock, ondo] };

/** Fake venue: linear price per token with optional size impact per token. */
function fakeVenues(prices: Record<string, { usdPerToken: number; impactBpsPerK?: number; missing?: boolean }>): Venues {
  const quote = async (tokenIn: string, tokenOut: string, amountIn: bigint): Promise<VenueQuote | null> => {
    const tok = tokenOut.toLowerCase() === USDT.toLowerCase() ? tokenIn : tokenOut;
    const p = prices[tok.toLowerCase()];
    if (!p || p.missing) return null;
    const usd = Number(amountIn) / 1e18;
    const impact = 1 + ((p.impactBpsPerK ?? 0) * (usd / 1000)) / 10_000;
    const out = tokenOut.toLowerCase() === USDT.toLowerCase() ? usd * p.usdPerToken / impact : usd / (p.usdPerToken * impact);
    return { venue: "fake", amountIn, amountOut: BigInt(Math.floor(out * 1e18)), fee: 500 };
  };
  return {
    bestExactInput: quote,
    marginalOut: async (a: string, b: string, probe: bigint) => (await quote(a, b, probe))?.amountOut ?? null,
    exactInputLeg: (q: VenueQuote, tokenIn: `0x${string}`, tokenOut: `0x${string}`, minOut: bigint, recipient: `0x${string}`) => ({ target: ROUTER, data: "0x" as const, tokenIn, maxIn: q.amountIn, tokenOut }),
  } as unknown as Venues;
}

const base = (over: Partial<Parameters<typeof scoreBuy>[1]> = {}) => ({
  underlying, usdtIn: 100n * WAD, policy: PolicySchema.parse({}), referencePrice: 219n * WAD, market: { open: true, nextOpenTime: null, nextCloseTime: null, source: "computed" as const },
  limits: { maxAttestationAge: 36 * 3600, maxRatioAge: 12 * 3600, buysPaused: false }, usdt: USDT, executor: ROUTER, gasUsd: 0n, now, ...over,
});

describe("scoreBuy", () => {
  it("ranks by shares per dollar (cost per share), not token price", async () => {
    // NVDAon token is pricier but carries more shares per token; make it slightly cheaper per share
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 219.5 }, [NVDAON.toLowerCase()]: { usdPerToken: 219.6 } });
    const { candidates, chosen } = await scoreBuy(v, base());
    expect(candidates[0]!.symbol).toBe("NVDAon"); // 219.6/1.0037 = 218.79 per share < 219.5/1.000778 = 219.33
    expect(candidates[0]!.premiumBps).toBeLessThan(candidates[1]!.premiumBps);
    expect(chosen!.split[0]!.token).toBe(NVDAON);
    expect(chosen!.minShares).toBe((chosen!.sharesOut * 9950n) / 10_000n);
    expect(chosen!.why).toContain("NVDAon");
  });

  it("excludes stale attestation / keeper ratio via registry flags and explains why", async () => {
    const stale = rep({ token: NVDAON, platform: "ondo", symbol: "NVDAon", ratioSource: "KEEPER", ratioUpdatedAt: now - 13 * 3600, buyEligible: false });
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 219.5 }, [NVDAON.toLowerCase()]: { usdPerToken: 200 } });
    const { candidates, chosen } = await scoreBuy(v, base({ underlying: { ...underlying, representations: [bstock, stale] } }));
    const on = candidates.find((c) => c.symbol === "NVDAon")!;
    expect(on.eligible).toBe(false);
    expect(on.reasons.join(" ")).toMatch(/keeper ratio stale/);
    expect(chosen!.split[0]!.token).toBe(NVDAB);
  });

  it("applies policy: premium cap, slippage cap, platform exclusion, attestation age", async () => {
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 221, impactBpsPerK: 600 }, [NVDAON.toLowerCase()]: { usdPerToken: 219 } });
    let r = await scoreBuy(v, base({ policy: PolicySchema.parse({ maxPremiumBps: 50 }) }));
    expect(r.candidates.find((c) => c.symbol === "NVDAB")!.reasons.join(" ")).toMatch(/premium .* bps > policy max 50/);
    r = await scoreBuy(v, base({ usdtIn: 10_000n * WAD, policy: PolicySchema.parse({ maxSlippageBps: 10, maxPremiumBps: 10_000 }) }));
    expect(r.candidates.find((c) => c.symbol === "NVDAB")!.reasons.join(" ")).toMatch(/slippage/);
    r = await scoreBuy(v, base({ policy: PolicySchema.parse({ excludePlatforms: ["ondo"] }) }));
    expect(r.candidates.find((c) => c.symbol === "NVDAon")!.reasons.join(" ")).toMatch(/excluded by policy/);
    r = await scoreBuy(v, base({ policy: PolicySchema.parse({ maxAttestationAgeHours: 1.5 }) }));
    expect(r.candidates.find((c) => c.symbol === "NVDAon")!.reasons.join(" ")).toMatch(/older than policy max 1.5h/);
  });

  it("uses the closed-market premium cap when the market is closed", async () => {
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 220.5 }, [NVDAON.toLowerCase()]: { usdPerToken: 220.5 } });
    const r = await scoreBuy(v, base({ market: { open: false, nextOpenTime: 1, nextCloseTime: null, source: "computed" }, policy: PolicySchema.parse({ maxPremiumBps: 200, maxClosedMarketPremiumBps: 20 }) }));
    expect(r.candidates.every((c) => c.reasons.some((x) => x.includes("market closed")))).toBe(true);
    expect(r.chosen).toBeNull();
  });

  it("reports missing liquidity honestly", async () => {
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 219.5 }, [NVDAON.toLowerCase()]: { usdPerToken: 0, missing: true } });
    const r = await scoreBuy(v, base());
    expect(r.candidates.find((c) => c.symbol === "NVDAon")!.reasons[0]).toMatch(/no contract-executable AMM liquidity/);
    expect(r.chosen!.legs.length).toBe(1);
  });

  it("splits across two representations when single-route slippage is high", async () => {
    // both routes have heavy size impact; a 50/50 split yields more shares
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 219.3, impactBpsPerK: 100 }, [NVDAON.toLowerCase()]: { usdPerToken: 220.0, impactBpsPerK: 100 } });
    const r = await scoreBuy(v, base({ usdtIn: 5_000n * WAD, policy: PolicySchema.parse({ maxSlippageBps: 1000, maxPremiumBps: 1000 }) }));
    expect(r.chosen!.legs.length).toBe(2);
    expect(r.chosen!.split.length).toBe(2);
    expect(r.chosen!.why).toMatch(/split/);
    const single = r.candidates[0]!;
    expect(r.chosen!.sharesOut > BigInt(single.sharesOut)).toBe(true);
  });

  it("issuer cap on wallet holdings", async () => {
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 219.5 }, [NVDAON.toLowerCase()]: { usdPerToken: 219.6 } });
    const holdings = new Map([[NVDAB.toLowerCase(), 10n * WAD]]); // already 10 shares with bstock
    const r = await scoreBuy(v, base({ policy: PolicySchema.parse({ maxIssuerBps: 5000 }), walletHoldings: holdings }));
    expect(r.candidates.find((c) => c.symbol === "NVDAB")!.reasons.join(" ")).toMatch(/would put .* bps of your NVDA with bstock/);
    expect(r.candidates.find((c) => c.symbol === "NVDAon")!.eligible).toBe(true);
  });

  it("preferPlatforms breaks near-ties", async () => {
    const v = fakeVenues({ [NVDAB.toLowerCase()]: { usdPerToken: 219.500 }, [NVDAON.toLowerCase()]: { usdPerToken: 220.16 } }); // ondo ~3 bps worse per share
    const r = await scoreBuy(v, base({ policy: PolicySchema.parse({ preferPlatforms: ["ondo"] }) }));
    expect(r.candidates[0]!.symbol).toBe("NVDAon");
  });
});

describe("reasonsForRegistry", () => {
  it("lists every freshness problem", () => {
    const r = reasonsForRegistry(rep({ active: false, attestedAt: 0 }), { maxAttestationAge: 3600, maxRatioAge: 3600, buysPaused: true }, now);
    expect(r).toEqual(expect.arrayContaining([expect.stringMatching(/deprecated/), expect.stringMatching(/paused/), expect.stringMatching(/no attestation/)]));
  });
});
