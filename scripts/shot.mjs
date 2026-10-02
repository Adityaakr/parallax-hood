/** Screenshot one element or clip of the build: node shot.mjs <route> <width> <selector|footer|nav-top|nav-scrolled|menu> <out> */
import { chromium } from "playwright";
const [route = "/", width = "1440", what = "footer", out = "/tmp/shot.png", base = "http://127.0.0.1:3100"] = process.argv.slice(2);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +width, height: 900 } });
await p.goto(base + route, { waitUntil: "networkidle" });
await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 300) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } });
await p.waitForTimeout(600);
if (what === "footer") await p.locator("footer").first().screenshot({ path: out });
else if (what === "nav-top") { await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(700); await p.screenshot({ path: out, clip: { x: 0, y: 0, width: +width, height: 120 } }); }
else if (what === "nav-scrolled") { await p.evaluate(() => window.scrollTo(0, 1400)); await p.waitForTimeout(700); await p.screenshot({ path: out, clip: { x: 0, y: 0, width: +width, height: 120 } }); }
else if (what === "menu") { await p.evaluate(() => window.scrollTo(0, 0)); await p.locator(".burger").click(); await p.waitForTimeout(600); await p.screenshot({ path: out }); }
else if (what.startsWith("y=")) { const y = +what.slice(2); await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(700); await p.screenshot({ path: out }); }
else await p.locator(what).first().screenshot({ path: out });
await b.close(); console.log("wrote", out);
