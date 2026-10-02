import { describe, it, expect } from "vitest";
import { dateFromUrl, computedOpen, ratioNeedsPost, budgetVerdict } from "../src/keeper.js";

describe("keeper helpers", () => {
  it("parses attestation dates from report URLs", () => {
    expect(dateFromUrl("https://x/reports/daily/2026-09-16.pdf")).toBe(Date.UTC(2026, 8, 16) / 1000);
    expect(dateFromUrl("https://x/att_20260915_ondo.pdf")).toBe(Date.UTC(2026, 8, 15) / 1000);
    expect(dateFromUrl("https://x/no-date.pdf")).toBeNull();
  });
  it("computed calendar", () => {
    expect(computedOpen(new Date("2026-09-17T14:00:00Z"))).toBe(true);
    expect(computedOpen(new Date("2026-09-19T14:00:00Z"))).toBe(false);
    expect(computedOpen(new Date("2026-11-26T15:00:00Z"))).toBe(false);
  });
});

describe("what is worth a transaction", () => {
  const WAD = 10n ** 18n;
  const window = 12 * 3600;
  const base = { posted: WAD, live: WAD, windowSec: window, minMoveBps: 1 };

  it("does not re-post an unchanged, fresh ratio", () => {
    // the bug this replaces: a 10-minute poll re-posted every unchanged ratio every 30 minutes, which on
    // mainnet was ~900 transactions a day for information the registry already had
    for (const ageSec of [0, 600, 1800, 3600, window / 2 - 1]) {
      expect(ratioNeedsPost({ ...base, ageSec })).toBeNull();
    }
  });
  it("posts at half the window, before a missed run can let it expire", () => {
    expect(ratioNeedsPost({ ...base, ageSec: window / 2 })).toMatch(/half of the 12h window/);
    expect(ratioNeedsPost({ ...base, ageSec: window })).toBeTruthy();
  });
  it("posts a ratio that moved, however fresh", () => {
    expect(ratioNeedsPost({ ...base, ageSec: 0, live: (WAD * 10_001n) / 10_000n })).toMatch(/moved 1 bps/);
    expect(ratioNeedsPost({ ...base, ageSec: 0, live: (WAD * 10_050n) / 10_000n })).toMatch(/moved 50 bps/);
  });
  it("always posts a ratio that was never posted", () => {
    expect(ratioNeedsPost({ ...base, posted: 0n, ageSec: 0 })).toBe("never posted");
  });
  it("stops on the balance floor and on the daily cap", () => {
    const floorWei = 5n * 10n ** 14n;
    expect(budgetVerdict({ balanceWei: floorWei, floorWei, txsToday: 0, capPerDay: 250 })).toBeNull();
    expect(budgetVerdict({ balanceWei: floorWei - 1n, floorWei, txsToday: 0, capPerDay: 250 })).toMatch(/below the/);
    expect(budgetVerdict({ balanceWei: floorWei * 100n, floorWei, txsToday: 250, capPerDay: 250 })).toMatch(/daily cap/);
    // the cap is checked first: a keeper that is both broke and looping should say the loop, then the balance
    expect(budgetVerdict({ balanceWei: 0n, floorWei, txsToday: 999, capPerDay: 250 })).toMatch(/daily cap/);
  });
});
