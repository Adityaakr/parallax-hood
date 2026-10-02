# 02 — Hybrid demo: mainnet markets, testnet capital

*20 Sep 2026 · prism-ship architecture. Evidence tiers: `verified` (re-opened file:line / ran), `supported`, `unverified`.*

## Recommendation

Keep every **market fact** sourced from BSC mainnet and move only **execution** to BSC testnet, by giving the
resolver and keeper one shared idea: a *mirror* — each mock representation on a mock network is twinned, by
symbol, with its real mainnet representation from `contracts/script/config/bsc.json`. Everything that reads a
market (Binance catalogue prices, reference prices, market state, attestation dates, Chainlink references and
round history) looks up the **mainnet twin**; everything that moves tokens (registry ratios, venue swaps,
vault mints, receipts) runs on the **testnet contracts**. The keeper closes the loop by posting the twin's live
price and ERC-8056 multiplier onto the testnet mocks, bounded by the same step limits as any ratio post.

## Why

1. **It is the smallest change that makes the demo real end to end.** The testnet deployment already runs our
   real contracts with `MockSwapTarget` (`setPrice`, `contracts/src/mocks/MockSwapTarget.sol:34`, verified) and
   `MockStockToken.setMultiplier` (`:41`, verified). The resolver already prices mock venues
   (`apps/resolver/src/providers/venues.ts:98`, verified) and already reads Chainlink history from mainnet on
   non-mainnet networks (`apps/resolver/src/app.ts` `historyClient`, verified this session). The keeper already
   has the bounded submit path and a ratio job that reads Binance per token (`apps/keeper/src/keeper.ts:57,115`,
   verified). What is missing is the *twin lookup* and the *mirror job*.
2. **No fabricated data (invariant 8).** Prices are the real catalogue prices at the moment of the quote; the
   mock venue is a labelled venue whose prices are set from a named source. The UI labels the split explicitly.
3. **Nothing on mainnet is touched.** Mainnet stays quote-only; `pnpm mainnet:up` remains a separate, explicit
   one-way door.

## Design

- **Config.** `contracts/script/config/mocks.json` is generated from `bsc.json`: every representation of every
  index constituent (17 tickers) becomes a mock with `mainnetToken`, `erc8056`, `ratio` and `priceUsd` seeded
  from the live catalogue at generation time. `basket` (pxDEMO3) stays for the mandate/test flows.
- **Contracts.** `MockSwapTarget.setPrice/setFeeBps/setMode` become owner-or-keeper gated (`setKeeper`), so a
  stranger cannot re-price the demo venue. Mock mints stay open (test funds by design).
- **Resolver.** `Chain.mirror(token)` → twin `{ token, ticker, symbol, platform }` on `mocks`/`bscTestnet`.
  `BinanceProvider.token()`, `marketStatus()`, `referencePrice`, `chainlinkPrice` and `PriceHistory` resolve
  through the twin and a mainnet client. `/health` reports `hybrid: { prices: "bsc mainnet", execution: "bsc
  testnet" }`; quotes carry `priceSource: "mainnet-mirror"`.
- **Keeper.** `jobMirror` (every `MIRROR_INTERVAL_MS`, default 60 s): for each mock rep with a twin, read the
  twin's catalogue `tokenPrice` and (ERC-8056) live `uiMultiplier()` on mainnet; `setPrice` on the venue when the
  drift ≥ `MIRROR_DRIFT_BPS` (5), `setMultiplier` on the mock when changed, then the existing ratio/attestation
  jobs post through the registry using the twin for their Binance lookups.
- **Faucet.** `apps/resolver/src/faucet.ts` gains a `bscTestnet` path: mint mock USDT and top up tBNB from
  `FAUCET_PRIVATE_KEY` (the deployer), rate-limited per address in the resolver's SQLite `kv`.
- **Web.** Network chip and product pages label the split; index cards on 97 read "live here"; the invest
  panel signs on testnet. Default chain 97.

## Steelman of the rejected option: deploy to mainnet now

Strongest case: it is $1.32 and every figure becomes a real BSC receipt; no mirror machinery at all. Rejected
for the demo because judges then need real USDT to click through, every test mint spends real money, and the
aggregator's RFQ routes cannot be exercised by a contract taker yet (recorded 20 Sep). The hybrid gives a
click-through with free funds and keeps the mainnet door open for a final recorded run.

## Assumptions and falsifiers

- Binance catalogue `tokenPrice` is per **raw token**, so the venue price per mock token equals it directly and
  the per-share price is `tokenPrice / ratio` (matches `resolve.ts:61–65`, verified). Falsifier: a mint whose
  cost per share disagrees with the mainnet quote page by more than the venue fee (10 bps).
- Testnet gas at 0.1 gwei (`cast gas-price`, verified) makes the full redeploy ≈ 0.007 tBNB; the deployer holds
  0.298 tBNB (verified).
- BSC testnet public RPC tolerates ~40 sequential deploy txs with `--slow` (the previous deploy did; supported).

## Open questions for Aditya

- None gating. Optional: whether the faucet should also give tBNB (it will, 0.005, while the deployer can afford it).

> Cross-tier verification reduces instance- and tier-level error correlation but not shared-lineage blind
> spots. Treat cross-tier survival as weaker evidence than grounding.

## Roadmap (thin vertical slices, dependency order)

| # | slice | done-signal |
|---|---|---|
| M1 | mocks.json generated from bsc.json indices + live prices; `MockSwapTarget` keeper gate; forge tests green | `forge test`; `mocks.json` has 17 tickers, every rep has `mainnetToken` |
| M2 | resolver mirror: twin lookup, mainnet client for Binance/Chainlink/history on mock networks, `/health.hybrid`, labels | vitest + `/stocks/NVDA` on chain 97 shows mainnet catalogue price and chainlink reference |
| M3 | testnet redeploy: mocks, core, registry, pxDEMO3, pxMAG7/pxAI/pxNEW | `deployments/97.json` has three `basket_px*`; `/baskets` on 97 lists them `deployed: true` |
| M4 | keeper `jobMirror` + twin-aware ratio job; dry-run then live on 97 | venue price of NVDAB-mock within 5 bps of mainnet catalogue price after one run; a `setPrice` tx hash on testnet |
| M5 | faucet on testnet + web labelling + default chain 97 | fresh wallet → faucet → invest $100 in pxMAG7 → testnet receipt in `/receipts` |
| M6 | landing reads live cards from 97; docs/decisions + demo-script | screenshot; `next build` |
