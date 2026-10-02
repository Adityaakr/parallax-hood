export const fmt = (v: string | bigint | number | null | undefined, dec = 18, max = 4): string => {
  if (v === null || v === undefined) return "n/a";
  const b = typeof v === "bigint" ? v : BigInt(typeof v === "number" ? Math.trunc(v) : v);
  const neg = b < 0n;
  const s = (neg ? -b : b).toString().padStart(dec + 1, "0");
  const int = s.slice(0, s.length - dec);
  const frac = s.slice(s.length - dec).slice(0, max).replace(/0+$/, "");
  return `${neg ? "-" : ""}${Number(int).toLocaleString("en-US")}${frac ? "." + frac : ""}`;
};
/** Big figures the way a terminal writes them: $110.9B, $1.2T, 196.6k. */
export const compactUsd = (v: number | null | undefined) =>
  v === null || v === undefined ? "n/a" : `$${Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v)}`;

export const usd = (v: string | number | null | undefined, max = 2) => (v === null || v === undefined || v === "" ? "n/a" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: Math.min(2, max), maximumFractionDigits: max })}`);
export const bps = (v: number | null | undefined) => (v === null || v === undefined ? "n/a" : `${v > 0 ? "+" : ""}${v} bps`);
export const short = (a: string, n = 6) => `${a.slice(0, n)}…${a.slice(-4)}`;
export const ago = (ts: number | null | undefined) => {
  if (!ts) return "n/a";
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${(s / 3600).toFixed(1)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};
export const hours = (h: number | null | undefined) => (h === null || h === undefined ? "unknown" : `${h.toFixed(1)}h`);
export const dt = (ms: number | null | undefined) => (ms ? new Date(ms).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" }) + " ET" : "n/a");
