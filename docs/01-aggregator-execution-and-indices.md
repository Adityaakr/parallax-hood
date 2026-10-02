# Aggregator execution + curated indices — architecture and roadmap

*Written 20 Sep 2026. Ship run: `feat/aggregator-execution-and-indices`.*

## What we are building

Two things, in order:

1. **Execution through the Binance aggregator**, not just PancakeSwap pools. The aggregator reaches
   Kipseli, Metric, Uniswap v3/v4, Tessera and the RFQ desks (Halfmoon, Native, Neptune) — the only
   real liquidity for Ondo tokens. Quoting it already landed; this makes those routes *signable*.
2. **Curated index products** on top of that execution: a handful of baskets with stated weights and a
   written rationale, minted through whichever issuer is cheapest at mint time, plus the one honest
   return number tokenized stocks have — **share-ratio drift**, which is dividends reinvested.

## Recommendation

**Add the aggregator as an allowlisted leg target and fetch its calldata at resolve time.** Keep the
leg shape we already have; keep LegExecutor's balance-delta accounting untouched; gate the whole thing
behind an admin allowlist so it is off until deliberately enabled.

### Why

- **The leg shape already fits.** `Leg = {target, data, tokenIn, maxIn, tokenOut}` and LegExecutor
  allowlists `target`, `forceApprove`s `maxIn`, calls, resets the approval to zero and credits the
  **measured balance delta** (`contracts/src/libraries/LegExecutor.sol`). Opaque third-party calldata
  is precisely the case that design was built for — we never trust what the calldata claims.
- **The router pays `msg.sender`.** Verified against the live API: `buildSwapTransaction` returns
  byte-identical calldata for an EOA taker and a contract taker, and the taker address appears
  nowhere in the 4,554-byte payload. Output therefore follows `msg.sender`, so when ShareRouter or
  BasketVault makes the call, the tokens land on the contract that measures the delta.
  `to == approveTarget == 0xB44446b0c8E56988c34f7Ff73Ae904982b5FdDA5` for every quote we have taken.
- **Share-denominated slippage still protects us.** Whatever the aggregator does internally, the buy
  reverts unless `sharesOut ≥ minShares` computed through registry ratios (invariant 4). A stale or
  re-priced RFQ quote fails closed.
- **It is the difference between half a product and a product.** Measured at $500: `COINon` via
  *Rfq Halfmoon* $194.41/share beats `COINB` via *Rfq Neptune* $194.95; `NVDAB` via
  *Kipseli+Metric+Uniswap V3+Pancake* $221.98 beats `NVDAon` $224.52. Without the aggregator, Ondo is
  unquotable and roughly half the universe collapses to a single issuer — there is no "best of two".

### Steelman of the rejected option: stay on PancakeSwap only

The strongest case against: PancakeSwap calldata is ours end to end — we build it, we know the exact
function, the pool and the fee tier, and there is no third party that can change behaviour under us.
Aggregator calldata is opaque, fetched over an authenticated API at signing time, priced by desks that
can re-quote, and it introduces an availability dependency (no API key, no route). A hackathon judge
can read our PancakeSwap leg and verify it; they cannot read 4.5 KB of aggregator payload.

That is all true, and it is why the aggregator ships **behind an allowlist, with balance-delta
accounting and share-denominated minimums, and with PancakeSwap always quoted alongside**. But it does
not survive the core fact: on ~half the universe PancakeSwap has no pool for the Ondo side at all, so
"only quote what we can build ourselves" silently means "only ever route to bStocks" — which is not a
best-execution product, it is one issuer with extra steps.

## Assumptions and falsifiers

| Assumption | Falsifier |
|---|---|
| The aggregator router pays out to `msg.sender` | A fork execution where ShareRouter's balance delta is zero after the call |
| A contract taker is accepted by the RFQ desks | The swap endpoint errors, or the tx reverts, when the taker is a contract |
| Quote lifetime is long enough to sign | Fork execution reverts on a quote fetched seconds earlier |
| `0xB44446b0…FdDA5` is stable | The address changes per quote — then it must be allowlisted dynamically, which we will not do |

## Roadmap (thin vertical slices)

| # | Milestone | Acceptance | Proof |
|---|---|---|---|
| **M1** | Aggregator leg executes on a mainnet fork | A real buy through `0xB44446b0…` credits shares ≥ minShares | scripted fork run, balance delta asserted |
| **M2** | Resolver builds aggregator transactions | `/resolve` returns a signable tx when the aggregator wins; simulation passes | resolver test + fork buy via `/resolve` output |
| **M3** | Curated indices defined | 3 index products with weights + rationale in config, createable | basket creation on the fork, backing ≥ 1.00 |
| **M4** | Index UI + ratio drift | Baskets page shows each index, its constituents and measured ratio drift | page renders from live resolver data |
| **M5** | Adversarial pass | No criticals open | feedback fleet, reproduced findings |

Mainnet deployment stays a **hard stop** for Aditya: it is the one irreversible step, it needs funds,
and nothing above requires it to be proven.
