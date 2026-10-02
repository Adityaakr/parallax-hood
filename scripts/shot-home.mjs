import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await p.goto("http://127.0.0.1:3100/", { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
await p.waitForTimeout(4000);
await p.screenshot({ path: "/tmp/home-hero.png", clip: { x: 0, y: 420, width: 1440, height: 560 } });
// scroll to the counters
await p.evaluate(() => window.scrollTo(0, 2600));
await p.waitForTimeout(2500);
await p.screenshot({ path: "/tmp/home-counters.png" });
await b.close();
