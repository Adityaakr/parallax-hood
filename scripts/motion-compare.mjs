/** Frames of the hero entrance at 0/200/400/700/1000/1500ms and marquee displacement, reference vs build. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = "/Users/adityakrx/parallax/.recon/motion"; mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
for (const [name, base] of [["ref", "https://syncrun.framer.website"], ["build", "http://127.0.0.1:3100"]]) {
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  await p.goto(base + "/", { waitUntil: "commit" });
  const t0 = Date.now(); const times = [200, 450, 700, 1000, 1500];
  for (const t of times) { const wait = t - (Date.now() - t0); if (wait > 0) await p.waitForTimeout(wait); await p.screenshot({ path: `${OUT}/${name}-hero-${t}.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } }); }
  await p.waitForLoadState("networkidle");
  // marquee displacement over 2s
  const sel = name === "ref" ? "[data-framer-name='Logos Wrapper'] [data-framer-name='Default']" : ".logos > div";
  await p.evaluate(() => window.scrollTo(0, 600)); await p.waitForTimeout(1000);
  const x1 = await p.evaluate((s) => document.querySelector(s).getBoundingClientRect().x, sel); await p.waitForTimeout(2000);
  const x2 = await p.evaluate((s) => document.querySelector(s).getBoundingClientRect().x, sel);
  const sel2 = name === "ref" ? "[data-framer-name='Reviews Ticker'] [data-framer-name='Primary']" : ".ticker > .review";
  await p.evaluate(() => window.scrollTo(0, 6600)); await p.waitForTimeout(1000);
  const y1 = await p.evaluate((s) => document.querySelector(s).getBoundingClientRect().x, sel2); await p.waitForTimeout(2000);
  const y2 = await p.evaluate((s) => document.querySelector(s).getBoundingClientRect().x, sel2);
  // nav state + hover on a button
  await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500);
  const btn = name === "ref" ? "[data-framer-name='Buttons'] a" : ".buttons .btn";
  await p.hover(btn); await p.waitForTimeout(450);
  await p.screenshot({ path: `${OUT}/${name}-button-hover.png`, clip: { x: 500, y: 430, width: 440, height: 100 } });
  console.log(`${name}: logos ${((x1 - x2) / 2).toFixed(1)} px/s, ticker ${((y1 - y2) / 2).toFixed(1)} px/s`);
  await p.close();
}
await b.close();
