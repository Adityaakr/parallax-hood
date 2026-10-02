/**
 * When the reference price moves. Chainlink's Robinhood stock feeds run on the "us_equities_24/5" schedule
 * (the `marketHours` field of each feed in Chainlink's feed directory): continuously from Sunday 20:00 to
 * Friday 20:00 New York time, paused over the weekend. Inside that window the reference is live and a quote can
 * be checked against it; outside it the pools keep trading against a price that last moved on Friday, which is
 * the case the closed-market premium cap exists for. Computed, and labelled "computed": no on-chain source says
 * whether the session is open, and exchange holidays are not modelled.
 */
const WEEK_OPEN = { weekday: "Sun", minutes: 20 * 60 };
const WEEK_CLOSE = { weekday: "Fri", minutes: 20 * 60 };
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nyParts(d: Date) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { minutes: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday as string };
}

/** Minutes since Sunday 00:00 New York time. */
function weekMinutes(d: Date) {
  const { weekday, minutes } = nyParts(d);
  return DAYS.indexOf(weekday) * 1440 + minutes;
}

export type MarketStatus = { open: boolean; nextOpenTime: number | null; nextCloseTime: number | null; source: "computed" | "registry"; reason?: string };

export function computedMarketStatus(now = new Date()): MarketStatus {
  const at = weekMinutes(now);
  const opens = DAYS.indexOf(WEEK_OPEN.weekday) * 1440 + WEEK_OPEN.minutes;
  const closes = DAYS.indexOf(WEEK_CLOSE.weekday) * 1440 + WEEK_CLOSE.minutes;
  const open = at >= opens && at < closes;
  // Whole minutes until the boundary. A daylight-saving change inside the gap moves it by an hour, which is
  // acceptable for a label that says "computed" and is never used to gate a transaction on its own.
  const until = (target: number) => now.getTime() + ((target - at + 10_080) % 10_080) * 60_000;
  return open
    ? { open: true, nextOpenTime: null, nextCloseTime: until(closes), source: "computed" }
    : { open: false, nextOpenTime: until(opens), nextCloseTime: null, source: "computed", reason: "WEEKEND" };
}
