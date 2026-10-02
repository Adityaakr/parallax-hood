import { chromium } from "playwright";
const slugs = ["two-tokens-one-stock", "slippage-in-shares", "how-an-order-travels", "backing-invariant", "agent-mandates", "shipping-to-mainnet"];
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1000 } });
const internal = new Set(), external = new Set();
for (const s of slugs) {
  await p.goto(`http://127.0.0.1:3100/blog/${s}`, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  const hrefs = await p.$$eval(".article-body a", (as) => as.map((a) => a.getAttribute("href")));
  console.log(s.padEnd(22), hrefs.length, "links");
  for (const h of hrefs) (h.startsWith("/") ? internal : external).add(h);
}
console.log("\ninternal routes:");
for (const h of [...internal].sort()) {
  const r = await p.goto(`http://127.0.0.1:3100${h}`, { waitUntil: "domcontentloaded", timeout: 120000 }).catch(() => null);
  console.log(" ", (r?.status() ?? "ERR"), h);
}
console.log("\nexternal:");
for (const h of [...external].sort()) console.log("  ", h);
await b.close();
