#!/usr/bin/env node
/**
 *   monitor once     run every check, print the report, exit 1 if anything is critical
 *   monitor watch    run every MONITOR_INTERVAL_S and serve the last report at :MONITOR_PORT/health
 */
import { createServer } from "node:http";
import { createPublicClient, http, type PublicClient } from "viem";
import { loadConfig } from "./config.js";
import { Monitor, type Report } from "./monitor.js";

const cfg = loadConfig();
const client = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpcUrl, { retryCount: 5, retryDelay: 500 }), batch: cfg.chain.contracts?.multicall3 ? { multicall: { wait: 16 } } : undefined }) as PublicClient;
const monitor = new Monitor(cfg, client);
const print = (r: Report) => {
  console.log(`${new Date(r.at * 1000).toISOString()} ${r.network} (${r.chainId})${r.deployed ? "" : ", Parallax not deployed here"}: ${r.worst.toUpperCase()}`);
  for (const f of r.findings) if (f.severity !== "ok" || process.env.VERBOSE) console.log(`  [${f.severity}] ${f.check} ${f.subject}: ${f.detail}`);
};

const mode = process.argv[2] ?? "once";
if (mode === "once") {
  const r = await monitor.run();
  if (process.argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
  else print(r);
  process.exit(r.worst === "critical" ? 1 : 0);
} else if (mode === "watch") {
  let last: Report | null = null;
  const tick = async () => {
    try {
      last = await monitor.run();
      print(last);
    } catch (e) {
      console.error(`check failed: ${(e as Error).message}`);
    }
  };
  createServer((_req, res) => {
    res.writeHead(last && last.worst !== "critical" ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify(last ?? { worst: "unknown", findings: [] }));
  }).listen(cfg.MONITOR_PORT);
  await tick();
  setInterval(tick, cfg.MONITOR_INTERVAL_S * 1000);
} else {
  console.error("usage: monitor once [--json] | monitor watch");
  process.exit(2);
}
