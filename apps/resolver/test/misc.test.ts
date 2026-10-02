import { describe, it, expect } from "vitest";
import { computedMarketStatus } from "../src/providers/marketHours.js";
import { canonicalJson, quoteHashOf } from "../src/quotes.js";
import { Db } from "../src/db.js";

describe("computed market hours (24/5)", () => {
  it("is open from Sunday 20:00 to Friday 20:00 New York time", () => {
    expect(computedMarketStatus(new Date("2026-09-17T14:00:00Z")).open).toBe(true); // Thu 10:00 EDT
    expect(computedMarketStatus(new Date("2026-09-17T07:00:00Z")).open).toBe(true); // Thu 03:00 EDT, overnight session
    expect(computedMarketStatus(new Date("2026-09-18T23:59:00Z")).open).toBe(true); // Fri 19:59 EDT
    expect(computedMarketStatus(new Date("2026-09-21T00:00:00Z")).open).toBe(true); // Sun 20:00 EDT
  });

  it("is closed over the weekend and says when it reopens", () => {
    const fri = computedMarketStatus(new Date("2026-09-19T00:00:00Z")); // Fri 20:00 EDT
    expect(fri.open).toBe(false);
    expect(new Date(fri.nextOpenTime!).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    const sat = computedMarketStatus(new Date("2026-09-19T15:00:00Z"));
    expect(sat.open).toBe(false);
    expect(new Date(sat.nextOpenTime!).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(sat.source).toBe("computed");
  });

  it("names the next close while open", () => {
    const thu = computedMarketStatus(new Date("2026-09-17T14:00:00Z"));
    expect(new Date(thu.nextCloseTime!).toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
});

describe("quote hashing", () => {
  it("is canonical (key order independent, bigint safe)", () => {
    const a = { b: 1n, a: [{ y: 2, x: "1" }] };
    const b = { a: [{ x: "1", y: 2 }], b: 1n };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(quoteHashOf(a)).toBe(quoteHashOf(b));
    expect(quoteHashOf({ a: 1 })).not.toBe(quoteHashOf({ a: 2 }));
    expect(quoteHashOf(a)).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("db", () => {
  it("stores quotes and receipts with filters", () => {
    const db = new Db(":memory:");
    db.putQuote("0xabc", "buy", JSON.stringify({ x: 1 }), { underlying: "NVDA" });
    expect(db.getQuote("0xabc")!.kind).toBe("buy");
    expect(db.getQuote("0xzzz")).toBeUndefined();
    const r = { tx_hash: "0x1", log_index: 0, block_number: 10, emitter: "0xE", quote_hash: "0xabc", actor: "0xA", underlying: "NVDA", token_in: "0xU", amount_in: "1", representation: "0xR", tokens_out: "2", shares_out: "3", ratio: "4", attested_at: 5, action: "buy", timestamp: 6 };
    db.putReceipt(r);
    db.putReceipt(r); // idempotent
    db.putReceipt({ ...r, log_index: 1, underlying: "AAPL", actor: "0xB" });
    expect(db.listReceipts({}).length).toBe(2);
    expect(db.listReceipts({ actor: "0xa" }).length).toBe(1);
    expect(db.listReceipts({ underlying: "AAPL" })[0]!.actor).toBe("0xB");
    expect(db.listReceipts({ quoteHash: "0xABC" }).length).toBe(2);
    db.setKv("k", "v");
    expect(db.getKv("k")).toBe("v");
  });
});
