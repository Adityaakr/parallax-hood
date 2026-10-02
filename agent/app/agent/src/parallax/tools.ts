/**
 * Parallax read tools for the agent's LLM (AI SDK `tool` wrappers over the resolver's HTTP API and the
 * mandate contract). Every one of these is READ-ONLY: quotes, indices, receipts, mandate limits. The LLM uses
 * them to research and to explain; it can plan an investment here but can never execute one — execution is
 * fixed code in `work.ts`, reached only after a job is verified funded (ERC-8183) or paid (x402).
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { api, planBuy, planInvest, readMandate } from "./client.js";

export const PARALLAX_TOOLS: ToolSet = {
  parallax_search_stocks: tool({
    description:
      "Search tokenized stocks on BNB Chain. Returns each stock with every issuer's token (Ondo, bStocks), its share ratio, live catalogue price, Chainlink reference price and market status. Use to find tickers and compare issuers.",
    inputSchema: z.object({ query: z.string().optional().describe("Ticker or token symbol substring, e.g. NVDA") }),
    execute: async ({ query }) => {
      const r = await api(`/stocks${query ? `?query=${encodeURIComponent(query)}` : ""}`);
      return {
        hybrid: r.hybrid, dataSource: r.dataSource,
        stocks: (r.stocks as any[]).slice(0, 25).map((s) => ({
          ticker: s.ticker, name: s.name, referencePrice: s.referencePrice, referenceSource: s.referenceSource, marketOpen: s.market?.open,
          tokens: s.representations.map((x: any) => ({ symbol: x.symbol, issuer: x.platform, ratio: x.ratio, tokenPrice: x.binance?.tokenPrice ?? null, buyEligible: x.buyEligible })),
        })),
      };
    },
  }),
  parallax_best_execution: tool({
    description:
      "Quote buying a dollar amount of one stock at best execution across every issuer and venue. Returns every candidate token with its effective cost per underlying share, premium to the Chainlink reference, slippage and the reason it was or was not eligible, plus the chosen route and shares out. No transaction is sent.",
    inputSchema: z.object({ ticker: z.string(), usd_amount: z.string().describe("USDT to spend, decimal string, e.g. '100'") }),
    execute: async ({ ticker, usd_amount }) => {
      const r = await api("/resolve", { method: "POST", body: JSON.stringify({ ticker: ticker.toUpperCase(), side: "buy", usdAmount: usd_amount }) });
      return {
        status: r.status, ticker: r.underlying, referencePrice: r.referencePrice, referenceSource: r.referenceSource, marketOpen: r.marketOpen,
        chosen: r.chosen ? { sharesOut: r.chosen.sharesOut, minShares: r.chosen.minShares, why: r.chosen.why, split: r.chosen.split } : null,
        candidates: (r.candidates as any[]).map((c) => ({ symbol: c.symbol, issuer: c.platform, venue: c.venue, costPerShareUsd: c.costPerShareUsd, premiumBps: c.premiumBps, slippageBps: c.slippageBps, eligible: c.eligible, reasons: c.reasons })),
        quoteHash: r.quoteHash,
      };
    },
  }),
  parallax_list_indices: tool({
    description:
      "List Parallax indices (pxMAG7, pxAI, pxNEW): NAV per unit, minimum investment in USD, price returns over 1D/7D/1M/6M/1Y from Chainlink history with the share of NAV that has a feed (coverageBps), allocation by constituent, and whether the index is deployed on this network.",
    inputSchema: z.object({}),
    execute: async () => {
      const r = await api("/baskets");
      return {
        hybrid: r.hybrid,
        indices: (r.baskets as any[]).map((b) => ({
          symbol: b.symbol, name: b.name, thesis: b.thesis, deployed: b.deployed, address: b.address, navPerUnitUsd: b.navPerUnitUsd, minUsd: b.minUsd,
          returns: b.performance.returns, coverageBps: b.performance.coverageBps, returnSource: b.performance.source,
          allocation: b.allocation.map((a: any) => ({ ticker: a.ticker, name: a.name, weightBps: a.weightBps, priceUsd: a.priceUsd, change24hBps: a.change24hBps })),
        })),
      };
    },
  }),
  parallax_get_index: tool({
    description: "One index in detail: constituents with shares per unit, held vs required shares (backing), the issuer tokens the vault holds, NAV, returns and allocation.",
    inputSchema: z.object({ symbol: z.string().describe("Index symbol, e.g. pxMAG7") }),
    execute: async ({ symbol }) => {
      const b = await api(`/baskets/${encodeURIComponent(symbol)}`);
      return {
        symbol: b.symbol, name: b.name, thesis: b.thesis, deployed: b.deployed, address: b.address, navPerUnitUsd: b.navPerUnitUsd, minUsd: b.minUsd, backingOk: b.backingOk, totalSupply: b.totalSupply,
        returns: b.performance.returns, coverageBps: b.performance.coverageBps,
        constituents: (b.constituents as any[]).map((c) => ({ ticker: c.ticker, sharesPerUnit: c.sharesPerUnit, heldShares: c.heldShares, requiredShares: c.requiredShares, backingRatio: c.backingRatio, referencePrice: c.referencePrice, why: b.why?.[c.ticker] ?? null, tokens: c.representations.map((r: any) => ({ symbol: r.symbol, issuer: r.platform, shareBps: r.shareBps })) })),
      };
    },
  }),
  parallax_quote_invest: tool({
    description:
      "Quote investing a dollar amount into an index: units minted, expected and maximum USDT, and how each constituent would be filled (token, issuer, shares, cost per share, venue). No transaction is sent. If a mandate_id is given, also checks the mandate's caps and allowlist and reports any refusal.",
    inputSchema: z.object({ index: z.string(), usd_amount: z.string(), mandate_id: z.string().optional() }),
    execute: async ({ index, usd_amount, mandate_id }) => {
      if (mandate_id) {
        try {
          const p = await planInvest({ mandateId: BigInt(mandate_id), index, usd: usd_amount });
          return { executable: true, mandateId: mandate_id, owner: p.owner, authorizedUsdt: p.summary.maxUsdtIn, ...p.summary, quoteHash: p.quoteHash };
        } catch (e) {
          return { executable: false, refusal: (e as Error).message };
        }
      }
      const q = await api(`/baskets/${encodeURIComponent(index)}/quote-mint`, { method: "POST", body: JSON.stringify({ usdAmount: usd_amount }) });
      return { status: q.status, index: q.symbol, units: q.units, expectedUsdt: q.expectedUsdt, maxUsdtIn: q.maxUsdtIn, problems: q.problems, breakdown: q.breakdown, quoteHash: q.quoteHash };
    },
  }),
  parallax_quote_buy: tool({
    description: "Check whether buying a dollar amount of a stock through a specific AgentMandate would be allowed (agent, caps, expiry, allowlist) and what the route would be. No transaction is sent.",
    inputSchema: z.object({ ticker: z.string(), usd_amount: z.string(), mandate_id: z.string() }),
    execute: async ({ ticker, usd_amount, mandate_id }) => {
      try {
        const p = await planBuy({ mandateId: BigInt(mandate_id), ticker, usd: usd_amount });
        return { executable: true, mandateId: mandate_id, owner: p.owner, ...p.summary, quoteHash: p.quoteHash };
      } catch (e) {
        return { executable: false, refusal: (e as Error).message };
      }
    },
  }),
  parallax_get_mandate: tool({
    description: "Read an AgentMandate: owner, agent, active, expiry, per-tx cap, daily cap, spent in the current window and remaining today, and whether this agent is the one it names.",
    inputSchema: z.object({ mandate_id: z.string() }),
    execute: async ({ mandate_id }) => {
      const { _raw, ...m } = await readMandate(BigInt(mandate_id));
      return m;
    },
  }),
  parallax_receipts: tool({
    description: "Onchain RouteReceipts (buy/sell/mint/redeem/migrate) indexed by the resolver, with shares, ratio and attestation at execution time. Filter by actor wallet, ticker, basket address or tx hash.",
    inputSchema: z.object({ actor: z.string().optional(), underlying: z.string().optional(), basket: z.string().optional(), tx_hash: z.string().optional(), limit: z.number().int().max(50).default(10) }),
    execute: async ({ actor, underlying, basket, tx_hash, limit }) => {
      if (tx_hash) return api(`/receipts/${tx_hash}`);
      const q = new URLSearchParams();
      if (actor) q.set("actor", actor);
      if (underlying) q.set("underlying", underlying.toUpperCase());
      if (basket) q.set("basket", basket);
      q.set("limit", String(limit));
      return api(`/receipts?${q}`);
    },
  }),
};
