/**
 * Cover art for the build notes.
 *
 * The posts shipped with the template's stock photographs, a blurred car and a mountain, which say nothing about
 * what is in them. Each cover is now a specimen of the one artifact its post is about, drawn in the site's own
 * language: the sand field, the dashed rules, Libre Caslon for the line that carries the idea, Switzer for the
 * numerals, Fragment Mono for labels. Every figure on them is a number that already appears in the post, which
 * is itself re-derived from a recorded run or an onchain read.
 *
 * Rendered through the running dev server so the real @font-face files load from the same origin:
 *   pnpm --filter @parallax-hood/web dev      # :3100
 *   node scripts/gen-covers.mjs          # writes apps/web/public/assets/images/cover-<slug>.png
 *
 * The hero renders these at 1206x640 and the article card crops to 377x230, so nothing that matters sits
 * outside the middle 86% of the width.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = resolve(ROOT, "apps/web");
const BASE = process.env.BASE ?? "http://127.0.0.1:3100";
const W = 1206;
const H = 640;

/* the site's own @font-face block, reused verbatim so the covers are set in the same metal as the pages */
const css = readFileSync(resolve(WEB, "app/globals.css"), "utf8");
const faces = css.match(/@font-face\s*\{[^}]*\}/g)?.join("\n") ?? "";

