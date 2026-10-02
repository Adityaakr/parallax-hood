# Invariants

What must hold on Robinhood Chain, where the code enforces it, and the test that proves it. Test paths are
under `contracts/test/` unless a path says otherwise. Every test name below was checked against the source.

Two things to know when reading the tests:

- The unit, fuzz and invariant suites run on mocks: `MockUSDG` (6 decimals), `MockSwapTarget`, and three
  `MockStockToken`s spread over two mock issuers, one with an ERC-8056 multiplier and one with a posted ratio.
  Robinhood Chain has one issuer per stock; the second mock issuer keeps the multi-issuer paths (issuer caps,
  migration, split routes) covered (D9 in `docs/decisions.md`).
- The real tokens, feeds, USDG and Uniswap v3 pools are exercised by `fork/RobinhoodChain.t.sol`, which forks
  chain 4663. It is opt-in (see "How to run").

The letter ids (B1, R1, L1, S1, A1, M1 and so on) are the ones `contracts/PROPERTIES.md` cites, so they are kept
stable.

## The eight invariants

### 1. Backing (B1, B1a)

For every constituent `i` of a vault, `Σ balance(rep) × ratio(rep) >= totalSupply × sharesPerUnit(i)` after
every state-changing vault call. Both sides are compared exactly at 1e36 scale, with no rounding on either side
(`_heldSharesWad`). `heldShares(i)` is the left side divided by 1e18, for display. `ratio` is the token's live
`uiMultiplier()`.

A mint also has to pay for itself (B1a): the legs of that call must deliver, for every constituent, at least
`units × sharesPerUnit` shares. Surplus other holders built up (rounding residue, a donation, multiplier growth)
cannot be minted against, and `legs = []` reverts.

Enforced by: `BasketVault.mint` → `NoLegs`, `_checkDelivered`, `_checkAllBacking` after `_mint`; `migrate` →
`_checkBacking(idx)`; `redeem` and `redeemInKind` remove at most the pro-rata slice, rounded down. `backingOk()`
exposes the check.

Limit: held shares are computed from live balances and the live multiplier. A burn by the issuer from the
vault's address, or a multiplier decrease, lowers them from outside and no vault code can stop that. The
invariant is a statement about what vault calls can do. The invariant handler moves multipliers upward only,
which is the direction dividends move them. See `docs/threat-model.md`, T6.

| File | Tests |
|---|---|
| `invariant/BasketVault.invariant.t.sol` | `invariant_backingHolds` |
| `unit/BasketVault.t.sol` | `test_mint_backsEveryConstituent`, `test_mint_revertsWhenUnderBacked`, `test_mint_cannotMintAgainstSlack`, `test_mint_revertsWithoutLegsForAConstituent` |
| `unit/Fee.t.sol` | `test_mint_chargesFeeFromRefund_backingUntouched` |
| `fizz/FoundryTester.sol` | `test_repro_burnKeepsBackingExactly` (the rounding gap the fuzzer found, now fixed) |
| `fork/RobinhoodChain.t.sol` | `test_mag7Vault_mintRedeemAndRedeemInKind` |

### 2. Redeem in kind always works (B2)

A holder can always burn units and receive the pro-rata slice of every token the vault holds and of any USDG in
it. No pause, oracle, freshness window, supply cap or fee that Parallax controls can block it.

Enforced by: `BasketVault._redeemInKind` reads only `registry.representationsOf` (a stored list) and token
balances. It does not read eligibility, a ratio, a reference price, the supply cap or the fee.

Limit on the admin side: the pro-rata computation calls `balanceOf` on every registered representation of every
constituent before anything is transferred, and a representation cannot be removed once registered. Every
setting the admin can change leaves in-kind redemption alone, but a registered token whose `balanceOf` reverts
would block it, skipping included. See `docs/threat-model.md`, T4. Not covered by a test.

Limit, stated plainly (D10): the issuers can block it. Robinhood can pause a stock token or block an address,
and Paxos can pause USDG or freeze an address. While a token is paused its transfer reverts, so plain
`redeemInKind` reverts as a whole. `redeemInKindSkipping(units, recipient, skip)` lets the holder leave with
every other token; the skipped slice stays in the vault for the remaining holders. USDG can be skipped the same
way. The invariant handler never pauses a token, so `invariant_redeemInKindAlwaysWorks` covers everything
Parallax controls and `test_redeemInKind_skipFrozenToken` covers the issuer case.

