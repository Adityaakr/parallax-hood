# Architecture

```mermaid
flowchart LR
  subgraph Offchain
    U[User / Claude via MCP] -->|resolve, quote| R[Resolver · Hono]
    K[Keeper] -->|ratios · attestations · market state| REG
    K -->|GET /migrations| R
    R -->|RWA data, quotes, simulate| B[(Binance Web3 API<br/>live or labeled fixtures)]
    R -->|quoter, feeds, registry| RPC[(BSC RPC)]
    R --> DB[(SQLite: quote records, receipts index)]
    M[MCP server] --> R
    M -->|agent key, mandate only| AM
    W[Web app · Next.js] --> R
    W -->|sign| RPC
  end
  subgraph Onchain · BSC
    REG[StockRegistry<br/>underlyings · representations · ratios · attestations · target allowlist]
    SR[ShareRouter<br/>buyShares / sellShares<br/>minShares in shares]
    BV[BasketVault pxMAG7<br/>mint · redeem · redeemInKind · migrate]
    BF[BasketFactory]
    AM[AgentMandate<br/>caps · expiry · allowlists]
    SR --> REG
    BV --> REG
    BF --> BV
    AM --> SR
    AM --> BV
    SR -->|legs| P[(PancakeSwap v3 pools)]
    BV -->|legs| P
    P --> T1[NVDAB… bStocks ERC-8056]
    P --> T2[NVDAon… Ondo GMToken]
    REG -.uiMultiplier.-> T1
    REG -.Chainlink feeds for display.-> CL[(Chainlink)]
  end
```

## Request flow: "buy $500 of NVDA"

1. **Identity.** Resolver reads `StockRegistry.representationsOf(NVDA)` → `[NVDAB, NVDAon]` with ratio (live ERC-8056 multiplier or keeper-posted), attestation timestamp, eligibility. Binance `rwa/tokens` (if connected) adds symbols, reference prices, market status.
2. **Quote.** For each representation, PancakeSwap QuoterV2 across fee tiers (dust pools skipped) → `tokensOut`; `sharesOut = tokensOut × ratio / 1e18`; marginal probe → slippage; Chainlink reference → premium (effective, incl. gas; ex-gas shown too).
3. **Policy.** Attestation age, premium caps (open / closed market), slippage cap, platform preferences/exclusions, issuer cap on the wallet's resulting holdings. Every exclusion carries a reason string.
4. **Route.** Rank eligible candidates by shares per dollar; if the best single route slips > 20 bps and a second route exists, search 90/10…10/90 splits and keep the max-shares plan. Build legs (`exactInputSingle` with recipient = ShareRouter) and `minShares = sharesOut × (1 − slippage)`.
5. **Record.** Canonical JSON of everything above → `quoteHash = keccak256`. Stored in SQLite, served at `GET /quotes/:hash`.
6. **Simulate.** `eth_estimateGas` from the user; if USDT isn't approved yet, the allowance/balance storage slots are discovered and overridden so the route is still verified. Failing transactions are withheld.
7. **Execute.** User (or agent via `AgentMandate`) signs `ShareRouter.buyShares(NVDA, usdtIn, minShares, legs, recipient, quoteHash)`. The router checks allowlisted targets, buy eligibility, executes legs by balance deltas, checks `Σ shares ≥ minShares`, forwards tokens, refunds USDT and emits `RouteReceipt(quoteHash, …, sharesOut, ratio, attestedAt, action)`.
8. **Index.** Resolver polls `RouteReceipt` logs from the router and every basket; `GET /receipts` joins them with the stored record; the UI's "why" drawer and MCP `explain_receipt` render it.

## Basket flow: mint 1 pxMAG7

Required shares per constituent = `units × sharesPerUnit`; the resolver subtracts any surplus already held, prices each eligible representation with exact-output quotes, allocates best-first within issuer caps (20 bps haircut), and emits `exactOutputSingle` legs with `amountInMaximum = quote + 30 bps`. `BasketVault.mint` pulls `maxUsdtIn`, runs legs, mints, checks the backing invariant and caps for every constituent, and refunds unused USDT. Redeem sells pro-rata slices through the best exits and delivers anything unsold in kind; `redeemInKind` needs nothing but the token list.

## Data provenance

| Field | Source | Label |
|---|---|---|
| ratio (bStocks) | `uiMultiplier()` onchain | `ERC8056` |
| ratio (Ondo) | keeper post from Binance `tokenToShareRatio` (or seeded config) | `KEEPER` + `ratioUpdatedAt` |
| attestation | keeper post from Binance `underlying-profile` daily report date; manual with provenance | `attestedAt` |
| reference price | Chainlink push feed (24h heartbeat, 0.5 % dev) ; Binance `referencePrice` as alt | `referenceSource` |
| market status | Binance `statusInfo` → computed NYSE calendar → registry | `market.source` |
| quotes | PancakeSwap QuoterV2 (contract-executable) | `venue` |
| Binance availability | `live` / `fixtures` | `dataSource`, header badge |

## Packages

| Path | Role |
|---|---|
| `contracts/` | Foundry: `StockRegistry`, `ShareRouter`, `BasketVault`, `BasketFactory`, `AgentMandate`, `ShareMath`, `LegExecutor`, mocks, tests (unit/fuzz/invariant/fork), deploy scripts, configs |
| `packages/sdk` | generated ABIs, ids, share math mirror (parity-tested), leg encoding, receipt decoding, chains/addresses, deployment loader |
| `packages/binance-client` | signed Binance Web3 client with zod, retries, token bucket, TTL cache, fixtures/record modes |
| `apps/resolver` | scoring, policy, splits, basket quoting, simulation, quote store, receipts indexer, HTTP API |
| `apps/keeper` | ratio/attestation/market posting (bounded), ERC-8056 checkpoints, migration bot, dry-run, health |
| `apps/mcp` | MCP server (stdio + HTTP), 11 tools, mandate-only writes |
| `apps/web` | Next.js UI: buy, baskets, basket detail, receipts, mandates, about |
| `scripts/` | `fork-up.sh` (mainnet fork on :8547), `mocks-up.sh` (mocks chain on :8548) |
