# Decision log

Newest first inside each phase. Every non-obvious choice, with the why. Dates are UTC.

## Phase 0 — recon (2026-09-17)

**D0.1 — GO with custodial vaults (Plan A).** Ondo `GMToken` and bStock `SecuritiesToken` both enforce only blocklists + sanctions lists on `from`/`to`/operator; simulated transfers to contract recipients succeed. No allowlist, no KYC gate on secondary transfers. Evidence in `docs/recon.md` §2–3.

**D0.2 — PancakeSwap direct adapter is the onchain execution path.** The Binance aggregator routes Ondo tokens through RFQ, which needs an EIP-712 signature from `userWalletAddress`; a contract cannot produce one. bStocks have deep PancakeSwap v3 USDT pools. So legs target PancakeSwap SmartRouter / v3 SwapRouter (allowlisted). The Binance API remains the data layer (RWA endpoints, reference prices, attestations, market status), the comparison layer (aggregated quotes incl. RFQ for EOAs), and the simulation layer. Once an API key is available, `vendor=Pancake` calldata from Build Swap may be accepted as a leg source after we verify it targets an allowlisted router with recipient = caller.

**D0.3 — Two ratio sources in the registry.** `RatioSource.ERC8056` reads `uiMultiplier()` live from the token (bStocks). `RatioSource.KEEPER` uses keeper-posted `{ratio, updatedAt}` with `maxRatioAge` (Ondo). This is exactly what the spec asked for if an onchain source exists for some tokens. For ERC-8056 we also expose `pendingMultiplier()` in the resolver so a scheduled change is visible before it lands.

**D0.4 — Underlying ids are right-padded ASCII tickers** (`bytes32("NVDA")`), not hashes: readable in explorers and events, trivial to mirror in TS, no preimage lookup.

**D0.5 — Chainlink push feeds for display NAV and deviation checks.** All Mag 7 have BSC mainnet feeds (24h heartbeat, 0.5 % deviation). Binance `referencePrice` is the second source; the resolver reports both and flags disagreement > 50 bps. Feeds never gate mint/redeem.

**D0.6 — pxMAG7 includes all seven names.** Every name has a bStock with executable AMM depth at $1k+. Ondo representations are registered so the resolver can compare and so migration can move into them if they become cheaper per share, but today they are excluded by depth at any size above a few hundred dollars.

**D0.7 — xStocks out of scope.** Present on BSC but no PancakeSwap pools. Registry stays platform-agnostic.

**D0.8 — Token enumeration source.** Without a Binance key, Mag 7 addresses were enumerated from CoinGecko platform data and verified onchain (name, symbol, beacon → impl → verified source). Labeled as a fixture. The keeper re-derives the identity map from `rwa/tokens` when a key is present and flags any mismatch.

**D0.9 — Framer landing page.** The marketing landing page is built in Framer from the user-supplied "Aeonex" project (design + animations kept exactly, content replaced with Parallax copy). The Next.js app remains the product UI; the landing links into it.

**Status after Phase 0:** `docs/recon.md` complete; fixtures recorded; blocked items (API key, deployer funds) documented in recon §8 with fallbacks. Proceeding to Phase 1.

## Phase 1 — contracts (2026-09-17)

**D1.1 — `RatioSource.ERC8056` reads live, with a checkpoint guard.** `isBuyEligible` for ERC-8056 tokens compares the live `uiMultiplier()` with the last checkpoint (`checkpointRatio`, callable by anyone, bounded by `maxRatioStepBps`). This gives corporate-action protection without making bStocks depend on the keeper.

**D1.2 — Swap-target allowlist lives in `StockRegistry`**, shared by router and every vault, so one ADMIN action governs execution venues everywhere.

**D1.3 — `RouteReceipt` emitted through `ReceiptEmitter` from a memory struct.** The 11-field event blew the EVM stack in `buyShares`/`mint`; a struct-based helper keeps callers shallow without `via_ir` (which would slow coverage and verification).

**D1.4 — `redeemInKindSkipping(units, recipient, skip[])`.** Spec says in-kind must "always work"; an issuer-paused token would revert the whole transfer. The skip variant lets a holder forfeit a frozen slice (which stays with remaining holders) and exit with everything else. The plain `redeemInKind` is unchanged.

**D1.5 — Mint overspend guard.** Vault USDT can pre-exist (migration leftovers, donations). `mint` measures the USDT delta and reverts with `OverSpent` if legs consumed more than `maxUsdtIn`, so a caller can never spend other holders' USDT.

**D1.6 — Redeem distributes vault USDT pro rata** alongside representation tokens, so migration leftovers are not trapped.

**D1.7 — Daily cap = 24h window from first spend**, not a true rolling window (which needs a ring buffer). Documented in the contract NatSpec and the UI copy.

**D1.8 — Basket creation gated by `BASKET_CREATOR_ROLE`** for the MVP; permissionless creation with a curation flag is roadmap.

**D1.9 — pxMAG7 mainnet caps are 10 000 bps** for every name because only bStocks have executable depth today (recon §4). Caps are exercised with the mock basket (80 %) in unit, invariant and testnet deployments. A second, lower-cap basket can be created without code changes once Ondo AMM depth appears.

**D1.10 — Fork test for migration asserts either outcome honestly.** At the recon block, selling NVDAon into its 1 % pool and buying NVDAB is not share-accretive; the test asserts the invariant rejects it. The success branch runs when the market makes it accretive.

**D1.11 — Local anvil fork uses port 8547** (8545/8546 were occupied by other anvil instances on the build machine).

**Status after Phase 1:** 102 tests (unit, fuzz, invariant) + 6 mainnet-fork tests pass; 100 % line coverage on all core contracts; Slither: 0 high, 16 medium/low all dispositioned in `docs/threat-model.md`; deploy scripts verified on a local fork (real tokens, `pxMAG7`) and a local mock chain (`pxDEMO3`).

## Phase 2 — SDK and Binance client (2026-09-17)

**D2.1 — ABIs are generated from Foundry artifacts** (`packages/sdk/scripts/gen-abis.ts`), never hand-copied. External ABIs we call (PancakeSwap QuoterV2/SmartRouter, Chainlink, ERC-8056, ERC-20) are minimal inline definitions.

**D2.2 — Share math parity is proven with 200 forge-generated vectors** (`contracts/script/GenVectors.s.sol` → `packages/sdk/test/vectors/sharemath.json`). Vectors are parsed with Node 22's `JSON.parse` reviver `context.source` so uint256 values keep full precision.

**D2.3 — Client modes: `live` / `fixtures` / `record`.** With no key the client defaults to `fixtures` and throws `FixtureMissingError` for anything not recorded — it never fabricates. Fixture files carry `_fixture: true` and `recordedAt`. `record` mode is a superset of live that writes fixtures; `scripts/record-fixtures.ts` captures the full Mag 7 dataset once a key is available.

**D2.4 — Signing verified against `binance-common`'s `web3_signature`**: `preHash = ts + METHOD + "/build" + path + "?" + query + body`, `X-OC-RECV-WINDOW` default 15000 like the official SDK, query encoded with `URLSearchParams` (byte-identical to Python `urlencode(quote_plus)`), which matters because the signed string must equal the sent query.

