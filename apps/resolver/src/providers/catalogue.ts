import { readFileSync, existsSync } from "node:fs";
import { getAddress, type Address } from "viem";
import { z } from "zod";

/**
 * The verified universe: which token is the canonical Robinhood Stock Token for each ticker, which Chainlink
 * feed prices it, and the curated indices. One file, contracts/script/config/robinhood.json, read by the deploy
 * scripts and by this service, so the registry onchain and the catalogue here cannot drift apart. Every address
 * in it carries its source and its on-chain check in docs/addresses.md.
 */
const RepresentationSchema = z.object({
  ticker: z.string(),
  platform: z.string(),
  symbol: z.string(),
  token: z.string().transform((a) => getAddress(a)),
  source: z.enum(["ERC8056", "KEEPER"]),
  initialRatio: z.string(),
});
const IndexSchema = z.object({
  name: z.string(),
  symbol: z.string(),
  thesis: z.string(),
  unitValueUsd: z.number(),
  constituents: z.array(z.object({ ticker: z.string(), weightBps: z.number(), sharesPerUnit: z.string(), maxIssuerBps: z.number().optional(), why: z.string().optional() })),
});
export const UniverseSchema = z.object({
  chainId: z.number(),
  usdg: z.string(),
  allowedTargets: z.array(z.string()).default([]),
  /** ticker → Chainlink feed. On Robinhood Chain a stock feed prices the token, multiplier included. */
  priceFeeds: z.record(z.string()).default({}),
  /** ticker → company name and logo, as the issuer's own asset list gives them. */
  brands: z.record(z.object({ name: z.string().nullable().default(null), logoUrl: z.string().nullable().default(null) })).default({}),
  representations: z.array(RepresentationSchema).default([]),
  indices: z.array(IndexSchema).default([]),
}).passthrough();
export type Universe = z.infer<typeof UniverseSchema>;
export type Brand = { name: string | null; logoUrl: string | null };

const EMPTY: Universe = { chainId: 0, usdg: "", allowedTargets: [], priceFeeds: {}, brands: {}, representations: [], indices: [] };

export class Catalogue {
  readonly universe: Universe;
  /** false when the universe file is missing: every lookup then answers "unknown" rather than a guess. */
  readonly available: boolean;

  constructor(readonly file: string) {
    this.available = existsSync(file);
    this.universe = this.available ? UniverseSchema.parse(JSON.parse(readFileSync(file, "utf8"))) : EMPTY;
  }

  /** Company name and logo per ticker. Keyed by ticker, so the mock tokens on a test network show the real company. */
  brands(): Map<string, Brand> {
    return new Map(Object.entries(this.universe.brands).map(([t, b]) => [t.toUpperCase(), b]));
  }

  brand(ticker: string): Brand | null {
    return this.universe.brands[ticker.toUpperCase()] ?? null;
  }

  /** The Chainlink feed for a ticker, or null when the list has none. */
  feed(ticker: string): Address | null {
    const f = Object.entries(this.universe.priceFeeds).find(([t]) => t.toUpperCase() === ticker.toUpperCase())?.[1];
    return f && f.startsWith("0x") ? getAddress(f) : null;
  }

  /** The mainnet token behind a symbol: what a mock on a test network is twinned with. */
  representation(symbol: string) {
    return this.universe.representations.find((r) => r.symbol === symbol) ?? null;
  }
}
