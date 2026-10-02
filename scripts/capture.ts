/**
 * Phase 0 recon. Crawls a site, then for every page found:
 *   - saves rendered HTML to .recon/html/<route>.html
 *   - full-page screenshots at 1440x900, 768x1024 and 390x844 to .recon/shots/<route>-<width>.png
 *   - one screenshot per top-level <section> (scrolled into view, appear effects settled) to
 *     .recon/shots/sections/<route>-<width>-<n>-<name>.png
 *   - getComputedStyle for every visible element to .recon/styles/<route>-<width>.json
 *   - every image, video, SVG and font the page loads to public/assets/
 *
 *   BASE=https://syncrun.framer.website pnpm --filter @parallax-hood/scripts capture
 *   BASE=http://127.0.0.1:3100 pnpm --filter @parallax-hood/scripts capture     # later, against the rebuild
 *
 * Framer renders appear effects on scroll, so each section is scrolled to and given time to settle before
 * it is shot, and the full-page shot is taken after a slow scroll to the bottom and back.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.env.BASE ?? "https://syncrun.framer.website").replace(/\/$/, "");
const OUT = resolve(ROOT, process.env.RECON_DIR ?? ".recon");
const ASSETS = resolve(ROOT, process.env.ASSETS_DIR ?? "apps/web/public/assets");
const WIDTHS: [number, number][] = [[1440, 900], [768, 1024], [390, 844]];
const STYLE_PROPS = ["font-family", "font-size", "font-weight", "line-height", "letter-spacing", "color", "background-color", "background-image", "border-radius", "border", "padding", "margin", "gap", "box-shadow", "transform", "transition", "opacity", "display", "flex-direction", "align-items", "justify-content", "width", "height", "max-width", "position", "top", "z-index", "backdrop-filter", "text-transform", "text-align"];

for (const d of ["html", "shots", "shots/sections", "styles"]) mkdirSync(resolve(OUT, d), { recursive: true });
for (const d of ["images", "fonts", "video", "svg", "other"]) mkdirSync(resolve(ASSETS, d), { recursive: true });

const routeName = (path: string) => (path === "/" ? "home" : path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/-+$/, "")) || "home";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** scroll the page to the bottom slowly so every on-scroll appear effect has fired, then return to top */
async function settle(page: Page) {
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight;
    for (let y = 0; y < h; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 90)); }
    window.scrollTo(0, h);
    await new Promise((r) => setTimeout(r, 400));
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 400));
  });
}

/** internal links on the page: nav and footer first, then (with `all`) every anchor, for CMS detail pages */
async function crawlLinks(page: Page, all = false): Promise<string[]> {
  return page.evaluate(([base, all]) => {
    const out = new Set<string>(["/"]);
    const sel = all ? "a[href]" : "nav a, header a, footer a, [data-framer-name*='Navigation' i] a, [data-framer-name*='Footer' i] a";
    for (const a of Array.from(document.querySelectorAll(sel))) {
      const href = (a as HTMLAnchorElement).getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      try {
        const u = new URL(href, base);
        if (u.origin !== new URL(base).origin) continue;
        const p = u.pathname.replace(/\/$/, "") || "/";
        out.add(p);
      } catch { /* ignore */ }
    }
    return Array.from(out);
  }, [BASE, all] as const);
}