| File | Tests |
|---|---|
| `invariant/BasketVault.invariant.t.sol` | `invariant_redeemInKindAlwaysWorks` |
| `unit/BasketVault.t.sol` | `test_redeemInKind_proRata`, `test_redeemInKind_worksWhenEverythingIsStaleOrPaused` (buys paused, a year of staleness, token deprecated), `test_redeemInKind_distributesVaultUsdg`, `test_redeemInKind_skipFrozenToken`, `test_redeemInKind_reverts`, `test_supplyCap_boundsMintsOnly` |
| `unit/Fee.t.sol` | `test_redeemToUsdg_netOfFee_butInKindIsFree` |
| `fork/RobinhoodChain.t.sol` | `test_mag7Vault_mintRedeemAndRedeemInKind` |

### 3. Migrate is monotone (B3)

`migrate` may be called by anyone. After it, the target constituent's held shares are strictly higher, by at
least `minShareGain`; no other constituent's held shares are lower; the vault's USDG balance is not lower; any
token bought is a buy-eligible representation of the same constituent; issuer caps and backing hold.

Enforced by: `BasketVault.migrate` snapshots every constituent and the USDG balance before the legs and checks
them after (`InsufficientShareGain`, `ConstituentDecreased`, `UsdgDecreased`). `_runMigrateLeg` only accepts
USDG or a representation of this constituent as `tokenIn` (`MigrateLegOutsideConstituent`) and USDG or a
buy-eligible representation of it as `tokenOut` (`NotBuyEligible`, `WrongUnderlying`).

On this chain each stock has one representation, so there is nothing to migrate between and no fork test for
this path. It is tested with two mock issuers.

| File | Tests |
|---|---|
| `invariant/BasketVault.invariant.t.sol` | `invariant_migrateMonotone` |
| `unit/BasketVault.t.sol` | `test_migrate_increasesShares`, `test_migrate_partialWithinCap`, `test_migrate_revertsWhenSharesDecrease`, `test_migrate_minShareGainEnforced`, `test_migrate_cannotDrainUsdg`, `test_migrate_cannotTouchOtherConstituents`, `test_migrate_rejectsIneligibleTargetAndBadLegs`, `test_migrate_respectsIssuerCap` |

### 4. Share-denominated slippage (R1)

`ShareRouter.buyShares` reverts with `InsufficientShares` unless `Σ registry.sharesForTokens(tokenOut, received)
>= minShares`. The conversion uses the registry's ratio, which for these tokens is the live `uiMultiplier()`.
Token counts never enter the check.

| File | Tests |
|---|---|
| `unit/ShareRouter.t.sol` | `test_buyShares_minSharesEnforced`, `test_buyShares_minShares_catchesVenueSkim` |
| `unit/UsdgQuote.t.sol` | `test_buyShares_hundredUsdgAtReferencePrice` (100 USDG, 6 decimals, buys the right number of 1e18 shares) |
| `fork/RobinhoodChain.t.sol` | `test_buySharesThroughUniswap_thenSell`, `test_buyThroughWeth_twoHops` (shares returned equal `sharesForTokens` of what arrived, on real pools; the revert path is covered by the unit tests only) |

### 5. Leg execution trusts balance deltas only (L1 to L4)

- L1. Only allowlisted targets are called (`registry.isAllowedTarget`, checked by every caller before
  `LegExecutor.execute`). No `delegatecall`.
- L2. A leg can spend at most `maxIn` of `tokenIn`: `forceApprove(target, maxIn)` before the call and
  `forceApprove(target, 0)` after it, and `LegOverspent` if the measured spend exceeds `maxIn`. With an ordinary
  ERC-20 the approval already stops a larger pull inside the target (`LegCallFailed`), which is the layer the
  tests reach.
- L3. Spent and received are balance deltas on the executing contract. A leg that delivers nothing reverts
  (`LegNothingReceived`). `tokenIn == tokenOut` reverts (`LegSameToken`).
- L4. Every external state-changing function on the router, the vault and the mandate is `nonReentrant`.

