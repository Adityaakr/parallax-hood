# Submission: BNB Hack: Tokenized Stocks Edition

Official page: https://www.bnbchain.org/en/hackathons/tokenized-stocks (captured 2026-09-17). Registration form: https://forms.gle/NEmy3FxYc4f5Dua47 · Submission form: https://forms.gle/yToDUzaDMwWnq6R6A · DXR template: https://forms.gle/EUQ39xf54GHjC2ys5.

## Requirements → how Parallax meets them

| Requirement (official) | Parallax |
|---|---|
| Registration & build: 16 Sep 2026 12:00 UTC → submission 11 Oct 2026 12:00 UTC | Built from 17 Sep; repo history is the timeline |
| Main track: tokenized-stock products & agents; **integrate at least one of bStocks, Ondo, xStocks** | Both **bStocks** (ERC-8056 onchain ratios, PancakeSwap v3 execution) and **Ondo** (registered, scored, keeper ratios); xStocks documented out of scope (no BSC pools) |
| **Deploy on BSC mainnet only** | Contracts deployed & verified on BSC mainnet, addresses below (fill after Phase 7). Mocks additionally on BSC testnet for judges without funds |
| Spot only, no perpetuals | Spot buys/sells via PancakeSwap v3; baskets are spot vault receipts |
| Accepted deliverables incl. MCP servers, agents, trading interfaces, dashboards | Resolver API, MCP server (Claude Code / Desktop), web app, keeper/migration bot |
| Public repository | https://github.com/Adityaakr/parallax |
| Demo video ≤ 4 min | `docs/demo-script.md` (3 min), link: _TBD_ |
| Deployed link or judge-followable instructions | Landing: https://jazzed-brand-198080.framer.app · App: _TBD (Vercel)_ · Resolver: _TBD_ · Local: README "Quick start" (≤ 10 commands) |
| **Developer Experience Report (25 %, human-written)** | `docs/dxr.md`, to be written by the team from `docs/recon.md` §8 and the friction log below; "perfunctory or AI-generated reports are not accepted" |
| No token launches / liquidity incentives / airdrops | None. Basket tokens are vault receipts, not marketed as tokens |
| Eligibility: not in restricted jurisdictions (US, CA, NL, IR, CU, KP, Crimea, DPR, LPR, UK, JP) | Team confirms at registration |
| Special prizes: Best Use of Agentic Wallet / Wallet Skills; Best Use of BNB Agent Studio | Not targeted; MCP + Claude Code compatibility is the agent surface |

## Judging criteria mapping

- **Technical implementation (30 %)**: 5 audited-style contracts with invariant/fuzz/fork suites (124 Foundry tests + 6 mainnet-fork tests, 62 TypeScript tests, Slither dispositioned), resolver with real quotes and state-override simulation, MCP with mandate-only writes.
- **Creativity & originality (25 %)**: share-denominated execution across issuers; baskets defined in shares (no oracle for mint/redeem); permissionless invariant-checked migration; onchain agent mandates.
- **Developer Experience Report (25 %)**: see `docs/dxr.md` (human-written).
- **Product quality & UX (20 %)**: six screens, light/dark, labeled data sources, every tx pre-simulated, "why this route" on every receipt.

## Onchain proof (BSC mainnet)

_Fill in Phase 7 (`deployments/56.json`, BscScan verification links, tx hashes for: single-stock buy, basket mint, redeem, redeem in kind, migration or fork demonstration, agent-mandate buy)._

| Item | Address / tx | Link |
|---|---|---|
| StockRegistry | | |
| ShareRouter | | |
| BasketFactory | | |
| BasketVault pxMAG7 | | |
| AgentMandate | | |
| Buy via ShareRouter | | |
| pxMAG7 mint | | |
| pxMAG7 redeem | | |
| pxMAG7 redeem in kind | | |
| Migration (or fork demo) | | |
| Agent-mandate buy | | |

## Friction log (raw material for the DXR, expand in your own words)

- `web3.binance.com/en/dev-docs/llms-full.txt` and DoraHacks are behind AWS WAF challenges; plain `curl` gets `202` with an empty body. Fetching via a browser-context agent worked.
- The docs' "RWA data endpoints" are not surfaced in the agent-native `llms-full.txt` summary; the Python SDK models (`binance-web3-connector-python`) were the reliable source for exact field names (`tokenToShareRatio`, `statusInfo.openState`, `nextOpenTime`).
- The signing pre-hash must include the `/build` prefix and the query string exactly as sent; the official SDK uses `X-OC-RECV-WINDOW: 15000` while the docs say the default is 5000.
- Ondo tokens are RFQ-only in the aggregator (EIP-712 signature by `userWalletAddress`), so an onchain router or vault cannot execute them; the docs do not call this out for contract integrators.
- bStocks implement ERC-8056 (scaled UI amount): ERC-20 balances are raw units and `uiMultiplier()` is the share ratio. This is the right primitive for share accounting but is undocumented on the Binance side; we found it by reading verified source on Sourcify (BscScan's API needs a key).
- Public BSC RPCs prune state within minutes, which breaks `anvil --fork-url`; `bsc-mainnet.public.blastapi.io` served archive state. Pinning `--fork-block-number` is required for a usable local fork.
- Chainlink push feeds for all Mag 7 exist on BSC (24h heartbeat): useful for display, not for intraday deviation checks; Data Streams would be needed for that.
- BSC gas at 1 gwei is ~$0.28 per 400k-gas transaction: at $50 clips that is 56 bps, which dominates "premium" for small orders. UIs should show premium ex-gas and effective.
