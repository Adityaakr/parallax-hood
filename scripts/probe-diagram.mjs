import { chromium } from "playwright";
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1440, height: 1200 } });
await p.goto("http://127.0.0.1:3100/blog/how-an-order-travels", { waitUntil: "networkidle", timeout: 180000 }).catch(() => {});
await p.waitForTimeout(3000);
console.log(await p.evaluate(() => {
  const f = document.querySelector("figure.diagram");
  const svg = f?.querySelector("svg");
  const t = svg?.querySelector("text");
  const cs = t ? getComputedStyle(t) : null;
  return {
    figure: f ? f.getBoundingClientRect().height : null,
    svgBox: svg ? [svg.getBoundingClientRect().width, svg.getBoundingClientRect().height] : null,
    texts: svg?.querySelectorAll("text").length,
    firstText: t?.textContent,
    fill: cs?.fill, opacity: cs?.opacity, font: cs?.fontFamily,
    parentOpacity: f ? getComputedStyle(f.closest("[style]") ?? f).opacity : null,
  };
}));
await b.close();
