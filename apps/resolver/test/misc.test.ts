import { describe, it, expect } from "vitest";
import { computedMarketStatus } from "../src/providers/marketHours.js";
import { canonicalJson, quoteHashOf } from "../src/quotes.js";
import { Db } from "../src/db.js";

describe("computed market hours", () => {
  it("open on a weekday at 10:00 New York, closed at 17:00, closed on Saturday and on a holiday", () => {
    expect(computedMarketStatus(new Date("2026-09-17T14:00:00Z")).open).toBe(true); // Thu 10:00 EDT
    const c = computedMarketStatus(new Date("2026-09-17T21:00:00Z")); // Thu 17:00 EDT
    expect(c.open).toBe(false);
    expect(new Date(c.nextOpenTime!).toISOString()).toBe("2026-09-18T13:30:00.000Z");
    const sat = computedMarketStatus(new Date("2026-09-19T15:00:00Z"));
    expect(sat.open).toBe(false);
    expect(new Date(sat.nextOpenTime!).toISOString()).toBe("2026-09-21T13:30:00.000Z");
    const hol = computedMarketStatus(new Date("2026-11-26T15:00:00Z")); // Thanksgiving
    expect(hol.open).toBe(false);
    expect(new Date(hol.nextOpenTime!).toISOString()).toBe("2026-11-27T14:30:00.000Z"); // EST after DST ends
    expect(computedMarketStatus(new Date("2026-09-17T14:00:00Z")).source).toBe("computed");
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
