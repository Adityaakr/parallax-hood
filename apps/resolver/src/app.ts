import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { isAddress } from "viem";
import { PolicySchema, NETWORK_LABEL, ROBINHOOD_ADDRESSES, formatWad, formatUsdg } from "@parallax-hood/sdk";
import type { Config } from "./config.js";
import { Chain } from "./chain.js";
import { Db } from "./db.js";
import { Resolver } from "./resolve.js";
import { Baskets } from "./baskets.js";
import { PriceHistory } from "./history.js";
import { Indexer } from "./indexer.js";
import { faucet } from "./faucet.js";
import { logger } from "./log.js";

const log = logger("http");

/** What a hybrid network is doing, spelled out for every client: prices from mainnet, execution here on mocks. */
export function hybridLabel(cfg: Config) {
  return cfg.hybrid ? { markets: "Robinhood Chain mainnet (Chainlink feeds, Uniswap v3 pool depth)", execution: `${cfg.chain.name} (mock stock tokens, mock USDG and a mock venue priced from mainnet at deploy time)` } : null;
}

/** Which network this is and what on it is a stand-in. Sent with every listing so no screen has to guess. */
export function networkLabel(cfg: Config, chain: Chain) {
  const mocked = chain.isMocks ? ["stock tokens", "USDG", "swap venue", ...(cfg.hybrid ? [] : ["reference prices"])] : [];
  return { ...NETWORK_LABEL[cfg.network], chainId: cfg.CHAIN_ID, explorer: cfg.chain.blockExplorers?.default.url ?? null, mocked };
}

export type Services = { cfg: Config; chain: Chain; db: Db; resolver: Resolver; baskets: Baskets; indexer: Indexer; history: PriceHistory };

export function createServices(cfg: Config, dbPath = cfg.dbPath): Services {
  const chain = new Chain(cfg);
  const db = new Db(dbPath);
  const resolver = new Resolver(chain, db);
  // Chainlink history is mainnet history: the fork reads it directly instead of forwarding every round through anvil.
  // The testnet shows it too, for display and named as mainnet's: its own prices are a posted snapshot with no past.
  // The local mocks chain has none, so tests never depend on a remote endpoint.
  const history = new PriceHistory(chain.mainnet, cfg.network !== "mocks" || cfg.hybrid, (t) => chain.catalogue.feed(t), db);
  const baskets = new Baskets(chain, resolver, history);
  const indexer = new Indexer(chain, db, cfg.INDEXER_FROM_BLOCK, cfg.INDEXER_POLL_MS);
  return { cfg, chain, db, resolver, baskets, indexer, history };
}

const ResolveBody = z.object({
  ticker: z.string().min(1).max(12),
  side: z.enum(["buy", "sell"]).default("buy"),
  usdAmount: z.string().optional(),
  tokenAmount: z.string().optional(),
  representation: z.string().optional(),
  policy: PolicySchema.partial().optional(),
  wallet: z.string().optional(),
  recipient: z.string().optional(),
});
const MintBody = z.object({ units: z.string().optional(), usdAmount: z.string().optional(), budgetUsdg: z.string().optional(), policy: PolicySchema.partial().optional(), wallet: z.string().optional(), recipient: z.string().optional() });
const RedeemBody = z.object({ units: z.string(), inKind: z.boolean().default(false), policy: PolicySchema.partial().optional(), wallet: z.string().optional(), recipient: z.string().optional() });

const json = (v: unknown) => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

