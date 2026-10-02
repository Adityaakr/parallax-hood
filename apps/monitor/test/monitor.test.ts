import { describe, it, expect } from "vitest";
import { feedVerdict, multiplierVerdict, scheduledVerdict, depthVerdict, worstOf } from "../src/monitor.js";

const DAY = 86_400;
const WAD = 10n ** 18n;

describe("feed age", () => {
  it("accepts a weekend gap inside a five-day window and flags a stopped feed", () => {
    expect(feedVerdict("NVDA", 58 * 3600, 5 * DAY, 231_00000000n).severity).toBe("ok"); // an ordinary weekend
    expect(feedVerdict("NVDA", 97 * 3600, 5 * DAY, 231_00000000n).severity).toBe("warning"); // past the longest gap ever observed
    const stopped = feedVerdict("NVDA", 6 * DAY, 5 * DAY, 231_00000000n);
    expect(stopped.severity).toBe("critical");
    expect(stopped.detail).toMatch(/agent buys of NVDA are blocked/);
  });
  it("treats a non-positive answer as critical whatever its age", () => {
    expect(feedVerdict("NVDA", 60, 5 * DAY, 0n).severity).toBe("critical");
  });
});

describe("multiplier against the checkpoint", () => {
  it("is quiet for a dividend, warns as it nears the bound and is critical past it", () => {
    expect(multiplierVerdict("NVDA", WAD, (WAD * 10008n) / 10000n, 500).severity).toBe("ok"); // 8 bps, a dividend
    expect(multiplierVerdict("NVDA", WAD, (WAD * 103n) / 100n, 500).severity).toBe("warning"); // 300 bps
    const split = multiplierVerdict("NVDA", WAD, WAD * 2n, 500); // a two-for-one split
    expect(split.severity).toBe("critical");
    expect(split.detail).toMatch(/confirmRatio/);
    expect(multiplierVerdict("NVDA", WAD, WAD / 2n, 500).severity).toBe("critical"); // a reverse split
  });
  it("has nothing to compare where no registry is deployed", () => {
    expect(multiplierVerdict("NVDA", 0n, WAD, 500).severity).toBe("ok");
    expect(multiplierVerdict("NVDA", 0n, 0n, 500).severity).toBe("critical");
  });
});

describe("scheduled change, depth and roll-up", () => {
  it("reports a change only when it is both different and still ahead", () => {
    expect(scheduledVerdict("NVDA", WAD, WAD, 2_000, 1_000)).toBeNull(); // nothing scheduled: next mirrors current
    expect(scheduledVerdict("NVDA", WAD, WAD * 2n, 900, 1_000)).toBeNull(); // already in force
    expect(scheduledVerdict("NVDA", WAD, WAD * 2n, 2_000, 1_000)?.severity).toBe("notice");
  });
  it("measures depth in whole USDG from a 6-decimal balance", () => {
    expect(depthVerdict("META", 145_645_000_000n, 50_000).severity).toBe("ok");
    expect(depthVerdict("META", 45_000_000_000n, 50_000).severity).toBe("warning");
  });
  it("rolls up to the worst finding", () => {
    expect(worstOf([])).toBe("ok");
    expect(worstOf([depthVerdict("META", 1n, 50_000), feedVerdict("NVDA", 6 * DAY, 5 * DAY, 1n)])).toBe("critical");
  });
});
