import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { loadConfig } from "./config.js";
import { Keeper } from "./keeper.js";

const [cmd = "run", ...rest] = process.argv.slice(2);
const dry = rest.includes("--dry-run") || process.env.KEEPER_DRY_RUN === "true";
const cfg = loadConfig();
const keeper = new Keeper(cfg, dry);

if (cmd === "plan") {
  // what a pass would send right now, why, and what it costs at the current gas price — never sends
  const planner = new Keeper(cfg, true);
  const runsPerDay = Number(rest.find((x) => x.startsWith("--runs="))?.slice(7) ?? 24);
  const [plan, fresh] = [await planner.plan(runsPerDay), await planner.freshness()];
  console.log(JSON.stringify({ chainId: cfg.CHAIN_ID, freshness: fresh, plan, alerts: planner.state.alerts.map((a) => a.msg) }, null, 1));
  process.exit(0);
} else if (cmd === "once") {
  await keeper.runAllOnce();
  console.log(JSON.stringify(keeper.state.lastRun, null, 1));
  process.exit(0);
} else if (cmd === "attest") {
  // keeper attest <platform> <ISO date> <source url>
  const [platform, date, source] = rest.filter((x) => !x.startsWith("--"));
  if (!platform || !date || !source) {
    console.error("usage: keeper attest <platform> <ISO date> <source url> [--dry-run]");
    process.exit(2);
  }
  const hash = await keeper.attestManual(platform, date, source);
  console.log(hash ?? "(dry-run)");
  process.exit(0);
} else if (cmd === "run") {
  keeper.start();
  const app = new Hono();
  app.get("/health", async (c) => c.json({ ok: true, dryRun: keeper.dryRun, chainId: cfg.CHAIN_ID, account: keeper.account?.address ?? null, binance: keeper.binance.mode, scope: cfg.KEEPER_SCOPE, spend: { ...keeper.state.spend, wei: keeper.state.spend.wei.toString() }, budgetStop: await keeper.budgetStop(), lastRun: keeper.state.lastRun, alerts: keeper.state.alerts.slice(-20), sent: keeper.state.sent.slice(-20), intents: keeper.dryRun ? keeper.state.intents.slice(-50) : undefined }));
  serve({ fetch: app.fetch, port: cfg.KEEPER_PORT }, (i) => console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", scope: "keeper", msg: "health on", port: i.port })));
} else {
  console.error(`unknown command ${cmd}; use run | once | plan | attest`);
  process.exit(2);
}