export function createApp(s: Services) {
  const app = new Hono();
  app.use("*", cors());
  app.onError((err, c) => {
    log.warn("request failed", { path: c.req.path, err: err.message });
    return c.json({ error: err.message }, 400);
  });

  const hasFaucet = s.cfg.network === "fork" || s.cfg.network === "mocks" || (s.cfg.network === "robinhoodTestnet" && Boolean(s.cfg.FAUCET_PRIVATE_KEY));
  app.get("/", (c) => c.json({ name: "parallax-resolver", chainId: s.cfg.CHAIN_ID, network: s.cfg.network, label: networkLabel(s.cfg, s.chain), dataSource: s.resolver.dataSource }));
  app.get("/health", async (c) => {
    const block = await s.chain.client.getBlockNumber().catch(() => null);
    return c.json({ ok: block !== null, block: block?.toString() ?? null, chainId: s.cfg.CHAIN_ID, label: networkLabel(s.cfg, s.chain), quoteOnly: s.cfg.quoteOnly, hybrid: hybridLabel(s.cfg), faucet: hasFaucet, universe: { file: s.chain.catalogue.available, stocks: s.chain.catalogue.universe.representations.length }, deployment: json(s.chain.d) });
  });
  app.get("/config", (c) => c.json({ chainId: s.cfg.CHAIN_ID, network: s.cfg.network, label: networkLabel(s.cfg, s.chain), deployment: json(s.chain.d), dataSource: s.resolver.dataSource }));

  app.get("/stocks", async (c) => c.json(json({ ...(await s.resolver.stocks(c.req.query("query"))), hybrid: hybridLabel(s.cfg) })));
  app.get("/stocks/:ticker", async (c) => {
    const all = await s.resolver.stocks(c.req.param("ticker"));
    const hit = all.stocks.find((x) => x.ticker === c.req.param("ticker").toUpperCase());
    if (!hit) return c.json({ error: "unknown ticker" }, 404);
    return c.json(json({ ...hit, dataSource: all.dataSource }));
  });

  app.post("/resolve", async (c) => {
    const b = ResolveBody.parse(await c.req.json());
    if (b.side === "buy") {
      if (!b.usdAmount) return c.json({ error: "usdAmount required for buy" }, 400);
      return c.json(json(await s.resolver.resolveBuy({ ticker: b.ticker, usdAmount: b.usdAmount, policy: b.policy, wallet: b.wallet, recipient: b.recipient })));
    }
    return c.json(json(await s.resolver.resolveSell({ ticker: b.ticker, representation: b.representation, tokenAmount: b.tokenAmount, usdAmount: b.usdAmount, policy: b.policy, wallet: b.wallet, recipient: b.recipient })));
  });

  app.get("/baskets", async (c) => {
    const snap = await s.baskets.cardsCached();
    return c.json(json({ dataSource: s.resolver.dataSource, quoteOnly: s.cfg.quoteOnly, hybrid: hybridLabel(s.cfg), asOf: Math.floor(snap.at / 1000), baskets: snap.cards }));
  });
  /**
   * A price history for one stock. Chainlink rounds where the stock has a feed, the underlying's daily closes
   * otherwise. `source` says which one answered, and
   * a ticker no source reaches returns an empty series rather than a line drawn from nothing.
   */
  app.get("/stocks/:ticker/history", async (c) => {
    const days = Math.min(730, Math.max(1, Number(c.req.query("days") ?? 7)));
    const points = Math.min(120, Math.max(2, Number(c.req.query("points") ?? 14)));
    const ticker = c.req.param("ticker").toUpperCase();
    if (s.history.hasHistory(ticker)) {
      const source = s.chain.isMocks && !s.cfg.hybrid ? "chainlink rounds on Robinhood Chain mainnet (display only)" : "chainlink rounds";
      return c.json(json({ ticker, source, series: await s.history.series(ticker, days, points), returns: await s.history.returns(ticker) }));
    }
    const series = await s.resolver.marketHistory.series(ticker, days, points);
    const returns = await s.resolver.marketHistory.returns(ticker);
    return c.json(json({ ticker, source: series && series.length > 1 ? "daily closes" : null, series: series ?? [], returns }));
  });
  app.get("/baskets/:id", async (c) => {
    const id = c.req.param("id");
    if (s.cfg.quoteOnly) return c.json(json({ ...(await s.baskets.plannedDetail(id)), dataSource: s.resolver.dataSource }));
    const addr = await s.baskets.resolveBasket(id);
    // migrations quote every representation pair at four fractions; they have their own route (/migrations?basket=)
    return c.json(json({ ...(await s.baskets.enrich(await s.baskets.summary(addr))), dataSource: s.resolver.dataSource }));
  });
  app.post("/baskets/:id/quote-mint", async (c) => c.json(json(await s.baskets.quoteMint({ basket: c.req.param("id"), ...MintBody.parse(await c.req.json()) }))));
  app.post("/baskets/:id/quote-redeem", async (c) => c.json(json(await s.baskets.quoteRedeem({ basket: c.req.param("id"), ...RedeemBody.parse(await c.req.json()) }))));

  app.get("/baskets/:id/rebalances", async (c) => c.json(json(await s.baskets.rebalances({ basket: c.req.param("id"), limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined }))));
  app.get("/migrations", async (c) => c.json(json(await s.baskets.migrations({ basket: c.req.query("basket"), minGainBps: c.req.query("minGainBps") ? Number(c.req.query("minGainBps")) : undefined }))));

  app.get("/quotes/:hash", (c) => {
    const q = s.db.getQuote(c.req.param("hash"));
    if (!q) return c.json({ error: "unknown quote hash" }, 404);
    return c.json({ hash: c.req.param("hash"), kind: q.kind, createdAt: q.created_at, record: JSON.parse(q.json) });
  });

  app.get("/receipts", async (c) => {
    await s.indexer.syncOnce();
    const rows = s.db.listReceipts({
      actor: c.req.query("actor"), underlying: c.req.query("underlying")?.toUpperCase(), emitter: c.req.query("basket") ?? c.req.query("emitter"),
      quoteHash: c.req.query("quoteHash"), txHash: c.req.query("txHash"), limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    });
    return c.json({ receipts: rows.map((r) => ({ ...r, quote: s.db.getQuote(String(r.quote_hash)) ? true : false })) });
  });
  app.get("/receipts/:txHash", async (c) => {
    await s.indexer.syncOnce();
    const rows = s.db.listReceipts({ txHash: c.req.param("txHash") });
    return c.json({ receipts: rows, quotes: Object.fromEntries(rows.map((r) => [r.quote_hash, s.db.getQuote(String(r.quote_hash)) ? JSON.parse(s.db.getQuote(String(r.quote_hash))!.json) : null])) });
  });

  // test funds on chains we own (a fork of mainnet, local mocks, the testnet with a faucet key); absent on mainnet
  if (hasFaucet) {
    app.post("/faucet", async (c) => {
      const body = z.object({ address: z.string() }).parse(await c.req.json());
      // on a fork the grant is moved out of the deepest USDG pool, the one holder certain to exist there
      const pools = s.cfg.network === "fork" ? await s.resolver.venues.uniswap?.pools(ROBINHOOD_ADDRESSES.usdg, ROBINHOOD_ADDRESSES.weth).catch(() => []) : [];
      const source = [...(pools ?? [])].sort((a, b) => ((b.balances[ROBINHOOD_ADDRESSES.usdg.toLowerCase()] ?? 0n) > (a.balances[ROBINHOOD_ADDRESSES.usdg.toLowerCase()] ?? 0n) ? 1 : -1))[0]?.pool;
      const r = await faucet(s.chain, body.address, s.db, source);
      s.chain.invalidate();
      return c.json(r);
    });
  }

  /**
   * Everything one address holds, priced. Shares are the unit of account, so a stock position is reported in
   * underlying shares across every issuer that represents it, and an index position in units and in what those
   * units are worth at the vault's own NAV. A position with no price source carries a null value rather than a
   * guess, and the totals say how much of the portfolio they cover.
   */
  app.get("/wallet/:address", async (c) => {
    const a = c.req.param("address");
    if (!isAddress(a)) return c.json({ error: "bad address" }, 400);
    const all = await s.chain.allUnderlyings();
    const brands = s.chain.catalogue.brands();
    const holdings = [];
    let stocksUsd = 0;
    let unpriced = 0;
    for (const u of all) {
      const ref = await s.resolver.referencePrice(u).catch(() => null);
      const brand = brands.get(u.ticker.toUpperCase()) ?? null;
      for (const r of u.representations) {
        const bal = await s.chain.balanceOf(r.token, a);
        if (bal === 0n) continue;
        const shares = await s.chain.sharesForTokens(r.token, bal);
        const valueUsd = ref ? Number(formatWad(shares, 18)) * Number(formatWad(ref.price, 18)) : null;
        if (valueUsd === null) unpriced++;
        else stocksUsd += valueUsd;
        holdings.push({
          ticker: u.ticker, name: brand?.name ?? null, logoUrl: brand?.logoUrl ?? null, symbol: r.symbol, platform: r.platform, token: r.token,
          tokens: bal.toString(), shares: shares.toString(), ratio: r.ratio.toString(), ratioSource: r.ratioSource,
          sellEligible: r.sellEligible, priceUsd: ref ? formatWad(ref.price, 6) : null, priceSource: ref?.source ?? null,
          valueUsd: valueUsd === null ? null : valueUsd.toFixed(2),
        });
      }
    }
    const baskets = [];
    let indicesUsd = 0;
    for (const b of await s.chain.baskets()) {
      const bal = await s.chain.balanceOf(b, a);
      if (bal === 0n) continue;
      const summary = await s.baskets.summary(b).catch(() => null);
      const m = await s.chain.basketMeta(b);
      const units = Number(formatWad(bal, 18));
      const nav = summary?.navPerUnitUsd ? Number(summary.navPerUnitUsd) : null;
      if (nav === null) unpriced++;
      else indicesUsd += units * nav;
      baskets.push({
        basket: b, symbol: m.symbol, name: summary?.name ?? m.symbol, units: bal.toString(),
        navPerUnitUsd: summary?.navPerUnitUsd ?? null, valueUsd: nav === null ? null : (units * nav).toFixed(2),
        constituents: summary?.constituents.map((x) => x.ticker) ?? [],
      });
    }
    const usdg = await s.chain.balanceOf(s.chain.d.usdg, a);
    const usdgUsd = Number(formatUsdg(usdg));
    return c.json({
      address: a, usdg: usdg.toString(), holdings, baskets,
      totals: {
        indicesUsd: indicesUsd.toFixed(2), stocksUsd: stocksUsd.toFixed(2), usdgUsd: usdgUsd.toFixed(2),
        portfolioUsd: (indicesUsd + stocksUsd).toFixed(2), unpricedPositions: unpriced,
      },
    });
  });

  return app;
}
