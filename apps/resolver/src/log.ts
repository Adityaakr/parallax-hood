const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;
let current: Level = (process.env.LOG_LEVEL as Level) ?? "info";
export function setLogLevel(l: Level) {
  current = l;
}
function emit(level: Level, scope: string, msg: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < LEVELS[current]) return;
  const line = { ts: new Date().toISOString(), level, scope, msg, ...(extra ?? {}) };
  const out = JSON.stringify(line, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  (level === "error" || level === "warn" ? console.error : console.log)(out);
}
export const logger = (scope: string) => ({
  debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", scope, msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => emit("info", scope, msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", scope, msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => emit("error", scope, msg, extra),
});
