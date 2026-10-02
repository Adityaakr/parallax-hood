/**
 * Computed US equity regular-session hours (NYSE/Nasdaq): Mon–Fri 09:30–16:00 America/New_York, minus holidays.
 * Used only as a labeled fallback when the Binance `statusInfo` is unavailable. Source: "computed".
 */
const HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);
const HOLIDAYS_2027 = new Set(["2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24"]);
const HOLIDAYS = new Set([...HOLIDAYS_2026, ...HOLIDAYS_2027]);

function nyParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday as string };
}

function isTradingDay(ymd: string, weekday: string) {
  return weekday !== "Sat" && weekday !== "Sun" && !HOLIDAYS.has(ymd);
}

export type MarketStatus = { open: boolean; nextOpenTime: number | null; nextCloseTime: number | null; source: "computed" | "binance" | "registry"; reason?: string };

export function computedMarketStatus(now = new Date()): MarketStatus {
  const { ymd, minutes, weekday } = nyParts(now);
  const OPEN = 9 * 60 + 30, CLOSE = 16 * 60;
  const trading = isTradingDay(ymd, weekday);
  if (trading && minutes >= OPEN && minutes < CLOSE) {
    return { open: true, nextOpenTime: null, nextCloseTime: nyTime(now, ymd, CLOSE), source: "computed" };
  }
  // find next open: today (if before open) or the next trading day
  let cursor = new Date(now);
  for (let i = 0; i < 10; i++) {
    const p = nyParts(cursor);
    if (isTradingDay(p.ymd, p.weekday) && (i > 0 || p.minutes < OPEN)) {
      return { open: false, nextOpenTime: nyTime(cursor, p.ymd, OPEN), nextCloseTime: null, source: "computed", reason: trading ? "OUTSIDE_SESSION" : "MARKET_CLOSED" };
    }
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
  }
  return { open: false, nextOpenTime: null, nextCloseTime: null, source: "computed", reason: "MARKET_CLOSED" };
}

/** Unix ms for `ymd` at `minutes` past midnight New York time (DST-aware via iterative offset). */
function nyTime(ref: Date, ymd: string, minutes: number): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  let guess = Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60);
  for (let i = 0; i < 3; i++) {
    const p = nyParts(new Date(guess));
    const got = p.minutes + (p.ymd === ymd ? 0 : p.ymd > ymd ? 24 * 60 : -24 * 60);
    guess -= (got - minutes) * 60_000;
  }
  return guess;
}