**Status after Phase 2:** SDK 15 tests, client 13 tests, both typecheck. No live Binance data captured yet (no key on the build machine); the resolver treats Binance as one provider among onchain sources and labels its availability.

## Phase 3 — resolver (2026-09-17)

**D3.1 — Data providers are layered and labeled.** Onchain (registry, ERC-8056 multipliers, Chainlink, PancakeSwap QuoterV2) is always live. Binance Web3 is a provider with explicit availability: `live` with a key, `fixtures` replay otherwise, and `null` answers when nothing is recorded — never invented values. Market hours fall back to a computed NYSE calendar (`source: "computed"`) when Binance `statusInfo` is unavailable. Every response carries `dataSource` and each price its `referenceSource`.

**D3.2 — Only contract-executable venues produce legs.** Candidates without AMM depth are scored as ineligible with the reason "no contract-executable AMM liquidity (Ondo trades via RFQ, which needs an EOA signature)". Binance aggregated quotes are recorded for comparison when available.

**D3.3 — Effective premium includes gas** (spec: `costPerShare = (usd + gasUsd) / sharesOut`); `pricePremiumBps` (ex-gas) is also reported. At $50 clips BSC gas (~$0.28 at 1 gwei) alone is ~56 bps, so tight policies reject small buys honestly.

**D3.4 — Simulation with state overrides.** Every returned tx is `eth_estimateGas`-simulated from the user's address. If the user has not approved USDT yet, the balance/allowance storage slots are discovered by probing (like forge's `deal`) and overridden so the route itself is still verified; `approvalNeeded` is reported. Transactions that fail simulation are withheld (`tx: null`) with the decoded custom error.

**D3.5 — Basket mints use exact-output legs** so the vault receives exactly the shares it needs (+1 bps margin), with `amountInMaximum` = quote + 30 bps; leftover USDT is refunded by the vault. Issuer caps are honored at quote time with a 20 bps haircut so ceil-rounding cannot land above the onchain cap.

**D3.6 — `quoteHash = keccak256(canonical JSON)`** of the scoring record (sorted keys, bigints as strings) excluding `tx`, `simulation`, `quoteHash`. Records are stored in SQLite (`node:sqlite`, no native build) and served at `GET /quotes/:hash`; the receipts indexer resumes from the deployment block.

**D3.7 — Local fork ergonomics.** Public BSC RPCs prune state within minutes, breaking anvil forks; `bsc-mainnet.public.blastapi.io` serves archive state. `scripts/fork-up.sh` pins `--fork-block-number` so anvil's upstream cache persists on disk across runs, the resolver caps fork RPC concurrency (`FORK_MAX_INFLIGHT=3`) and warms every registered pool on start. A plain local chain with mocks (`scripts/mocks-up.sh`, chain 1337) is the fast, deterministic path for tests and the no-funds demo; it mirrors the BSC testnet deployment.

**Status after Phase 3:** end-to-end verified on a mainnet fork with real tokens and pools: `$100 NVDA` resolved to NVDAB at $219.01/share (−8 bps), pxMAG7 mint (7 legs, 1.71M gas), redeem to USDT, redeem in kind, receipts indexed and linked to scoring records. 18 resolver tests (unit + integration on the mocks chain) pass.

## Phase 4 — keeper (2026-09-17)

**D4.1 — The keeper never invents data.** Keeper-sourced ratios come only from Binance `tokenToShareRatio`; attestation timestamps only from `underlying-profile.protections.daily*` (`updatedAt`, else a date parsed from the report URL). With no source it skips and reports "skipped (no source)" in `/health`; the registry value then ages out and buys for that representation pause. A `keeper attest <platform> <date> <sourceUrl>` command posts a human-verified date with provenance in the note.

**D4.2 — Step-bound alerts instead of forcing.** A proposed ratio outside `maxRatioStepBps`, or an ERC-8056 multiplier that drifted past it, raises an alert (in logs and `/health`) for ADMIN `confirmRatio`; the keeper never bypasses the bound. ERC-8056 checkpoints are refreshed when drift ≥ `CHECKPOINT_DRIFT_BPS` (10).

**D4.3 — Market state provenance** is written into every intent note: "binance statusInfo" or "computed calendar".

**D4.4 — The migration bot is just a client of `GET /migrations`** on the resolver and submits through `BasketVault.migrate`, the same permissionless path anyone can use; it simulates before sending and reports reverts as alerts.

**Status after Phase 4:** dry-run and live runs verified on the mocks chain (market state posted; ratios/attestations correctly skipped without a source; migration executed at +288 bps).

## Phase 5 — MCP server (2026-09-17)

**D5.1 — One write tool, one path.** `execute_with_mandate` is the only tool that signs; it encodes calls to `AgentMandate` exclusively and re-checks owner/agent/active/expiry/caps/allowlists offchain before simulating and sending, so refusals are explained before any gas is spent. All other tools are reads that return unsigned transactions for the user's own wallet.

**D5.2 — Plain-language everywhere.** `resolve_stock` returns candidates with human reasons and the chosen route's `why`; `explain_receipt` joins receipts with their scoring records and states which invariant the contract enforced.

**D5.3 — Both transports.** stdio by default (Claude Desktop / Claude Code `claude mcp add`), streamable HTTP with per-session transports via `--http`. A project-scoped `.mcp.json` points Claude Code at the local mocks chain.

**Status after Phase 5:** 7 end-to-end tests with the official MCP client over stdio pass on the mocks chain: search, resolve, mandate read/build, agent buy and basket mint through the mandate, per-tx/daily cap and allowlist refusals, revocation, receipt explanation.

## Phase 6 — web app (2026-09-17)

**D6.1 — Network switch selects both the wagmi chain and the resolver URL** (`NEXT_PUBLIC_RESOLVER_URLS` JSON keyed by chain id; fallback `NEXT_PUBLIC_RESOLVER_URL`). Mainnet, testnet, local fork (31337 on :8547) and local mocks (1337 on :8548) are all first-class.

**D6.2 — Every transaction the UI sends came from the resolver pre-simulated**; `TxButton` handles USDT approval, chain switch, the first-transaction disclaimer (stored locally, no geolocation), and links the result to `/receipts?tx=`.

**D6.3 — Honest labels in the UI**: header shows resolver status and Binance mode (live vs fixtures); buy page shows market-status source (binance / computed / registry), premium including gas and ex-gas; basket page shows backing ratio per constituent, per-issuer share vs cap, and "single issuer" when a cap cannot apply.

**D6.4 — Theme is a `data-theme` attribute with CSS variables** (no Tailwind dark-class dependency), persisted locally, default from the OS. One accent color, monospace tabular numbers for every figure.

**D6.5 — Web dev server on port 3100** (3000 was in use on the build machine).

**Status after Phase 6 (app):** `next build` passes; all six screens (`/buy/[ticker]`, `/baskets`, `/baskets/[symbol]`, `/receipts`, `/mandates`, `/about`) render against the mocks resolver with loading, empty and error states.

## Web: landing page served from the app, product restyled to the landing system (18 Sep 2026)