const seenAssets = new Set<string>();
function assetBucket(url: string, ct: string) {
  const ext = extname(new URL(url).pathname).toLowerCase();
  if (ct.includes("font") || [".woff", ".woff2", ".ttf", ".otf"].includes(ext)) return "fonts";
  if (ct.includes("svg") || ext === ".svg") return "svg";
  if (ct.startsWith("video") || [".mp4", ".webm", ".mov"].includes(ext)) return "video";
  if (ct.startsWith("image") || [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"].includes(ext)) return "images";
  return null;
}

async function capturePage(path: string) {
  const name = routeName(path);
  const browser = await chromium.launch();
  const manifest: Record<string, string> = {};
  try {
    for (const [w, h] of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36" });
      const page = await ctx.newPage();
      // every asset the page pulls is saved under public/assets/<bucket>/<original filename>
      page.on("response", async (res) => {
        try {
          const url = res.url();
          if (seenAssets.has(url) || !res.ok()) return;
          const bucket = assetBucket(url, res.headers()["content-type"] ?? "");
          if (!bucket) return;
          seenAssets.add(url);
          const file = decodeURIComponent(new URL(url).pathname.split("/").pop() || "asset") || "asset";
          const target = resolve(ASSETS, bucket, file);
          if (!existsSync(target)) writeFileSync(target, await res.body());
          manifest[url] = `assets/${bucket}/${file}`;
        } catch { /* a failed body read is not fatal to the capture */ }
      });
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle", timeout: 90_000 });
      await sleep(800);
      await settle(page);

      if (w === 1440) writeFileSync(resolve(OUT, "html", `${name}.html`), await page.content());
      await page.screenshot({ path: resolve(OUT, "shots", `${name}-${w}.png`), fullPage: true });

      // per-section shots: Framer's sections are the direct children of the page's main frame
      const sections = await page.evaluate(() => {
        const root = document.querySelector("#main") ?? document.body;
        const kids = Array.from(root.querySelectorAll(":scope > div > section, :scope > section, section")).filter((s) => (s as HTMLElement).offsetHeight > 40);
        return kids.map((s, i) => ({ i, name: (s.getAttribute("data-framer-name") ?? s.id ?? `section-${i}`).replace(/[^a-z0-9]+/gi, "-").toLowerCase(), top: (s as HTMLElement).getBoundingClientRect().top + window.scrollY, height: (s as HTMLElement).offsetHeight }));
      });
      for (const s of sections) {
        await page.evaluate((top) => window.scrollTo(0, Math.max(0, top - 20)), s.top);
        await sleep(900);
        const el = page.locator("section").nth(s.i);
        try { await el.screenshot({ path: resolve(OUT, "shots", "sections", `${name}-${w}-${String(s.i).padStart(2, "0")}-${s.name}.png`), timeout: 30_000 }); } catch { /* offscreen or zero-size */ }
      }

      // computed styles for every visible element
      await page.evaluate(() => window.scrollTo(0, 0));
      const styles = await page.evaluate((props) => {
        const out: Record<string, unknown>[] = [];
        const walk = (el: Element, path: string) => {
          const r = (el as HTMLElement).getBoundingClientRect?.();
          // zero-size wrappers still have visible descendants (Framer nests absolutely positioned children
          // under 0-height frames), so recurse regardless and only skip recording the wrapper itself
          if (r && r.width > 0 && r.height > 0) record(el, r, path);
          Array.from(el.children).forEach((c, i) => walk(c, `${path}/${c.tagName.toLowerCase()}[${i}]`));
        };
        const record = (el: Element, r: DOMRect, path: string) => {
          const cs = getComputedStyle(el);
          const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim()).filter(Boolean).join(" ").slice(0, 80);
          const rec: Record<string, unknown> = { path, tag: el.tagName.toLowerCase(), name: el.getAttribute("data-framer-name") ?? undefined, text: text || undefined, rect: { x: Math.round(r.x + window.scrollX), y: Math.round(r.y + window.scrollY), w: Math.round(r.width), h: Math.round(r.height) } };
          for (const p of props) { const v = cs.getPropertyValue(p); if (v && v !== "none" && v !== "normal" && v !== "auto" && v !== "0px" && v !== "rgba(0, 0, 0, 0)") rec[p] = v; }
          out.push(rec);
        };
        walk(document.body, "body");
        return out;
      }, STYLE_PROPS);
      writeFileSync(resolve(OUT, "styles", `${name}-${w}.json`), JSON.stringify(styles, null, 1));
      console.log(`  ${name} @${w}: ${sections.length} sections, ${styles.length} elements`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return manifest;
}

async function main() {
  console.log(`recon of ${BASE} -> ${OUT}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90_000 });
  const routes = await crawlLinks(page);
  // one level deeper: article and changelog detail pages are linked from cards, not from the nav
  for (const r of [...routes]) {
    await page.goto(`${BASE}${r}`, { waitUntil: "networkidle", timeout: 90_000 });
    for (const l of await crawlLinks(page, true)) if (!routes.includes(l)) routes.push(l);
  }
  await browser.close();
  console.log(`routes: ${routes.join(" ")}`);
  const manifest: Record<string, string> = {};
  const only = process.env.ROUTES?.split(",").map((x) => x.trim()).filter(Boolean);
  for (const r of routes) if (!only || only.includes(r)) Object.assign(manifest, await capturePage(r));
  writeFileSync(resolve(OUT, "assets.json"), JSON.stringify(manifest, null, 1));
  writeFileSync(resolve(OUT, "routes.json"), JSON.stringify(routes, null, 1));
  console.log(`assets: ${Object.keys(manifest).length} files -> ${ASSETS}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
