/**
 * Regenerates contracts/script/config/bsc.json from the live Binance Web3 RWA catalogue.
 *
 * The universe is:
 *   - every underlying tokenized by BOTH issuers (where best execution across issuers is the whole point), plus
 *   - every constituent of a curated index, even when only one issuer lists it today.
 *
 * The second rule exists because the catalogue moves: AAPL and AMZN are Ondo-only right now, so a dual-issuer
 * filter alone would silently drop Apple from the Magnificent 7.
 *
 *   BINANCE_WEB3_API_KEY=… BINANCE_WEB3_API_SECRET=… npx tsx scripts/gen-universe.ts [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BinanceWeb3Client } from "@parallax-hood/binance-client";
import { INDICES, unitSharesFor } from "./indices.mjs";

const c = new BinanceWeb3Client({ apiKey: process.env.BINANCE_WEB3_API_KEY!, apiSecret: process.env.BINANCE_WEB3_API_SECRET!, mode: "live" });
const all = await c.rwaTokens({ binanceChainId: "56" });

type Tok = { tokenContractAddress: string; tokenSymbol: string; platformId: string; underlyingTicker: string; underlyingName?: string; tokenToShareRatio?: string | null; tokenPrice?: string | null };
const byUnderlying = new Map<string, Tok[]>();
for (const t of all as unknown as Tok[]) {
  if (!t.underlyingTicker) continue;
  byUnderlying.set(t.underlyingTicker, [...(byUnderlying.get(t.underlyingTicker) ?? []), t]);
}

const issuers = (list: Tok[]) => new Set(list.map((t) => t.platformId)).size;
const indexConstituents = new Set(INDICES.flatMap((i) => i.constituents.map((c) => c.ticker)));
const selected = [...byUnderlying.entries()]
  .filter(([ticker, toks]) => issuers(toks) > 1 || indexConstituents.has(ticker))
  .sort(([a], [b]) => a.localeCompare(b));

const missing = [...indexConstituents].filter((t) => !byUnderlying.has(t));
if (missing.length) throw new Error(`index constituents missing from the catalogue: ${missing.join(", ")}`);

const wad = (r?: string | null) => {
  const [i = "1", f = ""] = String(r ?? "1").split(".");
  return BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
};
const representations = selected.flatMap(([ticker, toks]) =>
  toks
    .filter((t) => t.platformId === "ondo" || t.platformId === "bstock")
    .sort((a, b) => a.platformId.localeCompare(b.platformId))
    .map((t) => ({
      ticker,
      platform: t.platformId,
      symbol: t.tokenSymbol,
      token: t.tokenContractAddress.toLowerCase(),
      // bStocks expose shares-per-token onchain (ERC-8056); Ondo's ratio is API-only, so the keeper posts it
      source: t.platformId === "bstock" ? "ERC8056" : "KEEPER",
      initialRatio: wad(t.tokenToShareRatio).toString(),
    })),
);

// index definitions carry shares per unit, priced from the catalogue at generation time
const priceOf = (ticker: string) => {
  const toks = byUnderlying.get(ticker) ?? [];
  const px = toks.map((t) => Number(t.tokenPrice ?? 0) / Number(t.tokenToShareRatio ?? 1)).filter((n) => n > 0);
  return px.length ? Math.min(...px) : 0;
};
const baskets = INDICES.map((index) => ({
  name: index.name,
  symbol: index.symbol,
  thesis: index.thesis,
  unitValueUsd: index.unitValueUsd,
  constituents: index.constituents.map((c) => ({
    ticker: c.ticker,
    weightBps: c.weightBps,
    sharesPerUnit: unitSharesFor(index.unitValueUsd, c.weightBps, priceOf(c.ticker)).toString(),
    // No hard issuer cap at mint time. The vault enforces the cap whenever two representations are
    // buy-eligible, but "listed by two issuers" is not the same as "routable through two issuers": today most
    // constituents have exactly one issuer with executable liquidity, and a cap would block the mint outright
    // rather than diversify anything. Issuer concentration is managed instead by permissionless migration,
    // which can only ever move shares to a better representation.
    maxIssuerBps: 10000,
  })),
}));

const path = resolve(dirname(fileURLToPath(import.meta.url)), "..", "contracts/script/config/bsc.json");
const cfg = JSON.parse(readFileSync(path, "utf8"));
const dual = selected.filter(([, v]) => issuers(v) > 1).length;
const next = {
  ...cfg, // preserves allowedTargets and its note
  _universe: `${selected.length} underlyings (${dual} tokenized by both Ondo and bStocks, the rest index constituents listed by one), from the Binance Web3 RWA catalogue`,
  underlyings: selected.map(([t]) => t),
  representations,
  // the first basket stays the one the deploy script creates; the rest are created by scripts/create-indices.ts
  basket: { name: baskets[0]!.name, symbol: baskets[0]!.symbol, constituents: baskets[0]!.constituents },
  indices: baskets,
};
console.log(`${selected.length} underlyings (${dual} dual-issuer) · ${representations.length} representations`);
for (const b of baskets) console.log(`  ${b.symbol.padEnd(9)} ${b.constituents.map((x) => `${x.ticker} ${(Number(x.sharesPerUnit) / 1e18).toFixed(4)}sh`).join("  ")}`);
if (process.argv.includes("--write")) {
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  console.log("wrote", path);
} else {
  console.log("dry run; pass --write");
}