| File | Tests |
|---|---|
| `fuzz/LegExecutor.t.sol` | `testFuzz_normal_deltasMatch` (asserts the allowance is zero afterwards), `testFuzz_maxIn_capsSpend`, `testFuzz_adversarial_modes` (no output, pull twice the amount, reenter, revert, return half), `test_sameTokenRejected` |
| `unit/ShareRouter.t.sol` | `test_buyShares_adversarialVenues`, `test_leg_overspendDetected`, `test_buyShares_rejectsBadLegs` (`TargetNotAllowed`) |
| `unit/BasketVault.t.sol` | `test_mint_rejectsBadLegs`, `test_redeem_reverts`, `test_migrate_rejectsIneligibleTargetAndBadLegs` (`TargetNotAllowed` on each path), `test_reentrancy_blocked` |
| `fork/RobinhoodChain.t.sol` | `test_buySharesThroughUniswap_thenSell` (the router's USDG allowance to SwapRouter02 is zero after the leg), `test_buyThroughWeth_twoHops` (no WETH left in the router) |

The harness property GL-30 checks, after every call, that no allowlisted target holds an allowance from the
router, the vault or the mandate.

### 6. The agent acts only for the owner (A1 to A5)

- A1. Output goes to the owner. `agentBuyShares` passes `m.owner` as the router's `recipient`;
  `agentMintBasket` passes `m.owner` as the mint's `recipient`; refunds go to the owner. `_settle` refunds and
  counts only the balance gained since the call's own snapshot, so USDG that reaches the shared contract some
  other way is neither swept to the next owner nor counted against their window.
- A2. No single call above `perTxCapUsdg`; no 24-hour window above `dailyCapUsdg`. The window starts at the
  first spend and resets after 24 hours. Caps are raw USDG (6 decimals).
- A3. Only the mandate's agent can act, only on allowlisted underlyings and baskets, not after expiry and not
  after revocation. Revocation takes effect in the transaction that makes it.
- A4. Only the owner can revoke or edit the allowlists.
- A5. A price floor. What left the owner in the call (fee included) must have bought at least
  `spent × quoteScale × (1 - maxSlippageBps / 10000) / referencePrice` shares (`sharesFloor`), or that many
  units' worth with a unit valued at its constituents' reference prices (`unitsFloor`). `maxSlippageBps` is set
  by the owner, 1 to 2000. A missing price, or one older than `maxPriceAge`, reverts with `StaleReferencePrice`
  and blocks agent buys only.

USDG decimals: `quoteScale = 10^(18 - decimals)`, read from the token at construction, lifts a raw USDG amount
to 1e18-scaled USD before it meets a 1e18 price. It is `1e12` for USDG. A quote token with more than 18
decimals is rejected (`BadQuoteDecimals`).

What A1 does and does not say. The `recipient` argument is fixed, but the agent writes the leg calldata, and the
swap inside a leg names its own recipient. A leg whose output does not arrive at the router reverts
(`LegNothingReceived`), and across the call the owner must receive at least the floor. So the most an agent can
waste or divert in one call is the gap between fair execution and the floor: `maxSlippageBps` of the amount
spent, measured against the reference price. A leg that splits its output inside that gap is not covered by a
test (the mock venue cannot express it). See `docs/threat-model.md`, T11.

| File | Tests |
|---|---|
| `invariant/AgentMandate.invariant.t.sol` | `invariant_agentNeverReceivesAssets`, `invariant_capsNeverExceeded`, `invariant_revokeAndExpiryFinal` |
| `unit/AgentMandate.t.sol` | A1: `test_agentBuy_outputGoesToOwner`, `test_agentBuy_refundGoesToOwner`, `test_agent_cannotRedirectRecipient`, `test_settle_doesNotSweepStrayBalance`, `test_agentMintBasket`. A2: `test_agentBuy_perTxCap`, `test_agentBuy_dailyCapAndWindowReset`, `test_agentMintBasket_capAppliesToMaxUsdg`. A3: `test_agentBuy_onlyAgent`, `test_agentBuy_underlyingNotAllowed`, `test_agentMintBasket_notAllowed`, `test_agentBuy_expiry`, `test_revoke_isInstant`. A4: `test_revoke_isInstant`, `test_setAllowed_onlyOwner`. A5: `test_agentBuy_cannotDivertOutputBelowFloor`, `test_agentBuy_blockedByStaleReferencePrice`, `test_create_rejectsBadSlippage`. Creation: `test_create_storesMandate`, `test_create_reverts` |
| `unit/UsdgQuote.t.sol` | `test_quoteToken_hasSixDecimals`, `test_sharesFloor_liftsUsdgToUsd`, `test_unitsFloor_liftsUsdgToUsd`, `test_agentBuy_halfTheFairShares_revertsBelowFloor`, `test_mandate_rejectsQuoteTokenAboveEighteenDecimals` |
| `fork/RobinhoodChain.t.sol` | `test_agentBuysWithinTheMandate_ownerReceives`, `test_agentMintsTheVaultWithinTheMandate`, `test_mandateBlocksEveryOutOfBoundsTrade` |

### 7. Posted data is bounded, and stale data blocks buys only (S1 to S4)

There is no keeper process on this chain (D3). `KEEPER_ROLE` still exists in `StockRegistry`; `DeployCore`
grants it to the admin unless `KEEPER_ADDRESS` names another address. With the mainnet configuration every
representation is `ERC8056` and every underlying has a feed, so nothing has to be posted in steady state. What
the role can still do, and how it is bounded:

- S1. `postRatio` (for a representation with a posted ratio; none exist on this chain) and `checkpointRatio`
  (for an ERC-8056 token) cannot move a ratio by more than `maxRatioStepBps` (5 %), measured against the previous
  value and against the value at the start of the current `STEP_WINDOW` (1 day), so a run of small posts cannot
  compound past the bound. `postReferencePrice` is bounded the same way by `maxPriceStepBps` (20 %); it is
  ignored while a feed is set. `checkpointRatio` is role-gated because the checkpoint is what the buy guard
  compares against.
- The ERC-8056 guard. `isBuyEligible(token)` is false while the live `uiMultiplier()` is zero or more than
  `maxRatioStepBps` away from the last checkpoint. A split therefore stops router buys, vault mints and
  migrations into that token until the admin calls `confirmRatio`. With the attestation gate off (D4), this is
  the on-chain check that stands in its place.
- S2. Buy eligibility requires: registered, active, buys not paused, the ratio guard above, and a platform
  attestation no older than `maxAttestationAge`. `ConfigureRegistry` sets that window to the largest `uint64`,
  so the attestation check never fails here; the code path remains and is tested with a finite window. Sell
  eligibility requires only registration.
- Stale data never blocks an exit. `sellShares` checks `isSellEligible` only. `redeem` and `redeemInKind` check
  no eligibility at all. A stale or missing reference price (`maxPriceAge`, set to 5 days, D5) blocks agent buys
  only; the owner's own buys do not read it.
- S3. Attestation timestamps are monotone and never in the future.
- S4. `GUARDIAN_ROLE` can pause buys and nothing else.

| File | Tests |
|---|---|
| `unit/StockRegistry.t.sol` | S1: `test_postRatio_rejectsLargeStep`, `test_postRatio_stepIsAnchoredOverWindow`, `test_confirmRatio_resetsAnchor`, `test_confirmRatio_adminOverridesStep`, `test_postRatio_onlyKeeper`, `test_postRatio_wrongSourceAndZero`, `test_referencePrice_keeperPostedAndBounded`, `test_checkpointRatio_erc8056`. Guard: `test_corporateAction_pausesBuysUntilAdminConfirms`, `test_isBuyEligible_zeroMultiplier`. S2: `test_isBuyEligible_freshness`, `test_setRepresentationActive`. S3: `test_postAttestation`. S4: `test_guardianPausesBuysOnly` |
| `unit/ShareRouter.t.sol` | `test_buyShares_staleRepresentationExcluded`, `test_sellShares_deprecatedStillSellable` (deprecated and 100 days stale, still sells) |
| `unit/BasketVault.t.sol` | `test_redeemInKind_worksWhenEverythingIsStaleOrPaused`, `test_mint_rejectsNonConstituentAndIneligible` |
| `unit/AgentMandate.t.sol` | `test_agentBuy_blockedByStaleReferencePrice` (the agent is blocked, the owner's own buy in the same test goes through) |
| `fork/RobinhoodChain.t.sol` | `test_tokensFeedsAndUsdgMatchTheConfig` (with the gate off and no attestation posted, every real token is buy-eligible, and every real feed is inside the 5-day window) |

Harness properties GL-19 (no run of posts moves a ratio past the bound within 24 hours), GL-25, SP-12 and SP-13
(role separation) cover the same ground statefully. The monitor's verdict logic for a multiplier nearing or
passing the bound is tested in `apps/monitor/test/monitor.test.ts`.

### 8. No fabricated data

Where a live source is unavailable the API and the app say what stands in for it, and a source that cannot
answer returns nothing instead of a guess.

- The resolver's `/health` returns `label` with the network name, kind, chain id and `mocked`, the list of
  things that are mocks on that network (`networkLabel` in `apps/resolver/src/app.ts`). Listings carry
  `dataSource` (`live` or `fixture`), `referenceSource` and `market.source`.
- The MCP tool `get_network` returns the same label.
- The universe file `contracts/script/config/robinhood.json` is generated by `scripts/gen-universe.mts` from
  Robinhood's asset list and Chainlink's feed directory and checked on chain before it is written: each token
  has code, 18 decimals, the expected symbol and a `uiMultiplier()` equal to the published one; each feed has
  code, a positive answer and a description naming the ticker; USDG reports 6 decimals. Any mismatch stops the
  run. The deploy scripts, the resolver and the fork test all read that one file.
- The quoting client returns `null` when no pool can fill, never zero or an estimate.

| File | Tests |
|---|---|
| `apps/resolver/test/integration.test.ts` | "lists stocks with representations and labeled data sources" (on the mocks chain: `dataSource` is `fixture`, the reference is named `registry reference price`, and `/health` lists all four mocked things) |
| `apps/mcp/test/mcp.e2e.test.ts` | "get_network says which chain this is and what on it is mocked" |
| `packages/uniswap-client/test/client.test.ts` | "answers null, not zero, when nothing can fill" |
| `fork/RobinhoodChain.t.sol` | `test_tokensFeedsAndUsdgMatchTheConfig` (the generated file matches chain 4663: symbols, decimals, multipliers, feed decimals, positive answers) |

The two TypeScript end-to-end suites need the local mocks chain and skip themselves when it is not running.

## Properties added in the port

### The supply cap bounds mints only

`StockRegistry.setSupplyCap(basket, capUnits)` (admin only, zero lifts it) bounds a vault's outstanding units.
`BasketVault.mint` reverts with `SupplyCapExceeded` when `totalSupply + units` would pass it. Nothing else reads
it, so lowering the cap below the current supply stops new units and never blocks a redemption (D8).

Test: `unit/BasketVault.t.sol` `test_supplyCap_boundsMintsOnly`. It checks the admin gate and the zero-address
guard, mints exactly to the cap, shows the next unit reverts, lowers the cap under the supply and redeems in
kind anyway, shows that redeeming made no room under the lowered cap, then lifts the cap and mints again.

### The reference price is per share when the feed prices a token

Robinhood Chain's stock feeds price the token with the multiplier included. `setTokenPriceFeed(underlying, feed,
token)` records which token a feed prices, and `referencePrice` divides the scaled answer by that token's live
ratio, so the mandate's floor is in USD per share (D2). `setPriceFeed` keeps the per-share meaning and clears the
token.

| File | Tests |
|---|---|
| `unit/StockRegistry.t.sol` | `test_referencePrice_tokenFeed_isPerShare` (an 8-decimal token feed and a 1.000778 multiplier give 219 USD per share; a doubled multiplier with a doubled token price still gives 219; a zero multiplier gives no price) |
| `unit/StockRegistry.t.sol` | `test_setTokenPriceFeed_guards` (admin only; zero feed rejected; the token must be a representation of that underlying; switching back to `setPriceFeed` drops the division) |
| `unit/StockRegistry.t.sol` | `test_referencePrice_feedOverridesKeeper`, `test_setPriceLimits` |
| `fork/RobinhoodChain.t.sol` | `test_referencePriceIsPerShare` (the real NVDA feed divided by the real multiplier) |

### USDG has 6 decimals

`unit/UsdgQuote.t.sol` pins every place the 6-decimal quote asset meets a 1e18 quantity:

| Test | What it pins |
|---|---|
| `test_quoteToken_hasSixDecimals` | the fixture's USDG has 6 decimals and `quoteScale` is `1e12` |
| `test_buyShares_hundredUsdgAtReferencePrice` | 100 USDG at 219 USD a share returns about 0.4566 shares through the router |
| `test_sharesFloor_liftsUsdgToUsd` | the share floor for 100 USDG at 300 bps is 97 USD of shares, not off by `1e12` |
| `test_unitsFloor_liftsUsdgToUsd` | the unit floor uses the unit's USD value (38.5 USD in the fixture) |
| `test_agentBuy_halfTheFairShares_revertsBelowFloor` | an agent buy that returns half the fair shares reverts with `SharesBelowFloor` and spends nothing |
| `test_mintThenRedeem_paysSixDecimalUsdg` | a mint then a full redeem pays out in 6-decimal units, net of the fee |
| `test_mandate_rejectsQuoteTokenAboveEighteenDecimals` | the constructor rejects a 19-decimal quote token |

### The fork test

`fork/RobinhoodChain.t.sol` deploys the contracts on a fork of chain 4663 and configures them the way
`ConfigureRegistry` does, reading every token, feed and router address from the generated universe file. USDG is
real, moved to the test account from the USDG/WETH pool.

| Test | What it proves against real chain state |
|---|---|
| `test_tokensFeedsAndUsdgMatchTheConfig` | USDG has 6 decimals and the symbol `USDG`; `quoteScale` is `1e12`; all seven tokens have the configured symbol, 18 decimals and a multiplier of at least 1; all seven feeds have 8 decimals, a positive answer and an update inside `maxPriceAge`; every token is buy-eligible |
| `test_referencePriceIsPerShare` | the registry's NVDA price equals the feed answer divided by the token's `uiMultiplier()` |
| `test_buySharesThroughUniswap_thenSell` | 100 USDG buys NVDA through SwapRouter02 within 1 % of the Chainlink price per share; the 50 bps fee reaches the treasury; the router keeps no tokens, no USDG and no allowance; selling everything back returns between 97 and 100 USDG |
| `test_buyThroughWeth_twoHops` | a USDG → WETH → NVDA `exactInput` leg executes, lands within 1 % of the reference, and leaves no WETH in the router |
| `test_mag7Vault_mintRedeemAndRedeemInKind` | two pxMAG7 units mint with seven exact-output legs; backing holds for every constituent; unspent USDG is refunded; one unit redeems to USDG within 3 % of half the spend; the other redeems in kind and the vault ends empty |
| `test_agentBuysWithinTheMandate_ownerReceives` | an agent buy clears the floor, the owner holds the NVDA, the agent holds nothing, the daily allowance drops by the amount spent |
| `test_agentMintsTheVaultWithinTheMandate` | the agent mints half a unit for the owner and backing holds |
| `test_mandateBlocksEveryOutOfBoundsTrade` | over the per-transaction cap, a stock not on the allowlist, a real swap whose output is routed to the agent, over the daily cap, and after revocation all revert; a call that authorizes 50 and spends 25 counts only the 25 |

## Supporting properties

### Baskets (`BasketVault`)

| # | Property | Enforced by | Tests (`unit/BasketVault.t.sol` unless stated) |
|---|---|---|---|
| B4 | **Issuer caps.** When two or more representations of a constituent are buy-eligible, no platform holds more than `maxIssuerBps` of that constituent's shares after `mint` or `migrate`. A platform already over the cap can only be diluted: a call that adds to it must strictly lower its share. Redeems never fail because of caps. pxMAG7 and pxAI are configured at 10000, which switches the cap off; a single issuer per stock makes it moot here. | `_checkIssuerCap` against the pre-call snapshot, exact cross-multiplied comparison | `test_mint_issuerCapEnforced`, `test_mint_issuerCapSkippedWhenSingleEligible`, `test_mint_overCapPlatformCanOnlyBeDiluted`, `test_migrate_respectsIssuerCap`; harness GL-37 |
| B5 | **Redeem sells only the redeemer's slice.** A sell leg cannot spend more of a token than the pro-rata slice for the burned units; whatever is not sold is delivered in kind. | `remaining[]` per token, `LegExceedsProRata` | `test_redeem_cannotSellMoreThanProRata`, `test_redeem_unsoldGoesInKind`, `test_redeem_toUsdg` |
| B6 | **Mint never spends more than `maxUsdgIn`**, even if the vault already holds USDG; the rest is refunded to the payer. | `OverSpent` on the USDG delta | `test_mint_overspendGuard`, `test_mint_refundsLeftover` |
| B7 | **Supply equals holders' balances.** | ERC-20 | `invariant/BasketVault.invariant.t.sol` `invariant_supplyMatchesHolders`; harness GL-02 |

Shares above B1 (rounding, a cheap fill, multiplier growth) stay in the vault and accrue pro rata to all
holders, including later minters. Minters bound their cost with `maxUsdgIn`.

### Router (`ShareRouter`)

| # | Property | Enforced by | Tests (`unit/ShareRouter.t.sol`) |
|---|---|---|---|
| R2 | Only buy-eligible representations of the requested underlying can be bought; any registered representation can be sold. | `isBuyEligible`, `isSellEligible`, `underlyingOf` | `test_buyShares_rejectsBadLegs`, `test_buyShares_staleRepresentationExcluded`, `test_sellShares_deprecatedStillSellable`, `test_sellShares_reverts` |
| R3 | **The router keeps nothing of the caller's.** Output tokens go to `recipient`; unspent USDG and unsold tokens return to the caller in the same call. Refunds are scoped to what this call deposited, so a balance that reached the router some other way is not swept to the next caller. | `OverSpent` / `OverSold`, refund = deposit minus delta | `test_buyShares_refundsUnspent`, `test_sellShares_partialLegReturnsLeftover`, `test_refunds_doNotSweepStrayBalances`; harness GL-03 |
| R4 | One `RouteReceipt` per leg with the `quoteHash`, the ratio and the shares at execution time. | `ReceiptEmitter` | `test_buyShares_emitsReceipt`, `test_sellShares` |
| R5 | **Receipts never block a trade.** The ratio and share figures on a receipt are read in a try/catch, so a token whose ratio view reverts stays sellable and redeemable; the receipt carries zeros. | `ReceiptEmitter._emitRouteReceipt` | no direct test: no token in the repository reverts on `uiMultiplier()` |

### Registry (`StockRegistry`)

| # | Property | Enforced by | Tests |
|---|---|---|---|
| S5 | **The fee is a USDG flow only.** Charged on buys, sells, mints and USDG redemptions as bps of the notional, capped at `MAX_FEE_BPS` (1 %) in code. Never charged on in-kind redemption or migration, never touches shares or backing. | `StockRegistry.setFee`, `ShareRouter._chargeFee`, `BasketVault._chargeFee` | `unit/Fee.t.sol`: `test_setFee_onlyAdminAndCapped`, `test_buy_chargesFeeOnSpent_fromHeadroom`, `test_buy_revertsWhenNothingLeftForFee`, `test_sell_paysNetOfFee_andMinIsNet`, `test_mint_chargesFeeFromRefund_backingUntouched`, `test_mint_revertsWhenMaxUsdgInDoesNotCoverFee`, `test_redeemToUsdg_netOfFee_butInKindIsFree`. The vault invariant suite runs with the fee on. Harness GL-05, SP-16 |
| S6 | **Reference prices feed the mandate floor and display, nothing else.** `referencePrice` is read by `AgentMandate` and by nothing that touches backing, eligibility or exits. A non-positive feed answer reads as missing. | `referencePrice`, `setPriceFeed`, `setTokenPriceFeed`, `postReferencePrice` | `unit/StockRegistry.t.sol`: `test_referencePrice_feedOverridesKeeper`, `test_referencePrice_tokenFeed_isPerShare`, `test_setPriceLimits` |

### Share math (`ShareMath`, mirrored in `packages/sdk`)

| # | Property | Tests |
|---|---|---|
| M1 | `tokensForShares(sharesForTokens(t)) <= t`, and holding `tokensForShares(s)` tokens covers `s` shares: round down when crediting, up when holding. | `fuzz/ShareMath.t.sol`: `testFuzz_roundTrip_tokensSharesTokens`, `testFuzz_tokensForShares_coversShares`, `testFuzz_requiredShares_monotone` |
| M2 | Pro-rata slices never exceed the balance and are sub-additive, so dust stays in the vault. | `testFuzz_proRata_neverExceedsBalance`, `testFuzz_proRata_additive` |
| M3 | The TypeScript mirror gives identical results to Solidity. | `packages/sdk/test/shareMath.test.ts` against 200 vectors generated by forge; "USDG is six decimals and converts to 1e18 USD explicitly" in the same file |

`testFuzz_stepBps_symmetricBounded` covers the step measure the registry's bounds use.

## Corporate actions

A split or reverse split moves a token's multiplier by more than `maxRatioStepBps`. From that block
`isBuyEligible` is false for that token: router buys, vault mints that need it and migrations into it revert
until the admin calls `confirmRatio`. Sells and in-kind redemption keep working
(`test_corporateAction_pausesBuysUntilAdminConfirms`). A multiplier decrease lowers held shares; B1 is defined
over vault operations and over upward drift, which is what the invariant handler models. A vault's
`sharesPerUnit` is fixed at construction and is not rescaled after a split; the consequence is in
`docs/threat-model.md`, T6.

## Fuzz and invariant suites

**Foundry fuzz** (`fuzz/`). `ShareMath.t.sol` (six fuzz tests on rounding, pro-rata and the step measure) and
`LegExecutor.t.sol` (three fuzz tests and one unit test on a harness contract). 512 runs each by default, 2048
under `FOUNDRY_PROFILE=ci`.

**Foundry invariants** (`invariant/`), handler-based, 128 runs at depth 32, `fail_on_revert = false`.

- `BasketVault.invariant.t.sol`. `VaultHandler` mints, redeems to USDG, redeems in kind and migrates for four
  actors, and plays the environment: it moves venue prices by up to 10 %, drifts ERC-8056 multipliers upward,
  posts a ratio for the mock issuer that has one, pauses and unpauses buys and advances time. The protocol fee
  is on at 50 bps for the whole run. Invariants: `invariant_backingHolds`, `invariant_redeemInKindAlwaysWorks`,
  `invariant_migrateMonotone`, `invariant_supplyMatchesHolders`.
- `AgentMandate.invariant.t.sol`. `MandateHandler` has the agent buy with random amounts, wrong underlyings and
  legs that pay the agent, mint baskets with random budgets, lets the owner revoke, and advances time across
  windows and past expiry. Invariants: `invariant_agentNeverReceivesAssets`, `invariant_capsNeverExceeded`,
  `invariant_revokeAndExpiryFinal`.
- `HandlerSanity.t.sol`. `test_vaultHandlerReachesAllPaths`, `test_vaultHandlerMintsWithTheFeeOn` and
  `test_mandateHandlerReachesAllPaths` show the handlers reach the success paths, so the invariants are not
  holding over an empty vault.

**Medusa / Echidna harness** (`fizz/`). `FuzzTester` is the entry point; `handlers/` has one handler file each
for `ShareRouter`, `BasketVault`, `AgentMandate` and `StockRegistry`, the last one also driving the environment
(venue prices and fees, multiplier drift, splits, issuer pause and blocklist, time). `Properties.sol` holds 32 always-on
`property_*` checks and 32 handler-scoped `_prop_*` checks. The property list, with an id, a plain-language
statement and a guarantee tag for each, is `contracts/PROPERTIES.md` (GL-01 to GL-37 and SP-01 to SP-17; 47
implemented, 7 specified and skipped: GL-10, GL-28, GL-33, GL-34, GL-35, SP-09, SP-11). It is not repeated here.
Configuration: `contracts/medusa.json` (4 workers, 500,000 calls, sequences of 100, property prefix
`property_`, assertion testing on) and `contracts/echidna.yaml` (assertion mode, 50,000 calls, sequences of
100). `fizz/FoundryTester.sol` runs a smoke sequence (`test_sequence`) and the one shrunk repro
(`test_repro_burnKeepsBackingExactly`) under plain `forge test`.

The campaign recorded in `contracts/fizz_data/report.md` (Medusa, 270,136 calls, no violations in the final run)
was run before the port to 6-decimal USDG. The harness has been updated for USDG and compiles and runs under
`forge test`, but the repository records no Medusa or Echidna campaign on the ported code. Run one before
relying on that figure.

## How to run

```
cd contracts
forge test                                            # 139 tests: unit, fuzz, invariant, harness smoke; no network
FOUNDRY_PROFILE=ci forge test                         # same, 2048 fuzz runs
forge test --match-contract FoundryTester -vvv        # harness smoke sequence and repro
forge test --match-path 'test/fork/*' --no-match-path none   # fork test (or `pnpm contracts:fork-test` from the root)
medusa fuzz                                           # stateful campaign, config medusa.json
echidna . --contract FuzzTester --config echidna.yaml
```

The fork test is excluded from plain `forge test` by `no_match_path` in `foundry.toml`. It forks the public
endpoint by default; `ROBINHOOD_RPC_URL` points it elsewhere and `ROBINHOOD_FORK_BLOCK` pins a block, which
needs an archive endpoint because the public one keeps about ten minutes of state. `foundry.toml` also has a
`fuzz` profile (optimizer off, `via_ir` on) for the stateful campaigns; select it with `FOUNDRY_PROFILE=fuzz`.

The TypeScript suites run with `pnpm test` from the repository root. The resolver integration test and the MCP
end-to-end test run against the local mocks chain (`pnpm mocks:up`) and skip when it is not up.
