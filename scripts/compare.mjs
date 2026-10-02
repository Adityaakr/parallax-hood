/** Side-by-side: reference | build, per section, for a route and width. */
import { chromium } from "playwright";
import { existsSync, mkdirSync } from "node:fs";
const [route = "home", width = "1440"] = process.argv.slice(2);
const R = "/Users/adityakrx/parallax/.recon";
mkdirSync(`${R}/compare`, { recursive: true });
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
const pairs = [];
for (let i = 0; i < 12; i++) {
  const ref = `${R}/shots/${route}-${width}.png`; const bld = `${R}/build/shots/${route}-${width}.png`;
  if (!existsSync(bld)) break;
  pairs.push([ref, bld]); break;
}
for (const [ref, bld] of pairs) {
  await p.setContent(`<body style="margin:0;background:#888;display:flex;gap:8px;align-items:flex-start"><img src="file://${ref}" style="width:596px"><img src="file://${bld}" style="width:596px"></body>`);
  await p.waitForTimeout(400);
  await p.screenshot({ path: `${R}/compare/${route}-${width}.png`, fullPage: true });
}
await b.close(); console.log("wrote", `${R}/compare/${route}-${width}.png`);
