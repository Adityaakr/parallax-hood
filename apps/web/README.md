# Parallax web

`apps/web` is Parallax's site and app in Next.js 15 (App Router), TypeScript, Tailwind CSS v4 and Motion.
Its design system is a measured reconstruction of the Syncrun template (https://syncrun.framer.website,
Framer project `cdyA3db0MrYAtjey4Sey`): every token, frame and motion value was read from the live reference
with Playwright, and the sections keep the reference's structure exactly. The
content is Parallax's own (`content/*.ts`; the reference copy is kept in `content/syncrun/` for comparison)
and every figure on it traces to `docs/addresses.md` or `contracts/script/config/robinhood.json`.

## Run

```
pnpm --filter @parallax-hood/web dev        # http://localhost:3200
NEXT_DIST_DIR=.next-prod pnpm --filter @parallax-hood/web build && NEXT_DIST_DIR=.next-prod npx next start -p 3200
```

`NEXT_DIST_DIR` keeps production builds out of the dev server's `.next`.

## Recon tooling

`../../scripts/capture.ts` crawls a site and saves HTML, full-page and per-section screenshots at 1440/768/390,
the computed style of every visible element and every asset (`BASE=` picks the site, `ROUTES=` limits it,
`RECON_DIR=` the output). The reference captures it was run against, and the one-off comparison scripts, stay in
the original Parallax repository; they are not needed to build or run this app.

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
| `site/Footer.tsx` | Footer: CTA / newsletter + three link columns / bottom row (eligibility and non-affiliation notices) |
| `sections/Hero.tsx` | Header: heading stack, UI-Card with the typewriter chat mock beside the testimonial card, logo rail |
| `sections/Features.tsx` | three sticky Feature Cards (workflow, chat, chart mocks) |
| `sections/Middle.tsx` | Integrations (4×4 cycling marks), Metrics (counters around the calculator), Process (sticky heading + Main Cards), Reviews (large card + ticker) |
| `sections/shared.tsx` | FaqsSection, PlansSection (Monthly / Yearly), PostCard |
| `sections/About.tsx` | About header, logos, Manifesto (scroll-lit words), Benefits, Team |
| `sections/NotFound.tsx` | Error 404 |

Frames the product has no content for carry factual content of the same shape (all of it in `content/*.ts`):
the hero's testimonial card states the ERC-8056 multiplier with its source; the logo rail lists the seven
stocks and two indices as wordmarks (no third-party logos anywhere on the site); the Integrations grid names
the stack as text; the Metrics calculator computes the protocol fee on an order; the Reviews frame carries what
the contracts enforce and what a holder still trusts; the third Plans card and comparison column are the
single-stock path. The footer's bottom row carries the eligibility and non-affiliation notices.

Component measurements (paddings, gaps, widths) are in `app/components.css`, each rule commented with the
frame it reproduces. Copy lives in `content/*.ts` (Parallax); the reference's verbatim copy is in `content/syncrun/`.

## Routes

`(site)/` — `/`, `/about`, `/plans`, `/changelog`, `/blog`, `/blog/[slug]` (3), `/contact`,
`/legals/[slug]` (2), `/404`, plus `not-found.tsx`. `(app)/` — the Parallax product (`/stocks`, `/buy/[ticker]`,
`/baskets` (index cards: period return, minimum, NAV), `/baskets/[symbol]` (performance, allocation donut, asset cards, invest panel, vault), `/receipts`, `/mandates`, `/how-it-works`) on the same chrome via
`components/app/AppShell.tsx` and `components/app/app.css`; the wallet/query providers load only there.

## QA

The reference captures, the list of known deviations and the Lighthouse runs belong to the original build and
are kept in the original Parallax repository. For this port the checks are the typecheck, the production build
and the browser journey in `../../scripts/e2e/browser.mts`.

