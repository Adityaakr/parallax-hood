import { keccak256, toHex, type Hex } from "viem";

/** Canonical JSON: sorted keys, bigint -> string. The hash of this is the onchain `quoteHash`. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(sortKeys(v));
}
function sortKeys(v: unknown): unknown {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}
export function quoteHashOf(record: unknown): Hex {
  return keccak256(toHex(canonicalJson(record)));
}
