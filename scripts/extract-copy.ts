/**
 * Walks each captured page in the reference and writes its text, links and images per section to
 * .recon/copy/<route>.json, in DOM order, so components can be written from data rather than by hand.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.BASE ?? "https://syncrun.framer.website";
const routes: string[] = JSON.parse(readFileSync(resolve(ROOT, ".recon/routes.json"), "utf8"));
mkdirSync(resolve(ROOT, ".recon/copy"), { recursive: true });
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
for (const r of routes) {
  await p.goto(`${BASE}${r}`, { waitUntil: "networkidle", timeout: 90_000 });
  await p.evaluate(async () => { const h = document.documentElement.scrollHeight; for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise((res) => setTimeout(res, 40)); } window.scrollTo(0, 0); });
  const data = await p.evaluate(() => {
    const name = (el: Element) => el.getAttribute("data-framer-name") ?? "";
    const walk = (el: Element): any => {
      const kids = Array.from(el.children).map(walk).filter(Boolean);
      const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim()).filter(Boolean).join(" ");
      const node: any = {};
      const n = name(el); if (n) node.name = n;
      if (el.tagName === "A") { node.href = el.getAttribute("href"); }
      if (el.tagName === "IMG") { node.img = (el as HTMLImageElement).currentSrc || el.getAttribute("src"); node.alt = el.getAttribute("alt") ?? ""; }
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") { node.placeholder = el.getAttribute("placeholder"); node.type = el.getAttribute("type"); node.inputName = el.getAttribute("name"); }
      if (el.tagName === "SVG" || el.tagName === "svg") { node.svg = true; }
      const bg = (el as HTMLElement).style?.backgroundImage; if (bg && bg !== "none") node.bg = bg;
      if (own) node.text = own;
      if (kids.length) node.kids = kids;
      if (!node.text && !node.kids && !node.img && !node.href && !node.placeholder) return null;
      // collapse pass-through wrappers
      if (!node.text && !node.img && !node.href && !node.placeholder && node.kids?.length === 1 && !node.name) return node.kids[0];
      return node;
    };
    const sections = Array.from(document.querySelectorAll("section, nav, footer, header")).filter((s) => !s.closest("section, nav, footer, header") || s.tagName === "SECTION" && s.parentElement?.closest("section") === null);
    const main = document.querySelector("#main") ?? document.body;
    const tops = Array.from(main.querySelectorAll("section")).filter((s) => !s.parentElement?.closest("section"));
    const nav = document.querySelector("nav") ?? document.querySelector("[data-framer-name*='Navbar' i]");
    const footer = document.querySelector("footer") ?? document.querySelector("[data-framer-name*='Footer' i]");
    return { title: document.title, description: document.querySelector("meta[name=description]")?.getAttribute("content"), nav: nav ? walk(nav) : null, sections: tops.map((s) => ({ name: name(s) || s.id, id: s.id, tree: walk(s) })), footer: footer ? walk(footer) : null };
  });
  const file = (r === "/" ? "home" : r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-")) + ".json";
  writeFileSync(resolve(ROOT, ".recon/copy", file), JSON.stringify(data, null, 1));
  console.log(r, "->", file, data.sections.map((s: any) => s.name).join(", "));
}
await b.close();
