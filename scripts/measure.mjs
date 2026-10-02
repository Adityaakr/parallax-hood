import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1000 } });
await p.goto("http://127.0.0.1:3100/baskets/pxAI", { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
await p.waitForTimeout(5000);
const m = await p.evaluate(() => {
  const t = document.querySelector("table.grid");
  const wrap = t?.parentElement;
  return { table: t?.scrollWidth, wrap: wrap?.clientWidth, overflow: (t?.scrollWidth ?? 0) - (wrap?.clientWidth ?? 0) };
});
console.log(m);
await b.close();