const shell = (post, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
${faces}
:root{
  --bg:#f7f5f3; --sand:#eeeae6; --card:#ffffff; --ink:#1a1a1a; --heading:#262626; --soft:#4f4f4f;
  --brand:#f24100; --line:#d6d0c8; --good:#1f7a45; --bad:#c22f22;
  --serif:"Libre Caslon Condensed",serif; --sans:"Public Sans",sans-serif;
  --num:"Switzer",sans-serif; --mono:"Fragment Mono",monospace;
}
*{margin:0;padding:0;box-sizing:border-box;-webkit-font-smoothing:antialiased}
body{width:${W}px;height:${H}px;background:var(--bg);font-family:var(--sans);color:var(--heading);overflow:hidden;position:relative}
.rails{position:absolute;inset:0;pointer-events:none}
.rails i{position:absolute;top:0;bottom:0;width:1px;border-left:1px dashed var(--line);opacity:.75}
.rails i:nth-child(1){left:92px}.rails i:nth-child(2){right:92px}
/* one warm bloom so the field is not flat, kept off the reading area */
.glow{position:absolute;right:-160px;bottom:-240px;width:700px;height:700px;border-radius:50%;
  background:radial-gradient(circle,rgba(242,65,0,.17),rgba(242,65,0,0) 62%)}
/* 108px of gutter: the article card crops this to 377x230, which cuts 78px off each side */
.frame{position:absolute;inset:0;padding:40px 108px 36px;display:flex;flex-direction:column}
.top{display:flex;align-items:center;justify-content:space-between;font-family:var(--mono);font-size:12px;
  letter-spacing:.14em;text-transform:uppercase;color:#8b857e}
.cat{display:flex;align-items:center;gap:10px;color:var(--ink)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--brand);box-shadow:0 0 0 4px rgba(242,65,0,.14)}
h1{font-family:var(--serif);font-weight:400;letter-spacing:-.5px;color:var(--ink)}
.sub{font-size:14.5px;line-height:1.55;color:var(--soft);margin-top:14px}
.main{flex:1;display:flex;min-height:0}
.main.split{align-items:center;gap:40px;padding:22px 0}
.main.split .txt{width:322px;flex:none}
.main.split .txt h1{font-size:40px;line-height:1.06}
.main.split .fig{flex:1;min-width:0;display:flex;align-items:center;justify-content:flex-end}
.main.split .fig>.card{width:100%}
.main.stack{flex-direction:column;justify-content:center;padding:14px 0 6px}
.main.stack h1{font-size:42px;line-height:1.06;max-width:840px}
.main.stack .sub{max-width:720px}
.main.stack .fig{margin-top:30px;width:100%}
.bottom{display:flex;align-items:flex-end;justify-content:space-between;font-family:var(--mono);font-size:11px;
  letter-spacing:.12em;text-transform:uppercase;color:#8b857e}
.wordmark{font-family:var(--serif);font-size:19px;letter-spacing:.02em;text-transform:none;color:var(--ink)}
.card{background:var(--card);border:1px solid rgba(0,0,0,.05);border-radius:12px;
  box-shadow:0 1px 0 rgba(0,0,0,.03),0 20px 48px -30px rgba(26,26,26,.5)}
.row{display:flex;align-items:center;gap:18px;padding:16px 24px}
.row+.row{border-top:1px dashed var(--line)}
.head{font-family:var(--mono);font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:#8b857e;
  padding:13px 24px;border-bottom:1px dashed var(--line)}
.t{display:grid;grid-template-columns:1.3fr .8fr .8fr .62fr;align-items:center;gap:0}
.t>span:nth-child(n+2){text-align:right}
.num{font-family:var(--num);font-weight:500;letter-spacing:-.4px;font-variant-numeric:tabular-nums}
.mono{font-family:var(--mono)}
.sym{font-family:var(--sans);font-weight:600;font-size:16px;letter-spacing:-.1px}
.tag{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);
  border:1px dashed var(--line);border-radius:30px;padding:3px 9px}
.good{color:var(--good)}.bad{color:var(--bad)}.brand{color:var(--brand)}.soft{color:var(--soft)}
.grow{flex:1}
.kicker{font-family:var(--mono);font-size:10.5px;letter-spacing:.13em;text-transform:uppercase;color:#8b857e}
</style></head><body>
<div class="glow"></div><div class="rails"><i></i><i></i></div>
<div class="frame">
  <div class="top"><span class="cat"><span class="dot"></span>${post.category}</span><span>${post.stamp}</span></div>
  ${
    post.layout === "split"
      ? `<div class="main split"><div class="txt"><h1>${post.headline}</h1><p class="sub">${post.sub}</p></div><div class="fig">${body}</div></div>`
      : `<div class="main stack"><h1>${post.headline}</h1><p class="sub">${post.sub}</p><div class="fig">${body}</div></div>`
  }
  <div class="bottom"><span class="wordmark">Parallax</span><span>${post.foot}</span></div>
</div></body></html>`;

/* Every number below appears in the post it illustrates. */
const COVERS = [
  {
    slug: "two-tokens-one-stock",
    layout: "split",
    sub: "NVIDIA exists twice on BNB Chain. The two tokens do not agree on what a share costs, and nothing arbitrages them into line.",
    category: "Recon",
    stamp: "NVDA · 17 Sep 2026 · mainnet fork",
    headline: "The same share, priced twice, 39&nbsp;bps apart.",
    foot: "resolver · $100 order · vs chainlink reference",
    body: `<div class="card">
      <div class="head t"><span>Representation</span><span>Shares / token</span><span>Cost / share</span><span>vs Chainlink</span></div>
      <div class="row t"><span class="sym" style="display:flex;align-items:center;gap:10px">NVDAB <span class="tag">bStocks</span></span>
        <span class="num" style="font-size:21px">1.000778</span>
        <span class="num" style="font-size:21px">$219.01</span>
        <span class="num brand" style="font-size:21px">&minus;8 bps</span></div>
      <div class="row t" style="opacity:.6"><span class="sym" style="display:flex;align-items:center;gap:10px">NVDAon <span class="tag">Ondo</span></span>
        <span class="num" style="font-size:21px">1.003701</span>
        <span class="num" style="font-size:21px">$219.88</span>
        <span class="num" style="font-size:21px">+31 bps</span></div>
      <div class="row" style="background:#fbfaf9;border-radius:0 0 12px 12px;padding:15px 24px">
        <span class="kicker">Spread</span>
        <span class="num grow brand" style="font-size:19px;text-align:right">39 bps</span>
        <span class="mono soft" style="font-size:11.5px">same stock, same block</span></div>
    </div>`,
  },
  {
    slug: "slippage-in-shares",
    layout: "stack",
    sub: "One token is not one share, so a minimum written in token units can be satisfied by a fill that is not what you asked for.",
    category: "Engineering",
    stamp: "ShareRouter.buyShares",
    headline: "A minimum in token units protects nothing.",
    foot: "shares = tokens × ratio / 1e18, rounded down",
    body: `<div style="display:flex;align-items:stretch;gap:22px;width:100%">
      <div class="card" style="flex:1">
        <div class="head">Ask for 2 shares of NVDA</div>
        <div class="row"><span class="sym" style="width:130px">2 NVDAB</span><span class="mono soft" style="width:118px;font-size:13px">×1.000778</span><span class="num grow" style="font-size:21px;text-align:right">2.001556 sh</span></div>
        <div class="row"><span class="sym" style="width:130px">2 NVDAon</span><span class="mono soft" style="width:118px;font-size:13px">×1.003701</span><span class="num grow" style="font-size:21px;text-align:right">2.007402 sh</span></div>
        <div class="row" style="background:#fbfaf9;border-radius:0 0 12px 12px"><span class="mono" style="font-size:12.5px;color:var(--soft)">a token-unit minimum reads both as <span class="num">2.000000</span> and passes</span></div>
      </div>
      <div class="card" style="width:330px;display:flex;flex-direction:column;justify-content:center;padding:22px 24px;background:var(--ink)">
        <div class="kicker" style="color:rgba(255,255,255,.55)">Checked onchain</div>
        <div class="num" style="color:#fff;font-size:27px;margin-top:10px;line-height:1.25">Σ shares<br>≥ minShares</div>
        <div class="mono" style="color:rgba(255,255,255,.62);font-size:12px;margin-top:14px;line-height:1.5">or the whole call reverts.<br>Calldata is never parsed; only balance deltas count.</div>
      </div>
    </div>`,
  },
  {
    slug: "how-an-order-travels",
    layout: "stack",
    sub: "From a ticker in a text box to shares in your wallet, and what each piece is allowed to decide.",
    category: "Architecture",
    stamp: "ticker → shares · six pieces",
    headline: "Nothing holds your funds. Every step re-checks the last.",
    foot: "quote_hash links the receipt to the record that chose the route",
    body: `<div style="display:flex;align-items:center;gap:14px;width:100%">
      ${[
        ["01", "Resolver", "score · policy<br>legs · simulate"],
        ["02", "You sign", "unsigned tx,<br>no custody"],
        ["03", "Contracts", "registry · router<br>legExecutor"],
        ["04", "Receipt", "shares, ratio,<br>attestation"],
      ]
        .map(
          ([n, t, s], i) => `${i ? '<span class="num" style="color:var(--line);font-size:22px">→</span>' : ""}
        <div class="card" style="flex:1;padding:18px 20px">
          <div class="kicker brand">${n}</div>
          <div class="sym" style="font-size:19px;margin-top:9px">${t}</div>
          <div class="mono soft" style="font-size:12px;margin-top:8px;line-height:1.55">${s}</div>
        </div>`,
        )
        .join("")}
    </div>`,
  },
  {
    slug: "backing-invariant",
    layout: "stack",
    sub: "A unit of pxMAG7 is a fixed number of shares of seven companies, provable onchain after every call.",
    category: "Indices",
    stamp: "pxMAG7 · BasketVault",
    headline: "A unit is that many shares, or the call reverts.",
    foot: "checked after every state-changing call, across every issuer",
    body: `<div style="width:100%">
      <div class="card" style="padding:22px 26px;display:flex;align-items:center;gap:18px;background:var(--ink)">
        <span class="kicker" style="color:rgba(255,255,255,.5)">Invariant</span>
        <span class="num" style="color:#fff;font-size:22px">heldShares(i) &nbsp;≥&nbsp; totalSupply × sharesPerUnit(i) / 1e18</span>
      </div>
      <div class="card" style="margin-top:14px;display:flex;padding:4px 0">
        ${[
          ["NVDA", "0.0644"],
          ["AAPL", "0.0425"],
          ["MSFT", "0.0289"],
          ["AMZN", "0.0561"],
          ["GOOGL", "0.0407"],
          ["META", "0.0213"],
          ["TSLA", "0.0391"],
        ]
          .map(
            ([t, v], i) => `<div style="flex:1;padding:22px 0;text-align:center;${i ? "border-left:1px dashed var(--line)" : ""}">
              <div class="kicker">${t}</div>
              <div class="num" style="font-size:21px;margin-top:7px">${v}</div>
            </div>`,
          )
          .join("")}
      </div>
      <div class="mono soft" style="font-size:12.5px;margin-top:13px;text-align:center">shares per unit, fixed at deployment · not a target weight, not a NAV claim</div>
    </div>`,
  },
  {
    slug: "agent-mandates",
    layout: "split",
    sub: "Caps, expiry, allowlists and a hardcoded recipient, enforced by a contract rather than by the agent's good intentions.",
    category: "Agents",
    stamp: "AgentMandate · BSC mainnet",
    headline: "The limits are the contract, not the prompt.",
    foot: "revocation is instant · the agent never receives the assets",
    body: `<div style="display:flex;gap:22px;width:100%;align-items:stretch">
      <div class="card" style="flex:1">
        <div class="head">Set by the owner</div>
        ${[
          ["Per-transaction cap", "USDT"],
          ["Daily cap", "rolling 24h"],
          ["Expiry", "unix seconds"],
          ["Max slippage", "bps, ≤ 2000"],
          ["Allowlist", "per underlying"],
        ]
          .map(
            ([k, v]) => `<div class="row"><span class="sym" style="font-size:15px;font-weight:500">${k}</span>
              <span class="mono grow soft" style="font-size:12px;text-align:right">${v}</span></div>`,
          )
          .join("")}
      </div>
      <div class="card" style="width:360px;padding:26px 26px;display:flex;flex-direction:column;justify-content:center;background:var(--ink)">
        <div class="kicker" style="color:rgba(255,255,255,.5)">Hardcoded</div>
        <div class="num" style="color:#fff;font-size:26px;margin-top:10px;line-height:1.25">recipient<br>= owner</div>
        <div class="mono" style="color:rgba(255,255,255,.62);font-size:12px;margin-top:14px;line-height:1.55">There is no parameter for where the shares go. A compromised agent key buys you your own stock.</div>
      </div>
    </div>`,
  },
  {
    slug: "shipping-to-mainnet",
    layout: "stack",
    sub: "Twelve audit agents, a fuzz campaign that caught a one-wei bug, and what it cost to put the system on chain 56.",
    category: "Operations",
    stamp: "chain 56 · 22 Sep 2026",
    headline: "Audit first. A deploy is the step you cannot take back.",
    foot: "contracts are immutable · every figure from the run that produced it",
    body: `<div style="width:100%">
      <div class="card" style="display:flex;padding:4px 0">
        ${[
          ["12", "audit agents"],
          ["6", "findings fixed"],
          ["124", "tests passing"],
          ["270,136", "fuzz calls"],
          ["0.00183", "BNB to deploy"],
        ]
          .map(
            ([v, k], i) => `<div style="flex:1;padding:30px 10px;text-align:center;${i ? "border-left:1px dashed var(--line)" : ""}">
              <div class="num" style="font-size:${v.length > 6 ? 27 : 34}px;line-height:1">${v}</div>
              <div class="kicker" style="margin-top:10px">${k}</div>
            </div>`,
          )
          .join("")}
      </div>
      <div class="mono soft" style="font-size:12.5px;margin-top:14px;text-align:center">one fuzz finding was real: backing is now compared exactly, at 1e36 scale</div>
    </div>`,
  },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
for (const cover of COVERS) {
  const tmp = resolve(WEB, `public/_cover.html`);
  writeFileSync(tmp, shell(cover, cover.body));
  await page.goto(`${BASE}/_cover.html`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const out = resolve(WEB, `public/assets/images/cover-${cover.slug}.png`);
  await page.screenshot({ path: out });
  unlinkSync(tmp);
  console.log("wrote", out.replace(`${ROOT}/`, ""));
}
await browser.close();
