/* Render the README's mermaid diagram the way GitHub does, to catch a syntax error before it ships. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const md = readFileSync("../README.md", "utf8");
const code = md.split("```mermaid")[1].split("```")[0];
const b = await chromium.launch();
const p = await b.newPage({ viewportSize: { width: 1200, height: 900 }, deviceScaleFactor: 2 });
await p.setContent(`<body style="margin:0;background:#fff;padding:20px">
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: false, theme: "neutral" });
try { const { svg } = await mermaid.render("g", ${JSON.stringify(code)}); document.body.innerHTML = svg; document.title = "ok"; }
catch (e) { document.body.textContent = "MERMAID ERROR: " + e.message; document.title = "err"; }
</script></body>`);
await p.waitForTimeout(6000);
console.log(await p.title(), "|", (await p.textContent("body")).slice(0, 160));
await p.screenshot({ path: "/tmp/readme-diagram.png", fullPage: true });
await b.close();
