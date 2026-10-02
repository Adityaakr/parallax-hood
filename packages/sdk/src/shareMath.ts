/**
 * Bit-exact mirror of contracts/src/libraries/ShareMath.sol.
 * All values are bigint; ratios and shares are 1e18-scaled.
 */
export const WAD = 10n ** 18n;
export const BPS = 10_000n;

export function mulDivFloor(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  return (a * b) / d;
}

export function mulDivCeil(a: bigint, b: bigint, d: bigint): bigint {
  if (d === 0n) throw new Error("division by zero");
  const p = a * b;
  return p / d + (p % d === 0n ? 0n : 1n);
}

/** Shares represented by `tokens` (round down). */
export function sharesForTokens(tokens: bigint, ratio: bigint): bigint {
  return mulDivFloor(tokens, ratio, WAD);
}

/** Tokens required to represent `shares` (round up). */
export function tokensForShares(shares: bigint, ratio: bigint): bigint {
  return mulDivCeil(shares, WAD, ratio);
}

/** Shares required to back `units` (round up). */
export function requiredShares(units: bigint, sharesPerUnit: bigint): bigint {
  return mulDivCeil(units, sharesPerUnit, WAD);
}

/** Pro-rata slice (round down). */
export function proRata(balance: bigint, units: bigint, totalSupply: bigint): bigint {
  if (totalSupply === 0n) return 0n;
  return mulDivFloor(balance, units, totalSupply);
}

/** |new - old| in bps of old. */
export function stepBps(oldRatio: bigint, newRatio: bigint): bigint {
  if (oldRatio === 0n) return 0n;
  const diff = newRatio > oldRatio ? newRatio - oldRatio : oldRatio - newRatio;
  return mulDivFloor(diff, BPS, oldRatio);
}

/** minShares = sharesOut * (1 - slippageBps / 10_000), round down. */
export function applySlippage(amount: bigint, slippageBps: bigint | number): bigint {
  const s = BigInt(slippageBps);
  if (s < 0n || s > BPS) throw new Error("slippage out of range");
  return mulDivFloor(amount, BPS - s, BPS);
}

/** (a / b - 1) * 10_000 as a signed integer bps, round toward zero. */
export function premiumBps(cost: bigint, reference: bigint): number {
  if (reference === 0n) return 0;
  return Number(((cost - reference) * BPS) / reference);
}

// ---- decimal string helpers (API and MCP boundaries use decimal strings, never floats) ----

export function parseUnits(value: string, decimals: number): bigint {
  const s = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === "" || s === "." || s === "-") throw new Error(`bad decimal ${value}`);
  const neg = s.startsWith("-");
  const [intPart, fracPart = ""] = (neg ? s.slice(1) : s).split(".");
  const frac = (fracPart + "0".repeat(decimals)).slice(0, decimals);
  const v = BigInt((intPart || "0") + frac);
  return neg ? -v : v;
}

export function formatUnits(value: bigint, decimals: number, maxFrac = decimals): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const s = v.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).slice(0, maxFrac).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

export const parseWad = (v: string) => parseUnits(v, 18);
export const formatWad = (v: bigint, maxFrac = 18) => formatUnits(v, 18, maxFrac);

/** Protocol fee on a USDT notional, exactly as the contracts compute it (floor). */
export function feeOn(notional: bigint, bps: number | bigint): bigint {
  return (notional * BigInt(bps)) / BPS;
}
