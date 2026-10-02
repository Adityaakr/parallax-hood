import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:3100/baskets/pxNEW", { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
await p.waitForTimeout(5000);
for (const [name, sel] of [["stats", ".stat"], ["perf", "section.panel"], ["assets", "h2.h5"]]) {
  const el = name === "assets" ? p.locator("h2.h5", { hasText: "Assets" }).locator("xpath=..").locator("xpath=..") : p.locator(sel).first().locator("xpath=..");
  await el.first().screenshot({ path: `/tmp/pxnew-${name}.png` }).catch((e) => console.log(name, "skip", e.message.slice(0, 60)));
}
await b.close();
