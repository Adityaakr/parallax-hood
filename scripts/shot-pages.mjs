import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1100 }, deviceScaleFactor: 2 });
for (const [path, name, clip] of [["/baskets", "baskets", { x: 0, y: 120, width: 1440, height: 620 }], ["/baskets/pxMAG7", "detail", { x: 900, y: 240, width: 540, height: 700 }]]) {
  await p.goto(`http://127.0.0.1:3100${path}`, { waitUntil: "networkidle", timeout: 90000 }).catch(() => {});
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `/tmp/${name}.png`, clip });
}
await b.close();
