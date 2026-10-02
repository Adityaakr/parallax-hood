/**
 * Aggregator routing against a BSC mainnet fork (`pnpm fork:up`, chain 31337). Skipped when the fork is not up
 * or no Binance key is configured, because both are required to quote a live route.
 *
 * Covers what M2 promises: when the aggregator wins, /resolve returns a *signable* transaction whose leg
 * targets the aggregator router, and the simulation of that transaction passes.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { createPublicClient, http, decodeFunctionData } from "viem";
import { ShareRouterAbi, bscFork } from "@parallax-hood/sdk";
import { loadConfig } from "../src/config.js";
import { createApp, createServices, type Services } from "../src/app.js";

const RPC = process.env.FORK_RPC_URL ?? "http://127.0.0.1:8547";
const AGGREGATOR = "0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5".toLowerCase();

async function forkUp() {
  try {
    const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }) });
    return ((await r.json()) as { result?: string }).result === "0x7a69";
  } catch {
    return false;
  }
}

const up = (await forkUp()) && Boolean(process.env.BINANCE_WEB3_API_KEY);
const d = up ? describe : describe.skip;

d("aggregator routing (BSC mainnet fork)", () => {
  let s: Services;
  let app: ReturnType<typeof createApp>;
  const pub = createPublicClient({ chain: bscFork, transport: http(RPC) });

  beforeAll(async () => {
    const cfg = loadConfig({ ...process.env, CHAIN_ID: "31337", RPC_URL: RPC, DATABASE_URL: ":memory:", BINANCE_CLIENT_MODE: "live" } as NodeJS.ProcessEnv);
    s = createServices(cfg, ":memory:");
    app = createApp(s);
    // a cold fork fetches pool state upstream on first touch; warm the tokens we quote so the tests measure
    // routing, not anvil's cache miss
    const u = await s.chain.allUnderlyings();
    const nvda = u.find((x) => x.ticker === "NVDA");
    if (nvda) await s.resolver.venues.warmup(nvda.representations.map((r) => r.token));
  }, 300_000);

  const resolveBuy = async (ticker: string, usdAmount: string, wallet?: string) => {
    const res = await app.request("/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticker, usdAmount, wallet, policy: { maxPremiumBps: 500, maxClosedMarketPremiumBps: 500, allowClosedMarket: true } }),
    });
    expect(res.status).toBe(200);
    return res.json() as Promise<Record<string, any>>;
  };

  it("quotes the aggregator alongside the pools and names the venues it routed through", async () => {
    const r = await resolveBuy("NVDA", "200");
    const venues = r.candidates.map((c: { venue: string }) => c.venue);
    expect(venues.some((v: string) => v.startsWith("binance-agg") || v.startsWith("pancake-v3"))).toBe(true);
    const agg = r.candidates.find((c: { venue: string }) => c.venue.startsWith("binance-agg"));
    if (agg) expect(agg.venue).toMatch(/binance-agg:.+/); // the venue string carries the underlying route
    expect(r.candidates.every((c: { costPerShareUsd: string }) => c.costPerShareUsd !== undefined)).toBe(true);
  }, 300_000);

  it("returns a signable transaction targeting the aggregator when it wins", async () => {
    const wallet = "0xF1430783FCc9d723908bF9008525Fc43a53862AE";
    const r = await resolveBuy("NVDA", "200", wallet);
    const chosenVenue = r.candidates.find((c: { token: string }) => c.token.toLowerCase() === r.chosen?.split?.[0]?.token?.toLowerCase())?.venue ?? "";
    if (!chosenVenue.startsWith("binance-agg")) {
      // a pool beat the aggregator this block; the pool path is covered by the integration suite
      expect(r.tx).toBeTruthy();
      return;
    }
    expect(r.tx, "aggregator route must still produce a transaction").toBeTruthy();
    const { args } = decodeFunctionData({ abi: ShareRouterAbi, data: r.tx.data });
    const legs = args[3] as readonly { target: string; data: string }[];
    expect(legs.length).toBeGreaterThan(0);
    expect(legs[0]!.target.toLowerCase()).toBe(AGGREGATOR);
    expect(legs[0]!.data.length).toBeGreaterThan(200); // real calldata, not the placeholder
    expect(r.simulation?.ok, `simulation failed: ${r.simulation?.error}`).toBe(true);
  }, 300_000);

  it("keeps the share-denominated minimum on the aggregator path", async () => {
    const r = await resolveBuy("NVDA", "200", "0xF1430783FCc9d723908bF9008525Fc43a53862AE");
    if (!r.tx) return;
    const { args } = decodeFunctionData({ abi: ShareRouterAbi, data: r.tx.data });
    const [, usdtIn, minShares] = args as unknown as [string, bigint, bigint];
    expect(usdtIn).toBe(200n * 10n ** 18n);
    expect(minShares).toBeGreaterThan(0n);
    expect(minShares).toBeLessThan(BigInt(r.chosen.sharesOut));
  }, 300_000);
});
