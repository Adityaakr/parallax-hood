import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  sharesForTokens, tokensForShares, requiredShares, proRata, stepBps, applySlippage, premiumBps, parseUnits, formatUnits, WAD,
} from "../src/shareMath.js";

const here = dirname(fileURLToPath(import.meta.url));
type Vec = Record<string, bigint>;
// forge writes uint256 as JSON numbers; use the Node 22 reviver `context.source` to keep full precision
const vectors: Vec[] = JSON.parse(readFileSync(resolve(here, "vectors/sharemath.json"), "utf8"), (_k, v, ctx: any) =>
  typeof v === "number" ? BigInt(ctx.source) : typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : v,
);
const big = (v: bigint) => v;

describe("ShareMath parity with Solidity (200 forge-generated vectors)", () => {
  it("has vectors", () => expect(vectors.length).toBe(200));

  for (const fn of ["sharesForTokens", "tokensForShares", "requiredShares", "proRata", "stepBps"] as const) {
    it(`${fn} matches`, () => {
      for (const v of vectors) {
        const expected = big(v[fn]!);
        let got: bigint;
        switch (fn) {
          case "sharesForTokens": got = sharesForTokens(big(v.tokens!), big(v.ratio!)); break;
          case "tokensForShares": got = tokensForShares(big(v.shares!), big(v.ratio!)); break;
          case "requiredShares": got = requiredShares(big(v.units!), big(v.sharesPerUnit!)); break;
          case "proRata": got = proRata(big(v.balance!), big(v.units!), big(v.supply!)); break;
          case "stepBps": got = stepBps(big(v.ratio!), big(v.newRatio!)); break;
        }
        expect(got).toBe(expected);
      }
    });
  }
});

describe("helpers", () => {
  it("applySlippage rounds down", () => {
    expect(applySlippage(1000n, 50)).toBe(995n);
    expect(applySlippage(WAD, 0)).toBe(WAD);
    expect(() => applySlippage(1n, 10001)).toThrow();
  });
  it("premiumBps", () => {
    expect(premiumBps(10100n, 10000n)).toBe(100);
    expect(premiumBps(9900n, 10000n)).toBe(-100);
    expect(premiumBps(1n, 0n)).toBe(0);
  });
  it("parse/format units", () => {
    expect(parseUnits("1.5", 18)).toBe(1500000000000000000n);
    expect(parseUnits("0.000001", 6)).toBe(1n);
    expect(parseUnits("500", 18)).toBe(500n * WAD);
    expect(formatUnits(1500000000000000000n, 18)).toBe("1.5");
    expect(formatUnits(123456789n, 6, 2)).toBe("123.45");
    expect(formatUnits(0n, 18)).toBe("0");
    expect(() => parseUnits("abc", 18)).toThrow();
  });
});
