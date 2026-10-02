/**
 * Screenshots of product pages on a running web app, past the eligibility gate.
 *   BASE=http://localhost:3000 OUT=.fork/shots pnpm --filter @parallax-hood/scripts exec tsx e2e/shot.mts /stocks /buy/NVDA
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const BASE = process.env.BASE ?? "http://127.0.0.1:3200";
const OUT = resolve(process.env.OUT ?? ".fork/shots");
const WAIT_MS = Number(process.env.WAIT_MS ?? 9000);
const paths = process.argv.slice(2).filter((a) => a.startsWith("/"));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript({ content: `try { localStorage.setItem("parallax-hood:eligibility", "1"); } catch {}` });
for (const path of paths.length ? paths : ["/stocks"]) {
  const page = await context.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(WAIT_MS);
  const file = resolve(OUT, `${path.replace(/^\//, "").replace(/[^a-zA-Z0-9]+/g, "-") || "home"}.png`);
  await page.screenshot({ path: file, fullPage: true });
  console.log(file);
  await page.close();
}
await browser.close();