- The Framer landing (Aeonex template, Parallax copy) is replicated in `apps/web/components/landing/Landing.tsx` and served at `/` by the Next app, so localhost and the eventual Vercel deploy carry the marketing page; Framer stays published in parallel at jazzed-brand-198080.framer.app.
- Product pages moved under the same design tokens (`globals.css`): #fcfcfc surfaces, #10B261 green, #0B1613 ink, Inter + Inter Tight, pill buttons, chip labels. The old stock list moved from `/` to `/stocks`.
- Illustrations are generated SVGs (`public/brand/gen-illustrations.mjs`) that show real product surfaces (resolver table, basket, mandate) rather than the template's stock imagery; hero/footer backgrounds are the template's landscape PNGs.
- Theme defaults to light (brand) instead of following the OS; the toggle still persists a choice.
- Footer is the full CTA footer on the landing and compact elsewhere (pathname check in `Footer.tsx`).

## Web: landing keeps the Framer design; images replaced by React product frames (18 Sep 2026)

- Decision reversed the same day: the Framer template's layout, tokens and animations stay (they read well); only the illustrations changed. The generated SVGs were replaced by React "product frames" (`components/landing/frames.tsx`) that render the real surfaces — resolver table, ShareRouter minShares, pxMAG7 composition, migration check, mandate refusal, data pipeline, stat tiles — so they are crisp, theme-aware and show actual figures from docs/recon.md and the 17 Sep fork run. Undocumented figures (a buy gas number, a block number) were dropped rather than invented.
- Kept from the interim pass: `PageHead` / `.kpi` scaffolding on product pages, JetBrains Mono for hashes, and `table.grid { display: table }` (Tailwind's `.grid` utility had been hijacking data tables).
- Superseded notes from the interim institutional pass follow for the record.

### (superseded) institutional redesign

- Replaced the Framer-template replica with an institutional design system (`apps/web/app/globals.css`): paper surfaces (#f6f7f5), hairline rules, ink #0a1412, one green (#0e9f6e / #0b7f58) reserved for data and primary actions, Inter Tight display, tabular numerals, JetBrains Mono for hashes and calldata, uppercase eyebrows, numbered sections.
- Landing illustrations are now React "product frames" (`components/landing/frames.tsx`: resolver table, ShareRouter minShares, pxMAG7 composition, migration check, mandate refusal, receipt, fragmentation table) instead of SVG images. Every figure is from the 17 Sep 2026 mainnet-fork run or docs/recon.md; undocumented numbers (a buy gas figure, a block number) were removed rather than invented.
- New sections: the problem (comparison table), guarantees (seven invariants with the test file that enforces each), evidence, data provenance table, trust assumptions, FAQ. Marquee and landscape hero dropped; the dark landscape footer stays.
- Product pages share the system via `PageHead` (eyebrow / title / lede / right KPI) and `.kpi` tiles; `table.grid` now forces `display: table` because Tailwind's `.grid` utility was hijacking data tables.
- Note for local dev: `next build` shares `.next` with the dev server; restart `pnpm dev` after a build.

## Web: whole product restyled to the Zenvaro Framer template (18 Sep 2026)

- Replaced the Aeonex-based look with the "Zenvaro (copy)" template end to end: nav, hero, feature bento, platform preview, guarantees bento, metric card + testimonial slideshow, pricing-style stack section with a users/agents toggle, gradient CTA, footer with faded wordmark. Layout, spacing, type scale (Geist), colors, shadows and animations were read from the Framer project tree (`serialize` + section screenshots) and mirrored in CSS/framer-motion; template images are reused unchanged, as asked.
- Content is Parallax's: capabilities, invariants, fork-run evidence, stack items, MCP mandate items. No fabricated figures: $1.24M is the NVDAB PancakeSwap pool depth from docs/recon.md; 14 / 7 / 100% are the tracked representations, pxMAG7 constituents and contract line coverage.
- Light-only (the template has no dark mode); the theme toggle was removed and a saved dark preference is ignored.
- Dropped the landscape backgrounds and the previous landing; `components/landing/frames.tsx` stays for the About page's fragmentation table.

## Web: product pages become a dashboard, after the template's "platform preview" (18 Sep 2026)

- Every non-landing route renders inside `components/app/AppShell.tsx`: a white rounded frame on the grey canvas, a 250px sidebar (network switcher in the workspace slot, ⌘K stock search, quick actions, grouped nav, wallet as the user row) and a top bar with breadcrumbs, resolver status and icon actions. `components/Chrome.tsx` picks marketing chrome for `/` and the shell for everything else.
- Buy page mirrors the reference screen: ticker selector + reference price + chips, a depth chart (cost per share of each representation at six order sizes, quoted live through `/resolve`; `lib/depth.ts`), the candidates table, a six-cell market overview, and a Buy/Mint/Delegate trade panel with amount presets, receive line, fee rows and a full-width primary button. The chart is real resolver output, not a price history (the resolver has none).
- Basket page gets the same trade panel for mint/redeem; other pages use `.panel` surfaces. `TxButton` accepts a class and offers "Connect wallet to sign" when no wallet.

## Web: search-first navigation; local mocks as the default network (20 Sep 2026)

- The product's one-line pitch is "search a stock, we price every issuer and route to the best", so `/stocks` is now that search engine: one box, and a table with best price per share across issuers, the winning route, the spread to the next issuer and the issuer chips. Best price comes from one `/resolve` per ticker at a standard $500 size (`lib/best.ts`, sequential so a forked chain stays responsive).
- Sidebar cut to four items (Search stocks · Baskets · Activity · Agents) plus test funds and two secondary links; breadcrumbs renamed to match.
- Default network is local mocks (1337, plain anvil, no fork backend) because the forked anvil wedges its write path under quoter bursts: reads stay fast while `anvil_setBalance`/`eth_sendRawTransaction` hang. Fork stays available on 31337 (resolver :4001) for demos against real mainnet state; a resolver-side `/faucet` (fork and mocks only) hands out 1 BNB + 2,000 USDT so anyone can trade without funds.

## Universe: 40 dual-issuer underlyings, generated from the live Binance catalogue (20 Sep 2026)

- With a Binance Web3 API key the RWA catalogue on BSC is 488 tokens (Ondo 442, bStocks 46), of which **40 underlyings are tokenized by both issuers** — the exact set the router exists for. It includes pre-IPO names (SPCX = SpaceX: `SPCXon` 0xd0a5…a928 and `SPCXB` 0xbe9d…03e1), recent listings (CRCL, CRWV, COIN, HOOD, PLTR, NBIS, RKLB) and ETFs (QQQ, SPY, TQQQ, SOXL), not just the Mag 7 the Phase-0 recon found by hand.
- `scripts/gen-universe.ts` regenerates `contracts/script/config/bsc.json` from that catalogue: ticker, issuer, symbol, token address, ratio source (bStocks → ERC-8056 onchain, Ondo → keeper-posted) and the current ratio. The mainnet registry now covers all 40 (80 representations).
- Live API also supplies real market status (`statusInfo.openState`, next open/close) and per-token prices, so `marketSource` becomes `binance` instead of the computed fallback. Observed drift worth noting: the keeper-posted NVDAon ratio in the fork deployment (1.0037) is 32h stale against the API's 1.001715 — the resolver correctly excluded that route for staleness, which is the keeper loop doing its job.
- Liquidity still decides executability: Ondo tokens mostly lack PancakeSwap depth, so most fills land on bStocks. Registering an underlying is free; the scorer excludes what it cannot execute, with a reason.

## BSC testnet: live deployment and a real end-to-end run (20 Sep 2026)

Deployed with `pnpm testnet:up` from a funded throwaway key (0x0047B3…3E2F, 0.3 tBNB; the four stages cost 0.0023 tBNB).

| contract | address |
|---|---|
| StockRegistry | `0x9bD085ff15772d44dB684ccF4FCaEDb03262bA93` |
| ShareRouter | `0xC511e515298E9c20769360E02041e131eb7fa479` |
| BasketFactory | `0x599c928AabB2203789FDEBA84bf371d9F2E49F8f` |
| AgentMandate | `0x696fb2e9a9730cb32C32B64C761c3637b6D618dC` |
| pxDEMO3 vault | `0xAc0f77767cdA4d653c68E3609aFCD356DCd81B86` |
| mock USDT / venue | `0x84Af7451794aaDFa729d6e8e140B51169a6cfe7D` / `0xcfAa542E4Dac083E440644EDF6C54f8d78B0579C` |

Real transactions, resolver on :4097 with the live Binance client:
- buy `0xf09865734ce426056adc4571a65657ecebde68b56eb9bc4ae99f149fd8734549` — $500 → NVDAon at $219.23/share (+10 bps), 2.272414 tokens = **2.280821 shares** at ratio 1.0037, 189k gas.
- mint `0x43c4bf8f2be50a6152ec15576c596130e502b4c396536d5b4842ce33916d59c1` — 2 pxDEMO3 units for 126.6 USDT, five fills split across both issuers (NVDA and AAPL each filled from bStocks **and** Ondo under the 80% issuer cap), 732k gas. Vault backing 1.0031 on every constituent, issuer mix 70/30 bStocks/Ondo.
- Six receipts indexed and linked to their quote records; the UI reads them from testnet.

Testnet uses the mock token set (BSC testnet has no Ondo/bStocks deployments), so ratios and prices come from the mock venue while market state, attestation and catalogue data come from the live Binance API. Real issuer tokens exist only on mainnet.

## Web: company marks from the catalogue; public tunnel for a live link (20 Sep 2026)

- Stock rows and the buy header now show the real company logo and name (NVIDIA, Apple, Microsoft…) instead of a lettered circle. Source is the Binance RWA catalogue's `tokenLogoUrl`/`underlyingName`, exposed by the resolver as `logoUrl`/`name` on each stock and keyed by **underlying ticker** (`BinanceProvider.brands()`), so the mock token sets used on testnet and locally still carry the right brand. `StockLogo` falls back to the lettered circle when the catalogue has no logo or the image fails.
- Until hosting accounts exist, the app is published through `cloudflared` quick tunnels: one for the web app and one for the testnet resolver, with `NEXT_PUBLIC_RESOLVER_URLS` pointing chain 97 at the public resolver URL (the browser calls the resolver directly). Tunnels are ephemeral: the URLs change when the processes restart, and they die with this machine. The `/faucet` route is mounted only on fork and mocks, never on the public testnet resolver.

## Wallets: drop RainbowKit, connect through wagmi directly (20 Sep 2026)

RainbowKit's `getDefaultConfig`/`connectorsForWallets` throw without a WalletConnect Cloud project id ("No projectId found"), which broke the whole page: the connect button did nothing and the app 500'd. Since a project id needs an external account we do not have, the wallet layer is now plain wagmi (`injected`, `metaMask`, `coinbaseWallet`) with our own picker, account row and wrong-network switch (`components/app/Wallet.tsx`). Any injected wallet — MetaMask, Rabby, Trust, Binance Wallet — connects with no third-party service. WalletConnect can be added back behind a real project id if mobile QR connect is wanted.

## Mainnet: measured cost, and a deploy script (20 Sep 2026)

Measured from the real testnet receipts at BSC mainnet's current 0.05 gwei and BNB $762:

| item | gas | cost |
|---|---|---|
| core contracts (registry, router, factory, mandate) | 10,518,537 | **$0.40** |
| registry: 40 underlyings + 80 representations | ~11,800,000 | **$0.45** |
| one BasketVault | 4,133,455 | **$0.16** |
| **total for the full universe + 3 baskets** | | **≈ $1.32** |
| a user's buy | 189,040 | $0.007 |
| a 3-stock basket mint | 731,525 | $0.028 |

`scripts/mainnet-up.sh` (`pnpm mainnet:up`) deploys core + registry + pxMAG7 against the real USDT and the real issuer tokens; it never deploys mocks. `dry` mode simulates for free (DeployCore verified clean against mainnet state; the later stages can only be simulated after the earlier ones are broadcast, since they read the written deployment file).

## Mainnet without deploying: quote-only mode (20 Sep 2026)

`QUOTE_ONLY=1 CHAIN_ID=56` runs the resolver against BSC mainnet with **no contracts deployed**: the universe comes from `contracts/script/config/bsc.json` instead of the registry (`Chain.fileUniverse`), bStocks ratios are read live from each token's `uiMultiplier()`, registry limits fall back to the contract defaults, the receipts indexer stays off, baskets are empty, and no transaction is ever built (`executable: false`, surfaced in the UI as "quote only on this network"). Everything that makes the product a product — the 40 dual-issuer names, live catalogue prices, Chainlink references, PancakeSwap v3 quotes and the exclusion reasons — is real and costs nothing.

First real quote through it: **SPCX (SpaceX)** — `SPCXB` at $152.82 per share, +4 bps over the $152.75 reference via `pancake-v3:500`, while `SPCXon` is excluded with "no contract-executable AMM liquidity (Ondo trades via RFQ, which needs an EOA signature)".

The search list prices all 40 instantly from the catalogue (each issuer's token price ÷ its shares-per-token ratio, so the numbers are comparable per share) and labels them indicative; the executable quote, with fees, slippage and gas, stays on the stock page. Resolving 40 stocks one by one through a public RPC took minutes, which is why the list no longer does that.

## Venues: quote the Binance aggregator, not just PancakeSwap (20 Sep 2026)

Checked what actually exists on BSC rather than assuming:

- **Issuers**: the Binance RWA catalogue lists exactly two on BSC — Ondo (458 tokens) and bStocks (77). xStocks has `NVDAx` onchain but no BSC pools and is not in the catalogue. So "bStocks · Ondo" is the real universe today, not a shortcut.
- **Venues**: far more than the PancakeSwap v3 pools we were reading. `topLiquidityPools` shows Native, Bebop and PancakeSwap V3 per token (NVDAB: 15 pools, PancakeSwap V3 alone holding $2.99M; SPCXB: 15, $3.41M), and the aggregator routes across Kipseli, Metric, Uniswap V3/V4, Tessera V, PancakeSwap V3 and the RFQ desks (Halfmoon, Native, Neptune).
- **Ondo is reachable after all.** Phase 0 concluded Ondo was RFQ-only and therefore unroutable; the aggregator fills it through RFQ desks. Measured at $500: `COINon` via *Rfq Halfmoon* at $194.41/share beats `COINB` via *Rfq Neptune* at $194.95 — the cheaper issuer flips per stock, which is the whole thesis.

`Venues.aggregatorQuote` now quotes the aggregator alongside the pool reads on chain 56 and the best of the two wins. Execution through it is not wired yet: the swap endpoint returns calldata to `0xB44446b0…FdDA5`, which has to be allowlisted in ShareRouter/BasketVault first, and RFQ quotes are signed per taker so the taker must be our contract. Until then an aggregator-priced candidate emits a placeholder leg and the resolver withholds the transaction rather than pretending it can fill.

## Index pages: returns, minimum, allocation — from real history only (20 Sep 2026)

The index list and detail pages now answer the three questions a buyer asks first — what did it return, what is the least I can put in, what is inside it — without inventing a number:

- **Returns are Chainlink history.** `apps/resolver/src/history.ts` (`PriceHistory`) reads past rounds of the BSC feeds (`phaseId << 64 | aggregatorRoundId`; the Mag 7 feeds reach back >2 years in the current phase) and binary-searches the round at or before any timestamp. One unit's price return over 1D/7D/1M/6M/1Y is Σ sharesPerUnit × price(t) over the constituents that have a feed. Dividends are excluded and the source says so. Every response carries `coverageBps` (share of today's NAV that has a feed): pxMAG7 is 7/7, pxAI 1/7 (NVDA only), pxNEW 0/7, and the cards say exactly that instead of showing a figure that looks complete. Rounds are immutable, so they persist in the resolver's SQLite (`chainlink_rounds`) and later searches are bounded by the rounds already known (~4 reads per lookup instead of ~25). A fork or testnet reads history from mainnet directly, not through anvil — it is the same chain history and forwarding thousands of reads through the fork took minutes.
- **Minimum investment = $5 × constituents.** The aggregator refuses legs under $5, so a 7-name index cannot be minted for less than $35. Presets and the Invest panel enforce it; the vault itself has no minimum.
- **Allocation is by value of one unit at today's reference prices** (`weightBps`), drawn as a donut with per-constituent cards: catalogue price, 24h move (Chainlink), 7-day path (Chainlink rounds, 14 samples; flat weekend segments are real), shares per unit, the issuers the vault buys from, and the `why` line from `bsc.json`.
- **Not deployed is stated, not hidden.** On mainnet quote-only the cards say "not deployed here", the Invest panel computes an indicative unit count from NAV and its button is disabled; on the fork/testnet the same panel quotes `usdAmount` through `/quote-mint` and signs.
- The landing's Plans frame listed constituents that did not match `bsc.json` (pxAI had NBIS, pxNEW had RDDT/ARM/FIG); corrected to the config.

Checked: the flat `218.33` run at the start of NVDA's 7-day series is Sunday 13 → Monday pre-open, when the feed does not move — not a search bug.

**Landing (same day):** the hero is now "Best execution and index layer for tokenized stocks" with "Invest in an index" as the primary action and index-first typewriter requests; the Plans frame shows the three indices as the product's index cards (marks, thesis, period return with a 1D–1Y switch, minimum, NAV) fetched live from the default network's resolver, with definitions from `bsc.json` and an explicit "offline" state instead of stale figures.

## Hybrid sandbox: mainnet markets, testnet capital (20 Sep 2026)

The hackathon rule is *"BSC mainnet only. Dry-run with the Transaction API while you build, then demo with small live amounts."* — so mainnet is where the submission demo happens (deploy deferred to the final week by decision, cost measured at ≈$1.32). Until then, and as the free click-through for anyone without USDT, BSC testnet runs a **hybrid**: every market fact comes from mainnet, only execution is on testnet.

- **Twins.** `contracts/script/config/mocks.json` is generated (`scripts/gen-mocks.mts`) from `bsc.json`: every representation of every index constituent (19 tickers, 36 tokens) becomes a mock token twinned with its mainnet token (`mainnetToken`). `mockTwins()` in the SDK builds the map from a deployment's `mocks`; the resolver (`Chain.twin`) routes every Binance catalogue lookup, Chainlink read and price-history read to the twin on a mainnet client; the keeper's ratio/attestation jobs do the same.
- **Mirror.** `MockSwapTarget` setters are now owner-or-keeper gated (`setKeeper`); the keeper's `jobMirror` (60 s) posts the twin's live catalogue `tokenPrice` onto the venue when it drifts ≥ 5 bps and keeps ERC-8056 mocks' `uiMultiplier` equal to the twin's onchain value. First live run: 14 `setPrice` txs on testnet, 22 mocks already within 5 bps of their seed.
- **Redeployed 97**: mocks, core, registry, pxDEMO3, pxMAG7 `0x99774177…3DFa`, pxAI `0x221cD798…a7F0`, pxNEW `0x6ed197d3…E445` (≈70M gas at 0.1 gwei). `scripts/testnet-up.sh` now creates the three indices too.
- **Faucet on testnet** (`FAUCET_PRIVATE_KEY`, per-address 6 h cooldown in SQLite): 10,000 mock USDT + 0.005 tBNB when the wallet is dry. Advertised on `/health.faucet`; the web shows "Get test funds" wherever a resolver advertises one.
- **Labels.** `/health.hybrid`, `/stocks.hybrid`, `/baskets.hybrid` spell out `markets` and `execution`; the toolbar chip reads "prices: mainnet · execution: testnet"; the web defaults to 97.
- **Done-signal** (`pnpm --filter @parallax-hood/scripts e2e:hybrid`): fresh wallet → faucet → `$100` → 1.0023 pxMAG7 on testnet (tx `0x421909a1…1a27`, 968k gas), each of the 7 legs within 8–14 bps of the mainnet per-share price (10 bps venue fee + mirror drift), backing 1.0031, 7 receipts indexed.
- Also: the invariant handler's `movePrice`/`driftMultiplier` had been silently reverting (`fail_on_revert = false`, handler was not owner/keeper); it now owns the mocks and is the venue keeper, so price moves and multiplier drifts are really exercised. Suite: 103 tests green.
- Basket detail no longer computes migrations inline (they quote every representation pair); `/migrations?basket=` is fetched separately by the page. Constituent reads in `summary()` run in parallel.

Testnet is **not** a venue the Binance Agentic Wallet supports (`baw wallet chains`: 56, 1, Solana, Base, Arbitrum, Polygon, Robinhood), which is the second reason the mainnet deploy is on the roadmap.

## Agent track: BNB Agent Studio seller + Binance Agentic Wallet (20 Sep 2026)

Rubric words, verified on the hackathon page: *Best Use of Agentic Wallet / Wallet Skills — "deepest, most credible use of the AI execution layer"*; *Best Use of BNB Agent Studio — "agent identity, autonomous runtime, self-funding via x402"*.

**Agent Studio (`agent/`, scaffolded with `bag init`, `@bnbagent/studio-cli` 0.0.14).** One seller runtime, one signer, three faces (A2A `:9000`, MCP `/mcp`, x402 `/x402`):
- **Identity**: ERC-8004 agent **#2453** on BSC testnet, wallet `0xBbFA8843…d4Ed` (`bag erc8004 register`, protocol MCP, sponsored gas).
- **Tools** (`agent/app/agent/src/parallax/tools.ts`): eight read-only Parallax tools over the resolver — search stocks, best-execution quote, list/get indices, quote an investment (with mandate policy pre-check), quote a buy, read a mandate, receipts. They are the LLM's tools in `runWork` and are also registered on the MCP face, so any MCP client sees `parallax_*` beside Studio's chain tools.
- **Execution is fixed code, never an LLM tool** (`parallax/work.ts`, `parallax/client.ts`): a funded ERC-8183 job or a paid/free x402 request whose task names an index or ticker, a dollar amount **and a mandate id** is planned through the resolver, re-checked against the mandate (agent, active, expiry, per-tx and daily caps, allowlist), signed with the Studio wallet (`getWallet().signTransaction`) and broadcast as `AgentMandate.agentMintBasket` / `agentBuyShares`. Anything ambiguous is research (tested: `work.test.ts`). The agent is never a recipient: after two executions on testnet the agent wallet holds 0 units and 0 USDT, the owner holds 0.7517 pxMAG7 and mandate 1's daily remaining fell from $500 to $425.32.
- **Recorded runs**: x402 face, free passthrough: "Invest $50 into pxMAG7 with mandate 1" → tx `0x1dc2053c…29c0` (0.5011 units, 7 legs). ERC-8183: buyer `0x2CDc04C6…1FcC` negotiated a signed quote over A2A, anchored job **1276** (`create 0x5ba43c3c…ea6c`), sent `notify_funded`; the seller executed `0xbe30ccf8…c87a` (0.2506 units) and submitted the deliverable `0x5a083bb9…1ba1` → job SUBMITTED. Settlement is the buyer's after the 24 h dispute window.
- **Idempotency**: an execution is a side effect, and the runtime's sweep retries a job whose deliverable failed to publish. Executions are recorded per job id in `.studio/parallax-jobs.json` and a retry returns the recorded deliverable (found the hard way: job 1276's first publish failed for want of `ERC8183_AGENT_URL`; the investment had already landed, so the ledger was seeded by hand from the resolver's receipts before re-notifying).
- **Price**: set to FREE (`price_usd = "0"`) for local runs. PAID x402 needs a B402 merchant application (Binance OnchainPay) for this exact wallet; PAID ERC-8183 needs testnet U in the buyer wallet (Telegram faucet). Both are on Aditya.
- Local-dev limits: deliverables are stored on local disk (`[storage].kind = "local"`), so the `deliverable_url` is not fetchable until deployed (the managed platform injects storage); the free Pieverse model leaks `</think>` reasoning, stripped in `stripThinking`.

**Agentic Wallet** (`@binance/agentic-wallet` 1.10.0, `baw`): no testnet support (`wallet chains` = 56, 1, Solana, Base, Arbitrum, Polygon, Robinhood), Developer Mode + two-step `contract-call preview → execute`. Pairing needs a QR scan in the Binance app; two codes expired unattended, so the pairing is Aditya's to run (`baw auth signin --json` → `baw auth verify`). Planned use once paired and mainnet is deployed: the Agentic Wallet is the mandate agent (or the owner), and `baw contract-call` carries `AgentMandate.*` / `BasketVault.mint` calldata built by the resolver, with Binance's simulation and risk parse in front of our onchain caps.

**Agentic Wallet paired and wired (same day).** Paired `baw` with Aditya's Binance app: BSC address `0x82Cc9C22…215a`, Developer Mode on. `apps/mcp` gained `agentic_wallet_status`, `compare_with_binance_wallet`, `agentic_wallet_preview` and `agentic_wallet_execute` (`agenticWallet.ts` wraps the CLI; the mandate planner was extracted from `execute_with_mandate` so either signer can use it). Recorded on mainnet: the wallet's own route for $100 of NVDA gives 0.453657 NVDAB ($220.60/share) vs 0.452763 NVDAon ($221.25/share) — the same aggregator fill Parallax chose (`agree: true`); a contract-call preview returned a request id with Binance's parsed tx, simulation and empty risk list. The MCP now starts on mainnet in quote-only mode (zero addresses) so the wallet tools work before the contracts are deployed; execution refuses off mainnet by construction (tested). B402 merchant onboarding was skipped by decision: the x402 face stays FREE.

## Protocol fee: 0.5 % of USDT notional (20 Sep 2026)

Aditya's call: the business model is a fee, not a token. `StockRegistry.setFee(bps, recipient)` (ADMIN, hard cap `MAX_FEE_BPS = 100`), charged by `ShareRouter` on buys (on the notional spent, out of the USDT sent in) and sells (out of proceeds) and by `BasketVault` on mints (on the USDT spent, out of the unspent remainder) and USDT redemptions (out of proceeds). **Never on `redeemInKind` or `migrate`**: the fee is a USDT flow only, so backing (B1) and the escape hatch (B2) are untouched — the vault invariant suite now runs with the fee on (invariant S5, `FeeTest`, 110 Foundry tests). Quotes carry `fee: { bps, usdt, totalUsdtIn | netUsdtOut, recipient }`: a buy sends `notional + fee` to the router, a mint's `maxUsdtIn` covers the fee on the worst case, sell/redeem minimums are net of it; the mandate paths authorize notional + fee. Deploy scripts read `FEE_BPS` (50) and `FEE_RECIPIENT` (default: the admin; the mocks chain uses anvil #9 so tests can separate fee flows from refunds). Consequence: the testnet sandbox must be redeployed (old vaults have no fee) and mandate 1 recreated.

**Testnet redeployed with the fee (same day).** Second redeploy of 97 (the keeper had to be stopped first: it shares the deployer key and raced the broadcast's nonces). Mandate 1 recreated on the new `AgentMandate`. Hybrid e2e: $100 → 1.0023 pxMAG7 with `FeeCharged` 0.50052 USDT to the recipient (tx `0xd1101e07…667a`); agent x402 run: $40 → 0.4009 units, fee 0.20 USDT (tx `0x98afc29b…daf4`). x402 `work_timeout_seconds` raised to 240: an execution needs a quote, a broadcast and a receipt wait.

## Audit round (pashov x-ray + 12-agent solidity-auditor), fixes and via-IR (20 Sep 2026)

Ran the pashov `x-ray` (verdict FRAGILE: 46 guards, 21 invariants, 7 not enforced onchain — `contracts/x-ray/`) and the `solidity-auditor` skill with all 12 hacking agents over `contracts/src`. Six findings survived dedup and gating, all fixed the same day; leads triaged below. Suite: 122 Foundry tests, resolver 18, MCP 8, keeper 2, agent parser 4 — all green.

- **F-1 `BasketVault.mint` checked aggregate backing only** → a caller could mint units against slack other holders built up, pay no fee and skip buy-eligibility with `legs = []`. Fix: `NoLegs`; snapshot holdings before legs; every constituent must receive `ceil(units × sharesPerUnit)` *from this call* (`UnderDelivered`). Consequence for the resolver: mint legs are sized on the units alone (slack stays with the holders who built it, and comes back pro-rata on redemption) — `quoteMint` no longer nets `heldShares` off the need.
- **F-2 `AgentMandate` let the agent pick `minShares`/`units` and the leg calldata** → a compromised agent key could turn the owner's capped USDT into dust for the owner and output for itself (multicall leg: 99 % to the agent, 1 % to the router passes `LegNothingReceived` and `minShares = 1`). Fix: owner-set `maxSlippageBps` (1–2000) on the mandate and an **execution floor** checked after the trade against the *measured* spend (fee included): `sharesOut ≥ spent × (1 − slip) / referencePrice`, units likewise against the unit's reference value. Reference prices live in the registry: `setPriceFeed` (ADMIN, Chainlink USD feeds for the Mag 7 on mainnet, `bsc.json.priceFeeds`) overrides the keeper's `postReferencePrice` (Binance `referencePrice`, new keeper job `prices`, bounded by `maxPriceStepBps = 20 %`), freshness `maxPriceAge = 36 h` (daily heartbeat, weekend gaps). Stale/missing → agent buys revert (`StaleReferencePrice`); nothing else reads the price. Rejected alternatives: an owner-typed `minSharesPerUsdt` (unusable, goes stale as prices move); selector/recipient decoding of leg calldata (ties the router to one DEX ABI, and multicall still hides recipients). `createMandate` gained the `maxSlippageBps` parameter (MCP `build_create_mandate` default 300, web form field, agent ABI slice regenerated).
- **F-3 `_settle` read the mandate contract's absolute balance** → stray USDT swept to the next owner and `spentInWindow` zeroed. Fix: snapshot before the pull, refund/count the delta only, capped at the authorization.
- **F-4 issuer cap skipped below two eligible reps, then enforced** → a vault concentrated during a pause could not mint (or migrate back) once the second rep returned. Fix: the cap is judged against the pre-call snapshot — over-cap platforms may only be diluted.
- **F-5/F-6 `ShareRouter` refunded absolute balances** → refunds are now `usdtIn − spent − fee` and `tokenAmount − sold` (`OverSpent`/`OverSold`).
- **Leads acted on**: keeper step bounds are now anchored over a rolling `STEP_WINDOW` (95 in-bound posts could move a ratio 103×); `checkpointRatio` is keeper-only (anyone could re-anchor the corporate-action guard before buying); `ReceiptEmitter` reads the ratio in a try/catch so a reverting ERC-8056 view cannot block sells (invariant 7); `setLimits`/`setPriceLimits` reject 0 and > 100 % steps.
- **Leads left as documented behaviour**: leg selector not allowlisted (balance-delta model; SmartRouter holds no balance between txs); fee evasion via a leg that pays the seller directly (`LegNothingReceived` fires, so no); fixed 24 h window (2× cap at the boundary is the documented semantics); backing on live ratio (that *is* the share model); mandate basket allowlist without factory provenance (owner-inflicted); `decimals`/flags stored, unused.
- **`via_ir = true`.** `BasketFactory` embeds the vault initcode and crossed the 24,576-byte limit after F-1/F-4 (24,894). Via-IR brings it to 21,611 with all tests green, and unblocks `forge coverage` (was stack-too-deep in `migrate`). Deploy artifacts on every network are now via-IR builds.
- Consequence: contracts on testnet (97) are stale again and must be redeployed before the mainnet deploy; the Agent Studio seller and MCP need mandates recreated with a slippage bound.

## Minimum investment: $5, raised only where a desk forces it (21–22 Sep 2026)

Aditya asked first for no minimum, then for $5. The old floor was `constituents × $5` ($35 on pxMAG7), a rule of
thumb. The real constraint was measured instead (`scripts/probe-desk.mts`, 22 Sep): the Binance aggregator's RFQ
desk answers `40375 Minimum order amount is 5 USD` for anything at or below $5.00 and fills from $5.05. It is a
**per-leg** minimum, and it only binds for a constituent with no usable pool — on BSC, AAPL and AMZN exist only as
Ondo tokens whose PancakeSwap v3 pool is dust (a $5 AAPL buy quotes 8,000 bps of slippage), so the desk is their
only route. Everything else (NVDA, MSFT, GOOGL, META, TSLA…) fills from PancakeSwap at any size.

So `Baskets.minUsd` is `$5` (`FLOOR_USD`), raised to `AGG_MIN_LEG_USD / weight` for any desk-only constituent.
Today: $5 on every testnet index (mock venue, no desk), and on mainnet pxMAG7 $36, pxAI $51, pxNEW $100 — the
amount that gives the desk-only name its own $5.05. Lowering those needs liquidity for the Ondo tokens or an
index whose constituents all have pools, not a smaller constant.

## Price history beyond Chainlink: three sources, chosen per constituent per period (22 Sep 2026)

pxNEW showed `n/a` in every period because Chainlink's BSC feeds cover the Mag 7 and nothing else, and the index
holds SpaceX, Circle, CoreWeave, Coinbase, Robinhood, Palantir and Nebius. What is actually available was
measured, not assumed (`scripts/probe-market.mts`, `scripts/probe-twap.mts`):

- **Binance RWA `underlying-market`** carries no time series, but does carry the underlying's 52-week high/low,
  market cap, P/E, P/B, dividend yield and 24h share volume.
- **PancakeSwap v3 pools keep their own TWAP oracle.** HOODB's 0.25 % pool has `observationCardinality = 2000`,
  so `observe([86400, 0])` returns a time-weighted price a day back that no single trade can move. Depth depends
  on how often the pool trades: HOODB reaches ~2 days. COINB's pool holds one observation; CRWVB, PLTRB and
  NBISB have no USDT pool of depth.
- **Daily closes of the underlying stock** (Yahoo's public chart endpoint, no key) reach two years for every
  constituent of all three indices, with the company name returned alongside so a ticker collision is visible.
  Spot-checked against our own reference prices: NVDA 227.38 vs 227.97, CRWV 85.43 vs 85.19, NBIS 232.80 vs
  231.38.
- **Rejected**: The Graph and the PancakeSwap subgraphs (endpoint moved, gateway wants a key, proxy returns
  empty) and `Swap`-log scanning (rate-limited on public BSC RPCs).

`Baskets.pricePair` picks **one source per constituent per period** — whichever can price *both* ends of it, so
no figure straddles two sources and inherits the gap between them. Order: Chainlink, then daily closes, except
for the 24h figure where a live pool oracle outranks a close that is hours old. When both ends of a "1 day" land
on the same daily bar (the market is shut), the earlier end steps back to the previous session, so the figure is
a real close-to-close move rather than zero. `coverage[period]` reports the share of NAV priced at both ends.

Result: every period on every index now carries a real figure — pxMAG7 100 % from Chainlink, pxAI 100 %, pxNEW
100 % on 1D/7D/1M and 76 % on 6M/1Y, because SpaceX and CoreWeave listed too recently to have a year. The daily
closes are display-only: returns and NAV read from them, nothing that executes or settles does. Cached in SQLite
(`market_bars`), refreshed hourly, disabled on the mocks chain and via `MARKET_HISTORY=0`.

## A mint quote is sized by what the buyer spends, not by NAV (24 Sep 2026)

`quote-mint` took `usdAmount` and turned it into units at NAV: `units = usd * 1e18 / navPerUnit`. Typing $100
therefore built an order that cost **$101.59** — NAV is what a unit is worth, not what it costs to assemble, and
the difference is the protocol fee plus the venues' spread. Two consequences, both real: a "Max" button set from
the wallet's USDT balance produced a quote the wallet could not pay, and an agent with a $50 per-tx mandate cap
had its own $50 budget rejected onchain by `PerTxCapExceeded`.

`budgetUsdt` sizes the other way round: units are priced at NAV times the cost of a dollar of NAV *measured on
the last clean plan for that basket*, so `maxUsdtIn` — the ceiling the vault may pull, fee included — lands inside
the budget. When the estimate overshoots (a cold cache, or a spread that moved), the plan runs once more with the
cost it just measured; a cold cache assumes 3 % and therefore undershoots, which is the safe direction. Measured
on mainnet: a $100 budget → `maxUsdtIn` 99.77, expected 99.48, units worth $98.28 at NAV. One pass when warm.

`usdAmount` stays for callers that really do mean "$X of NAV". The three MCP mint paths pass the budget through,
because that is what a mandate's caps count.

## The keeper's gas bill was in its heuristics, not its job list (24 Sep 2026)

The mainnet keeper spent ~$2 of BNB in about two days and then stopped posting, which aged out the Ondo ratios
(47 h against a 12 h window) and both attestations (53 h against 36 h) and left every mainnet quote reporting
"0 eligible representations". Nothing was wrong with what the keeper posts; everything was wrong with *when*.
Measured on mainnet: a registry post costs 34,258 gas at 0.05 gwei, so the bill is a count of transactions.

- **Ratios re-posted on a timer.** The trigger was `value unchanged && age < RATIO_INTERVAL × 3` → an unchanged
  ratio was re-posted every 30 minutes, ~900 transactions a day, none of which told the registry anything. The
  refresh is now driven by the registry's own `maxRatioAge`: post on a move of ≥ `RATIO_POST_MIN_BPS`, or at half
  the window, so a missed run still cannot let a ratio expire. 19 representations × 4 a day = 76.
- **Reference prices posted for underlyings nothing could buy.** `AgentMandate` is the only contract that reads
  `referencePrice` — it is the floor an agent's execution is held to. Mainnet has no mandate at all (`nextId`
  is 1), yet 12 prices were re-posted on every 25 bps tick. The job now posts only for underlyings a live,
  unexpired mandate can reach (its allowed underlyings plus the constituents of its allowed baskets), and the
  drift trigger moved from 25 bps to 100: this is an execution floor, not a price feed.
- **Market state posted where nothing reads it.** No contract reads `marketState`; off the mocks chain the
  resolver takes market status from Binance with an exchange-calendar fallback. Two posts per underlying per
  trading day bought nothing. `POST_MARKET_STATE` now defaults to the mocks network, and the job posts only on a
  change rather than on a heartbeat.

Two guards make the failure mode visible instead of terminal: the keeper stops sending below
`KEEPER_MIN_BALANCE_BNB` (and says which address to fund) and above `KEEPER_MAX_TX_PER_DAY`, and every
attestation past half its window raises an alert naming the manual command, rather than a silent expiry.
`KEEPER_SCOPE` defaults to the underlyings a deployed vault actually holds.

`keeper plan` costs a pass without sending it: what it would post and why, what is about to expire, and the
steady-state bill. Mainnet, 24 Sep: **78 transactions a day, 0.000156 BNB**.

For comparison, the old triggers at full cadence would have sent roughly 900 ratio posts, 900 market-state posts
and a few hundred price posts a day — about 0.0036 BNB/day, projected from the trigger logic rather than
measured. What *was* measured is the wallet: 0.0023 BNB down to 0.00061 over the two days it ran, so ~0.00085
BNB/day with the keeper up only part of the time. Either way the fix is the same order of magnitude: about
twenty times cheaper, and the difference is entirely posts that told the registry something it already knew.

## Freshness is measured against the chain's clock, and an outage says why (24 Sep 2026)

Two smaller defects that the same outage exposed. The basket mint path reported `0 eligible representation(s)`
and nothing else, while the single-stock path had explained staleness in the registry's own terms all along;
`planMint` now reuses `reasonsForRegistry`, so a blocked constituent reads *"AAPLon: keeper ratio stale (14.3 h >
12 h)"*. And every freshness comparison ran against `Date.now()`, which is not the clock the registry enforces —
on a fork or a mocks chain whose time was advanced, the resolver called a representation fresh that the contract
had already aged out. `Chain.now()` reads `block.timestamp` (memoized 5 s, wall clock as a fallback).

Separately: the resolver's database defaulted to one `parallax.db` for every chain. Receipts and quote records
carry no chain column, so running mainnet and the mocks chain side by side — the documented demo flow — mixed
them, and SQLite locked the second process out. The default is now `parallax-<chainId>.db`, copied once from the
old file so an existing index is carried over rather than re-fetched.

## Freshness windows should match how the data behaves, not how often we hoped to post (28 Sep 2026)

Mainnet spent most of three days refusing to quote, and every time the reason was a freshness window rather than
a price. The windows were set from an assumption — issuers attest daily, a keeper runs constantly — and neither
assumption survived contact with the data.

**Attestations.** Ondo's newest published daily report is `daily-2026-09-22.pdf`, four days old, and bStocks
publishes no dated report at all: its profile carries a collateral report with a null url, because the proof is
`uiMultiplier()` on the token itself. A 36-hour window could not be satisfied by either issuer, ever. The window
is now seven days, and for an ERC-8056 platform the keeper attests to a verified read of every representation's
multiplier rather than to a document that does not exist.

**Ratios.** Measured on 28 September, 33.5 hours after the last post: **all nineteen keeper-sourced ratios were
byte-identical to the live catalogue**. AAPL 1.00337607, NVDA 1.00171524, MSFT 1.00573085, and eleven that are
exactly 1. They move when Ondo reinvests a dividend, which is quarterly, not twice a day.

And staleness here is conservative, which is the part that makes a wider window defensible rather than lazy.
`shares = tokens × ratio`, and these ratios only accrue upward. An old, lower ratio credits *fewer* shares for
the same tokens, so a buy's `minShares` floor is stricter and a vault's `heldShares` is understated: both errors
point at the protocol's side of the table. A stale *high* ratio would be the dangerous direction, and a
monotonically accruing ratio cannot produce one. `maxRatioStepBps` still caps any single post at 5%.

So both windows are seven days. The keeper refreshes at half-life, which means about twice a week per token
instead of four times a day: roughly 5 transactions a day rather than 76, and a wallet that lasts fifty days
rather than three. The keeper stops being life support and becomes what it should have been, a heartbeat whose
absence degrades the product slowly and visibly instead of switching it off overnight.
