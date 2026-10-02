import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BinanceWeb3Client, BinanceApiError, FixtureMissingError } from "../src/client.js";
import { TokenBucket, withBackoff } from "../src/rateLimit.js";

const tokensPayload = [
  {
    binanceChainId: "56", tokenContractAddress: "0x02fca66c1d1afb4e2a7884261eb00f63598a7436", platformId: "bstock", assetType: 1,
    tokenName: "NVIDIA Corp", tokenSymbol: "NVDAB", decimals: "18", underlyingTicker: "NVDA", tokenToShareRatio: "1.000778",
    statusInfo: { openState: true, marketStatus: "OPEN", reasonCode: null, nextOpenTime: null, nextCloseTime: 1789675200000 },
    tokenPrice: "219.31", referencePrice: "219.18", volume24h: "1234567",
  },
];

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> }): typeof fetch {
  return vi.fn(async (input: any, init: any) => {
    const r = handler(String(input), init ?? {});
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json", ...(r.headers ?? {}) } });
  }) as unknown as typeof fetch;
}

describe("BinanceWeb3Client live mode", () => {
  it("signs requests, unwraps envelope, validates and caches", async () => {
    const calls: string[] = [];
    const f = fakeFetch((url, init) => {
      calls.push(url);
      const h = init.headers as Record<string, string>;
      expect(h["X-OC-APIKEY"]).toBe("key");
      expect(h["X-OC-SIGN"]).toMatch(/^[A-Za-z0-9+/=]+$/);
      return { status: 200, body: { code: 0, msg: "success", data: tokensPayload, success: true } };
    });
    const c = new BinanceWeb3Client({ apiKey: "key", apiSecret: "sec", fetchImpl: f });
    const a = await c.rwaTokens({ binanceChainId: "56", tabId: 9 });
    const b = await c.rwaTokens({ binanceChainId: "56", tabId: 9 });
    expect(a[0]!.tokenSymbol).toBe("NVDAB");
    expect(a[0]!.tokenToShareRatio).toBe("1.000778");
    expect(b).toEqual(a);
    expect(calls.length).toBe(1); // cached
    expect(calls[0]).toBe("https://web3.binance.com/build/api/v1/dex/market/rwa/tokens?binanceChainId=56&tabId=9");
  });

  it("surfaces API business errors and HTTP errors", async () => {
    const c = new BinanceWeb3Client({ apiKey: "k", apiSecret: "s", fetchImpl: fakeFetch(() => ({ status: 200, body: { code: 40102, msg: "Invalid signature", data: null } })) });
    await expect(c.rwaPlatforms()).rejects.toBeInstanceOf(BinanceApiError);
    const c2 = new BinanceWeb3Client({ apiKey: "k", apiSecret: "s", fetchImpl: fakeFetch(() => ({ status: 403, body: { code: 40104, msg: "no permission" } })) });
    await expect(c2.rwaPlatforms()).rejects.toMatchObject({ status: 403 });
  });

  it("retries on 429 honoring Retry-After then succeeds", async () => {
    let n = 0;
    const c = new BinanceWeb3Client({
      apiKey: "k", apiSecret: "s",
      fetchImpl: fakeFetch(() => (n++ === 0 ? { status: 429, body: {}, headers: { "retry-after": "0" } } : { status: 200, body: { code: 0, data: [] } })),
      logger: { info: () => {}, warn: () => {} },
    });
    expect(await c.rwaPlatforms()).toEqual([]);
    expect(n).toBe(2);
  });

  it("rejects >100 addresses for rwa/price", async () => {
    const c = new BinanceWeb3Client({ apiKey: "k", apiSecret: "s", fetchImpl: fakeFetch(() => ({ status: 200, body: { code: 0, data: [] } })) });
    await expect(c.rwaPrice({ binanceChainId: "56", tokenContractAddresses: new Array(101).fill("0x") })).rejects.toThrow(/max 100/);
  });
});

describe("fixtures / record modes", () => {
  it("record writes a labeled fixture; fixtures mode replays it without network", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bfx-"));
    const f = fakeFetch(() => ({ status: 200, body: { code: 0, data: tokensPayload } }));
    const rec = new BinanceWeb3Client({ apiKey: "k", apiSecret: "s", mode: "record", fixturesDir: dir, fetchImpl: f });
    await rec.rwaTokens({ binanceChainId: "56" });
    const files = readdirSync(join(dir, "market_rwa_tokens"));
    expect(files.length).toBe(1);

    const neverFetch = vi.fn() as unknown as typeof fetch;
    const play = new BinanceWeb3Client({ mode: "fixtures", fixturesDir: dir, fetchImpl: neverFetch });
    expect(play.isFixtureMode).toBe(true);
    const out = await play.rwaTokens({ binanceChainId: "56" });
    expect(out[0]!.underlyingTicker).toBe("NVDA");
    expect(neverFetch).not.toHaveBeenCalled();
    await expect(play.rwaTokens({ binanceChainId: "1" })).rejects.toBeInstanceOf(FixtureMissingError);
  });

  it("defaults to fixtures mode without a key and refuses live without one", () => {
    expect(new BinanceWeb3Client({}).mode).toBe("fixtures");
    expect(() => new BinanceWeb3Client({ mode: "live" })).toThrow();
  });
});

describe("rate limiting", () => {
  it("token bucket spaces requests", async () => {
    const b = new TokenBucket(2, 100); // 2 burst, 100/s
    const t0 = Date.now();
    await b.take();
    await b.take();
    await b.take(); // must wait ~10ms
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5);
  });
  it("withBackoff stops after retries", async () => {
    let n = 0;
    await expect(withBackoff(async () => { n++; throw new Error("x"); }, { retries: 2, baseMs: 1, shouldRetry: () => true })).rejects.toThrow("x");
    expect(n).toBe(3);
  });
});
