# Parallax web

`apps/web` is Parallax's site and app in Next.js 15 (App Router), TypeScript, Tailwind CSS v4 and Motion.
Its design system is a measured reconstruction of the Syncrun template (https://syncrun.framer.website,
Framer project `cdyA3db0MrYAtjey4Sey`): every token, frame and motion value was read from the live reference
with Playwright (recon in `../../.recon/`), and the sections keep the reference's structure exactly. The
content is Parallax's own (`content/*.ts`; the reference copy is kept in `content/syncrun/` for comparison)
and every figure on it traces to `docs/recon.md`, `docs/decisions.md` or a recorded run named beside it.

## Run

```
pnpm --filter @parallax-hood/web dev        # http://localhost:3100
NEXT_DIST_DIR=.next-prod pnpm --filter @parallax-hood/web build && NEXT_DIST_DIR=.next-prod npx next start -p 3200
```

`NEXT_DIST_DIR` keeps production builds out of the dev server's `.next`.

## Recon tooling (`../../scripts`)

| script | what it does |
|---|---|
| `capture.ts` | crawls a site, saves HTML, full-page + per-section screenshots at 1440/768/390, `getComputedStyle` of every visible element, and every asset. `BASE=` picks the site, `ROUTES=` limits it, `RECON_DIR=` the output. Run it against the reference and against the build and diff. |
| `extract-copy.ts` | walks every page and writes text, links and images per section to `.recon/copy/*.json` |
| `motion-compare.mjs` | entrance frames at fixed timestamps and measured marquee speeds, reference vs build |
| `shot.mjs` | one element, clip or state (`footer`, `nav-scrolled`, `menu`, `y=N`) of either site |
| `shot-full.mjs` | full-page screenshot of a build route after the appear animations have run; `CHAIN=31337` picks the product network |

## Token system (`app/globals.css`)

CSS custom properties on `:root`, exposed to Tailwind through `@theme inline`.

- **Colour**: the project's eleven colour styles by name — `--color-background #f7f5f3`, `--color-card-1
  #eeeae6`, `--color-card-2 #fff`, `--color-card-3 #1a1a1a`, `--color-heading/paragraph #262626`,
  `--color-brand #f24100`, `--color-border-1 #d6d0c8` (every dashed rule), `--color-border-2/3`
  (5% / 15% black), plus the two secondary text colours the computed styles use.
- **Type**: 21 roles as `--text-*` / `--leading-*` / `--tracking-*` / `--weight-*` plus `.t-*` classes.
  Headings are Libre Caslon Condensed 500 (`76.8/88.32 -1.6px` H1 at 1440, `48/55.2` below 1200), body is
  Public Sans (`16/22.4 +0.03px`), prices are Switzer, nav links Inter. Sizes are the reference's rem
  values at 16px and are left unrounded.
- **Fonts**: all 46 `@font-face` rules the reference declares, self-hosted from `public/assets/fonts`
  with the reference's unicode ranges. The nine faces that actually render are subsetted to Latin
  (originals in `fonts-original/`).
- **Spacing**: `--container 1300`, `--container-nav 1220`, `--page-gutter 40 → 20`, `--section-y 100`,
  `--hero-top 150`, `--stack-gap 50`, `--heading-gap 15`, `--card-gap 10`, `--shell-pad 7`.
- **Radii**: `10` (cards) `15` (shells) `30` (tags) `35` (buttons) `31` (button badge) `50` (avatars, navbar) `40` (email input).
- **Motion**: `--ease cubic-bezier(.44,0,.56,1)` at `0.4s` (colour) and `0.5s` (background); appear = spring
  320/60/1, y 40 → 0; marquee 50 px/s left, ticker 25 px/s right.

`/design-system` renders every token with its measured source value.

## Sections (`components/`)

| file | reference frames |
|---|---|
| `site/ui.tsx` | `Reveal` (spring / CSS entrance), `Tag` (Section Tag with the 9-bar barcode), `Button` (35px pill, sliding label + arrow badge), `Feat` (Features Item), `Bars`, `Counter`, `LogoRail`, `Icon` |
| `site/Navbar.tsx` | Navbar: 1220×62 pill, transparent until scrolled, dot-separated menu, hamburger + stacked menu below 1024 |
| `site/Footer.tsx` | Footer: CTA / newsletter + three link columns / credits |
| `sections/Hero.tsx` | Header: heading stack, UI-Card with the typewriter chat mock beside the testimonial card, logo rail |
| `sections/Features.tsx` | three sticky Feature Cards (workflow, chat, chart mocks) |
| `sections/Middle.tsx` | Integrations (4×4 cycling marks), Metrics (counters around the calculator), Process (sticky heading + Main Cards), Reviews (large card + ticker) |
| `sections/shared.tsx` | FaqsSection, PlansSection (Monthly / Yearly), PostCard |
| `sections/About.tsx` | About header, logos, Manifesto (scroll-lit words), Benefits, Team |
| `sections/NotFound.tsx` | Error 404 |

Component measurements (paddings, gaps, widths) are in `app/components.css`, each rule commented with the
frame it reproduces. Copy lives in `content/*.ts` (Parallax); the reference's verbatim copy is in `content/syncrun/`.

## Routes

`(site)/` — `/`, `/about`, `/plans`, `/changelog`, `/blog`, `/blog/[slug]` (6), `/contact`,
`/legals/[slug]` (2), `/404`, plus `not-found.tsx`. `(app)/` — the Parallax product (`/stocks`, `/buy/[ticker]`,
`/baskets` (index cards: period return, minimum, NAV), `/baskets/[symbol]` (performance, allocation donut, asset cards, invest panel, vault), `/receipts`, `/mandates`, `/how-it-works`) on the same chrome via
`components/app/AppShell.tsx` and `components/app/app.css`; the wallet/query providers load only there.

## QA

`.recon/DEVIATIONS.md` lists every known difference from the reference, `.recon/NOTES.md` the things in the
reference reproduced as-is that a reviewer may want to rule on. Lighthouse (mobile, production): performance
84–91, accessibility 96–100, best practices 100, CLS 0.
