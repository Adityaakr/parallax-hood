import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:3100/baskets/pxAI", { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
await p.waitForTimeout(6000);
const el = p.locator("table.grid").first().locator("xpath=..");
await el.screenshot({ path: "/tmp/vault.png" });
await b.close();
