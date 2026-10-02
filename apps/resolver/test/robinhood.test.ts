import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { RobinhoodApi, describeAction } from "../src/providers/robinhood.js";
import { serial } from "../src/txLock.js";
import { loadConfig } from "../src/config.js";

/*
 * The responses under fixtures/robinhood were recorded from https://api.robinhood.com/rhj on 2 October 2026 and
 * cut down to the seven stocks. They pin the shape this client parses; nothing in the product reads them.
 */
const dir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/robinhood");
const recorded = (name: string) => JSON.parse(readFileSync(resolve(dir, name), "utf8"));
const routes: Record<string, unknown> = {
  "/assets": recorded("assets.json"),
  "/prices/NVDA": recorded("prices-NVDA.json"),
  "/corporate-actions": recorded("corporate-actions.json"),
};

/** A fetch that serves the recorded responses and counts what was asked for. */
function fakeFetch(overrides: Record<string, unknown | Error> = {}) {
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    const path = url.replace("https://rhj.test", "");
    calls.push(path);
    const body = path in overrides ? overrides[path] : routes[path];
    if (body instanceof Error) throw body;
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("Robinhood Stock Token API client", () => {
  it("reads an asset: mainnet token, multiplier, sessions", async () => {
    const { fetcher } = fakeFetch();
    const api = new RobinhoodApi("https://rhj.test", fetcher);
    const nvda = await api.asset("nvda");
    expect(nvda?.token).toBe("0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC");
    expect(nvda?.status).toBe("ACTIVE");
    expect(Number(nvda?.multiplier)).toBeGreaterThanOrEqual(1);
    expect(nvda?.pendingMultiplier).toBeNull(); // the issuer sends "" when nothing is pending
    expect(nvda?.sessions).toEqual({ market: { whole: true, fractional: true }, extended: { whole: true, fractional: true }, overnight: { whole: true, fractional: true } });
    expect((await api.assets())?.size).toBe(7);
  });

  it("reads a quote per share and per token, with its own timestamp", async () => {
    const { fetcher } = fakeFetch();
    const q = await new RobinhoodApi("https://rhj.test", fetcher).quote("NVDA");
    const raw = recorded("prices-NVDA.json").quotes[0];
    expect(q?.bid).toBe(raw.bid);
    expect(q?.ask).toBe(raw.ask);
    expect(Number(q?.ask)).toBeGreaterThanOrEqual(Number(q?.bid));
    expect(q?.tokenBid).toBe(raw.tokenBid);
    expect(q?.halted).toBe(false);
    expect(q?.generatedAt).toBe(Math.floor(Date.parse(raw.generatedAt) / 1000));
  });

  it("asks once inside the upstream cache window, and once for concurrent callers", async () => {
    const { fetcher, calls } = fakeFetch();
    const api = new RobinhoodApi("https://rhj.test", fetcher);
    await Promise.all([api.quote("NVDA"), api.quote("NVDA"), api.asset("NVDA"), api.asset("AAPL")]);
    await api.quote("NVDA");
    await api.assets();
    expect(calls.sort()).toEqual(["/assets", "/prices/NVDA"]);
  });

  it("lists corporate actions for one symbol with a sentence built from the issuer's fields", async () => {
    const { fetcher } = fakeFetch();
    const api = new RobinhoodApi("https://rhj.test", fetcher);
    const all = await api.corporateActions();
    const nvda = await api.corporateActions("NVDA");
    expect(all!.length).toBeGreaterThan(nvda!.length);
    expect(nvda!.every((a) => a.symbol === "NVDA")).toBe(true);
    const first = nvda![0]!;
    expect(first.type).toBe("CASH_DIVIDEND");
    expect(first.processDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.summary).toBe(`Cash dividend of ${first.details.rate} USD per share`);
  });

  it("describes splits from their rates and leaves unknown types as they are named", () => {
    expect(describeAction("FORWARD_SPLIT", { underlyingSymbol: "AAPL", oldRate: "1", newRate: "4" })).toBe("Forward split 4 for 1");
    expect(describeAction("NAME_CHANGE", {})).toBe("name change");
  });

  it("answers null, not a guess, when the API fails or is switched off", async () => {
    const { fetcher } = fakeFetch({ "/prices/NVDA": new Error("boom"), "/assets": { assets: [{ tokenSymbol: "NVDA" }] } });
    const api = new RobinhoodApi("https://rhj.test", fetcher);
    expect(await api.quote("NVDA")).toBeNull();
    expect(await api.assets()).toBeNull(); // a response that fails validation is a failure
    expect(await api.quote("ZZZZ")).toBeNull(); // 404
    const off = new RobinhoodApi(null, fetcher);
    expect(off.enabled).toBe(false);
    expect(await off.quote("NVDA")).toBeNull();
    expect(await off.corporateActions()).toBeNull();
  });
});

describe("issuer API switch", () => {
  it("stays off on the local mocks chain so tests never leave the machine", () => {
    // quote-only so no deployment file is needed
    expect(loadConfig({ CHAIN_ID: "1337", QUOTE_ONLY: "1" }).issuerApi).toBeNull();
    expect(loadConfig({ CHAIN_ID: "4663" }).issuerApi).toBe("https://api.robinhood.com/rhj");
    expect(loadConfig({ CHAIN_ID: "4663", ROBINHOOD_API_URL: "" }).issuerApi).toBeNull();
  });
});

describe("serial sends per key", () => {
  it("runs one at a time in order and survives a failure", async () => {
    const order: string[] = [];
    const job = (name: string, ms: number, fail = false) => () =>
      new Promise<string>((res, rej) => setTimeout(() => (order.push(name), fail ? rej(new Error(name)) : res(name)), ms));
    const a = serial("0xAbC", job("a", 30));
    const b = serial("0xabc", job("b", 1, true));
    const c = serial("0xABC", job("c", 1));
    const other = serial("0xdef", job("other", 5));
    await expect(b).rejects.toThrow("b");
    expect(await Promise.all([a, c, other])).toEqual(["a", "c", "other"]);
    expect(order).toEqual(["other", "a", "b", "c"]);
  });
});
