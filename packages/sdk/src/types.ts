import { z } from "zod";

/** Shared wire types between resolver, MCP and web. Amounts are decimal strings (1e18 units unless noted). */

export const PlatformSchema = z.enum(["ondo", "bstock", "xstock"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const PolicySchema = z.object({
  maxAttestationAgeHours: z.number().positive().default(36),
  maxPremiumBps: z.number().int().default(100),
  maxClosedMarketPremiumBps: z.number().int().default(50),
  maxSlippageBps: z.number().int().min(0).max(10_000).default(50),
  maxIssuerBps: z.number().int().min(0).max(10_000).default(10_000),
  preferPlatforms: z.array(PlatformSchema).default([]),
  excludePlatforms: z.array(PlatformSchema).default([]),
  allowClosedMarket: z.boolean().default(false),
  contractExecutable: z.boolean().default(true), // require legs a contract can execute (AMM), not RFQ
});
export type Policy = z.infer<typeof PolicySchema>;

export const CandidateSchema = z.object({
  platform: PlatformSchema,
  token: z.string(),
  symbol: z.string(),
  ratio: z.string(), // 1e18
  ratioSource: z.enum(["KEEPER", "ERC8056"]),
  venue: z.string(), // e.g. "pancake-v3:500", "binance-rfq"
  tokensOut: z.string(),
  sharesOut: z.string(),
  effectiveCostUsd: z.string(), // decimal USD, 18-dec string
  costPerShareUsd: z.string(),
  premiumBps: z.number(), // effective (incl. gas) vs reference
  pricePremiumBps: z.number().default(0), // ex-gas
  slippageBps: z.number(),
  priceImpactBps: z.number(),
  attestationAgeHours: z.number().nullable(),
  marketOpen: z.boolean(),
  registryEligible: z.boolean(),
  eligible: z.boolean(),
  reasons: z.array(z.string()),
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const LegWireSchema = z.object({
  target: z.string(),
  data: z.string(),
  tokenIn: z.string(),
  maxIn: z.string(),
  tokenOut: z.string(),
});

export const TxWireSchema = z.object({
  to: z.string(),
  data: z.string(),
  value: z.string().default("0"),
  from: z.string().optional(),
  gas: z.string().optional(),
  chainId: z.number(),
});
export type TxWire = z.infer<typeof TxWireSchema>;

export const ResolveResultSchema = z.object({
  underlying: z.string(),
  side: z.enum(["buy", "sell"]),
  usdAmount: z.string(),
  timestamp: z.number(),
  referencePrice: z.string(),
  referenceSource: z.string(),
  marketOpen: z.boolean(),
  nextOpenTime: z.number().nullable(),
  candidates: z.array(CandidateSchema),
  chosen: z
    .object({
      legs: z.array(LegWireSchema),
      sharesOut: z.string(),
      minShares: z.string(),
      usdtIn: z.string(),
      split: z.array(z.object({ token: z.string(), bps: z.number() })),
      why: z.string(),
    })
    .nullable(),
  status: z.enum(["ok", "queued_until_open", "no_route"]),
  policy: PolicySchema,
  dataSource: z.enum(["live", "fixture"]),
  tx: TxWireSchema.nullable(),
  simulation: z.object({ ok: z.boolean(), gasUsed: z.string().optional(), error: z.string().optional() }).nullable(),
  quoteHash: z.string(),
});
export type ResolveResult = z.infer<typeof ResolveResultSchema>;
