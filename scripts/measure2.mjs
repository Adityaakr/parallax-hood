import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1000 } });
await p.goto("http://127.0.0.1:3100/baskets/pxAI", { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
await p.waitForTimeout(5000);
console.log(await p.evaluate(() => {
  const t = document.querySelector("table.grid");
  const ths = [...t.querySelectorAll("thead th")].map((th) => [th.textContent.trim().slice(0, 22), Math.round(th.getBoundingClientRect().width)]);
  const cell = t.querySelector("tbody tr td:last-child");
  return { ths, lastCellScroll: cell?.scrollWidth, lastCellClient: cell?.clientWidth };
}));
await b.close();
