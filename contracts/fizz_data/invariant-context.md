# INVARIANT_CONTEXT — Parallax (contracts/)

Protocol: routes tokenized-stock purchases on BNB Chain to the cheapest *representation* of an underlying
measured in underlying shares (token amount × issuer ratio, 1e18-scaled), executes caller-supplied swap
"legs" against an allowlisted venue trusting only balance deltas, packages positions into fixed
shares-per-unit `BasketVault`s with an onchain backing check, and lets owners delegate to an agent key via
`AgentMandate` (caps, expiry, allowlists, recipient = owner, execution floor vs reference price).
USDT (18 dp) is the only settlement asset. A protocol fee (bps of USDT notional, ≤ 1 %) is charged on
buys/sells/mints/USDT-redemptions, never on in-kind redemption or migration.

Harness fixture (test/fizz/Base.sol): one basket `pxFUZZ` = 0.1 NVDA + 0.05 AAPL per unit (NVDA issuer cap
80 %); NVDA has two representations (NVDAon keeper ratio 1.0037, NVDAB ERC-8056 multiplier 1.000778), AAPL one
(AAPLB 1.0006); MockSwapTarget venue at fair prices (share price × ratio), 3 actors with 1M USDT each, a
shared `agent` address, keeper/guardian/admin roles, fee 50 bps to `feeRecipient`. Environment handlers move
venue prices ±20 %, drift ERC-8056 multipliers ±1 % or apply 10×/¼ splits, pause/blocklist mock tokens, set
venue fees, and warp time (≤ 3 days); `stockRegistry_keeperRefresh` re-posts freshness data.

IMPORTANT environment facts for property design:
- Backing is evaluated on *live* ratios. Issuer multiplier drift or a keeper ratio post between calls can
  break `backingOk()` without any vault action. Global "backing always holds" is therefore NOT a valid
  always-on property in this harness; the valid forms are "a vault call never *lowers* the backing ratio",
  "mint/migrate leave backing satisfied for what they touched", "a burn is pro-rata".
- Vault USDT is a legitimate holding (migration residue, forfeited in-kind slices, donations).
- The router and the mandate contract hold only what was donated to them (ghosts.routerDonated / vaultDonated).
- Stale attestations/prices/ratios block buys and agent trades (by design, invariant 7), never sells or exits.

## The project's own invariant catalogue (docs/invariants.md) — cite these as SHOULD-HOLD evidence
# Invariants

Every invariant in plain English, where it is enforced, and the test that proves it. Test paths are under `contracts/test/`.

## Baskets (`BasketVault`)

| # | Invariant | Enforced by | Proven by |
|---|-----------|-------------|-----------|
| B1 | **Backing.** For every constituent `i`, `heldShares(i) >= ceil(totalSupply × sharesPerUnit(i) / 1e18)` after every state-changing call. `heldShares` sums `registry.sharesForTokens(rep, balanceOf(rep))` over every registered representation of the constituent, using live ERC-8056 multipliers or keeper-posted ratios. | `mint` → `_checkAllBacking()` after `_mint`; `migrate` → `_checkBacking(idx)`; `redeem`/`redeemInKind` remove at most the pro-rata slice (rounded down) so the ratio cannot fall. | `invariant_backingHolds` (handler-based, 128 runs × 32 calls, asserts after every successful vault call and at the end), `test_mint_revertsWhenUnderBacked`, `test_mint_revertsWithoutLegsForAConstituent`, `testFork_basketMintRedeemInKindAndRedeem` |
| B1a | **A mint pays for itself.** The legs of a `mint` must deliver, for every constituent, at least `ceil(units × sharesPerUnit / 1e18)` shares *in that call*; empty legs revert. Slack other holders built up (rounding residue, a favourable migration, a donation) is never mintable against, so B1 cannot be satisfied by somebody else's cushion and the fee and buy-eligibility gate cannot be skipped with `legs = []`. (Audit F-1.) | `mint` → `NoLegs`, `_snapshotHoldings()` before legs, `_checkDelivered()` after `_mint` | `test_mint_cannotMintAgainstSlack`, `test_mint_revertsWithoutLegsForAConstituent` |
| B2 | **Redeem in kind always works.** A holder can always burn units and receive the pro-rata slice of every representation and of vault USDT. No pause, oracle, registry freshness, guardian or admin can block it. | `redeemInKind` reads only `registry.representationsOf` (pure list) and token balances; no eligibility checks. `redeemInKindSkipping` lets a holder forfeit a slice whose issuer froze transfers. | `invariant_redeemInKindAlwaysWorks`, `test_redeemInKind_worksWhenEverythingIsStaleOrPaused`, `test_redeemInKind_skipFrozenToken`, `test_redeemInKind_distributesVaultUsdt` |
| B3 | **Migrate is monotone.** Target constituent shares strictly increase by ≥ `minShareGain`; every other constituent's shares are unchanged or higher; vault USDT does not decrease; the new representation is buy-eligible; issuer caps hold. Anyone may call. | `migrate` snapshots all constituents and USDT before legs, checks all after. Legs may only spend USDT or the target constituent's representations. | `invariant_migrateMonotone`, `test_migrate_increasesShares`, `test_migrate_partialWithinCap`, `test_migrate_revertsWhenSharesDecrease`, `test_migrate_cannotDrainUsdt`, `test_migrate_cannotTouchOtherConstituents`, `test_migrate_respectsIssuerCap`, `testFork_migrate_ondoToBstock_gainsShares` (real pools: rejected when not accretive) |
| B4 | **Issuer caps.** When ≥ 2 representations of a constituent are buy-eligible, no single platform holds more than `maxIssuerBps` of that constituent's shares after `mint` or `migrate`. Redeems never fail because of caps. Single-eligible constituents skip the cap (UI shows "single issuer"). A platform already over the cap (concentration built while it was the only eligible one) does not brick the vault: a call that adds to it must strictly lower its share of the constituent, so diluting mints and migrations pass and the cap re-engages once met. (Audit F-4.) | `_checkIssuerCap(i, heldBefore, platformBefore)` against the pre-call snapshot | `test_mint_issuerCapEnforced`, `test_mint_issuerCapSkippedWhenSingleEligible`, `test_mint_overCapPlatformCanOnlyBeDiluted`, `test_migrate_respectsIssuerCap` |
| B5 | **Redeem sells only the redeemer's slice.** Sell legs during `redeem` cannot spend more of any representation than the pro-rata slice for the burned units; unsold remainder is delivered in kind. | `remaining[]` accounting per token, `LegExceedsProRata` | `test_redeem_cannotSellMoreThanProRata`, `test_redeem_unsoldGoesInKind` |
| B6 | **Mint never spends more than `maxUsdtIn`** even if the vault already holds USDT; leftover is refunded to the payer. | `OverSpent` check on the USDT delta; refund = `maxUsdtIn − spent` | `test_mint_overspendGuard`, `test_mint_refundsLeftover` |
| B7 | **Supply equals holders' balances** (no hidden mint path). | ERC-20 | `invariant_supplyMatchesHolders` |

Surplus shares above B1 (from rounding or cheap fills) stay in the vault and accrue pro rata to all holders; minters bound their cost with `maxUsdtIn`.

**Corporate actions.** A split or reverse split moves a ratio outside `maxRatioStepBps`. For keeper-sourced ratios the keeper's post is rejected and the ratio goes stale → `isBuyEligible = false` → mints and migrations into that token fail until ADMIN calls `confirmRatio`. For ERC-8056 tokens the live multiplier is compared with the last checkpoint → same effect. Sells and in-kind redemption keep working (`test_corporateAction_pausesBuysUntilAdminConfirms`). A ratio *decrease* legitimately lowers `heldShares`; B1 is defined over vault operations and over the production direction of ratio drift (upward, dividends), which is what the invariant handler models.

## Router (`ShareRouter`)

| # | Invariant | Enforced by | Proven by |
|---|-----------|-------------|-----------|
| R1 | **Share-denominated slippage.** `buyShares` reverts unless `Σ sharesForTokens(tokenOut, received) >= minShares`. Token units never enter the check. | `InsufficientShares` | `test_buyShares_minSharesEnforced`, `test_buyShares_minShares_catchesVenueSkim`, `testFork_minShares_revertsWhenTooTight` |
| R2 | **Only eligible representations of the requested underlying** can be bought; any registered representation can be sold. | `isBuyEligible` / `isSellEligible` + `underlyingOf` | `test_buyShares_rejectsBadLegs`, `test_buyShares_staleRepresentationExcluded`, `test_sellShares_deprecatedStillSellable` |
| R3 | **The router keeps nothing of the caller's.** All output tokens go to `recipient`; the caller's unspent USDT (`usdtIn − spent − fee`) / unsold tokens (`tokenAmount − sold`) return to `msg.sender` in the same call. Refunds are scoped to what this call deposited: a balance that reaches the router by other means is not swept to the next caller. (Audit F-5/F-6.) | `OverSpent`/`OverSold` guards, refund = deposit − delta | `test_buyShares_refundsUnspent`, `test_sellShares_partialLegReturnsLeftover`, `test_refunds_doNotSweepStrayBalances`, balance asserts in every buy/sell test |
| R5 | **Receipts never block a trade.** The ratio/share telemetry on a `RouteReceipt` comes from a live ERC-8056 view; it is read in a try/catch so a representation whose ratio view reverts stays sellable and redeemable (the receipt carries zeros). | `ReceiptEmitter._emitRouteReceipt` | covered by the sell/redeem suites; the failure mode has no in-repo token that reverts on `uiMultiplier()` |
| R4 | **One `RouteReceipt` per leg** with `quoteHash`, ratio and attestation timestamp at execution time. | `ReceiptEmitter` | `test_buyShares_emitsReceipt`, `test_sellShares` |

## Leg execution (`LegExecutor`)

| # | Invariant | Enforced by | Proven by |
|---|-----------|-------------|-----------|
| L1 | Only allowlisted targets are called; no `delegatecall`. | `registry.isAllowedTarget` in every caller | `TargetNotAllowed` tests in router/vault |
| L2 | A leg can spend at most `maxIn` of `tokenIn` and nothing else: approval is set to `maxIn` before the call and to 0 after; other tokens have no approval. | `forceApprove` pair, `LegOverspent` | `testFuzz_maxIn_capsSpend`, `testFuzz_normal_deltasMatch` (approval reset) |
| L3 | Results are measured only by balance deltas; a leg that returns nothing reverts. | `LegNothingReceived` | `testFuzz_adversarial_modes` (NO_OUTPUT, TAKE_MORE, REVERT, SKIM_HALF, REENTER), `test_buyShares_adversarialVenues` |
| L4 | Reentrancy into any entry point reverts. | `ReentrancyGuard` on every external state-changing function | `test_buyShares_adversarialVenues` (REENTER), `test_reentrancy_blocked` |

## Registry (`StockRegistry`)

| # | Invariant | Enforced by | Proven by |
|---|-----------|-------------|-----------|
| S1 | A keeper cannot move a ratio by more than `maxRatioStepBps` — against the previous post **and** against the value at the start of the current `STEP_WINDOW` (1 day), so a run of small posts cannot compound past the bound; ADMIN's `confirmRatio` resets the anchor. Keeper-posted reference prices are bounded the same way by `maxPriceStepBps`. `checkpointRatio` is keeper-only: it is the anchor `isBuyEligible`'s corporate-action guard compares the live multiplier against, so a buyer must not be able to reset it in the same transaction. | `_boundedStep` in `postRatio` / `checkpointRatio` / `postReferencePrice`, `confirmRatio` | `test_postRatio_rejectsLargeStep`, `test_postRatio_stepIsAnchoredOverWindow`, `test_confirmRatio_resetsAnchor`, `test_referencePrice_keeperPostedAndBounded`, `test_checkpointRatio_erc8056` |
| S6 | **Reference prices are display-and-floor only.** `referencePrice(underlying)` is the Chainlink feed when ADMIN set one (scaled to 1e18; a non-positive answer reads as missing), else the keeper's post. It is read by `AgentMandate` for its execution floor and by nothing that touches backing, eligibility or exits. | `referencePrice`, `setPriceFeed` (ADMIN), `postReferencePrice` (KEEPER) | `test_referencePrice_feedOverridesKeeper`, `test_setPriceLimits` |
| S2 | Buy eligibility requires: registered, active, buys not paused, fresh ratio (≤ `maxRatioAge` for keeper; within step of checkpoint for ERC-8056), fresh platform attestation (≤ `maxAttestationAge`). Sell eligibility requires only registration. | `isBuyEligible` / `isSellEligible` | `test_isBuyEligible_freshness`, `test_guardianPausesBuysOnly`, `test_setRepresentationActive` |
| S3 | Attestation timestamps are monotone and never in the future. | `postAttestation` | `test_postAttestation` |
| S4 | GUARDIAN can only pause buys. | role-gated `setBuysPaused` only | `test_guardianPausesBuysOnly` |
| S5 | The protocol fee is a USDT flow only: charged on buys, sells, mints and USDT redemptions as bps of notional, capped at `MAX_FEE_BPS` (1 %) in code, ADMIN-set; it never touches shares or backing and is never charged on in-kind redemption or migration, so it cannot block the escape hatch (B2) or the backing invariant (B1). | `StockRegistry.setFee` (cap), `ShareRouter._chargeFee`, `BasketVault._chargeFee` (not called from `redeemInKind`/`migrate`) | `FeeTest.*` (7 tests), `BasketVaultInvariants` run with the fee on |

## Agent mandates (`AgentMandate`)

| # | Invariant | Enforced by | Proven by |
|---|-----------|-------------|-----------|
| A1 | **The agent never receives assets.** Recipient is hardcoded to `owner`; refunds go to `owner`; the mandate contract holds nothing of a call's between calls. `_settle` refunds and counts only the balance gained since the call's pre-pull snapshot (capped at the authorized amount), so USDT that reaches the shared contract by other means is neither swept to the next owner nor able to zero their window spend. (Audit F-3.) | `agentBuyShares` / `agentMintBasket` / `_settle(m, authorized, balanceBefore)` | `invariant_agentNeverReceivesAssets`, `test_agentBuy_outputGoesToOwner`, `test_agent_cannotRedirectRecipient`, `test_settle_doesNotSweepStrayBalance`, `testFork_agentMandateBuy` |
| A5 | **The agent cannot buy badly on purpose.** What actually left the owner in a call (USDT delta, fee included) must have bought at least `spent × (1 − maxSlippageBps) / referencePrice` shares (`agentBuyShares`) or that many units' worth (`agentMintBasket`, unit valued at the constituents' reference prices). `maxSlippageBps` is set by the owner at creation (1–2000). A missing or stale reference price (`maxPriceAge`) blocks agent buys only — never the owner's own trades or exits. Closes the path where the agent supplies dust `minShares`/`units` and leg calldata that routes the swap output to itself. (Audit F-2.) | `sharesFloor` / `unitsFloor` checked after execution against the measured spend | `test_agentBuy_cannotDivertOutputBelowFloor`, `test_agentBuy_blockedByStaleReferencePrice`, `test_create_rejectsBadSlippage`, `invariant_agentNeverReceivesAssets` (handler sizes budgets to fair value; overspends are rejected) |
| A2 | No single authorization above `perTxCapUsdt`; no 24h window above `dailyCapUsdt`. Window starts at the first spend and resets after 24h. | `_authorize` | `invariant_capsNeverExceeded`, `test_agentBuy_perTxCap`, `test_agentBuy_dailyCapAndWindowReset`, `test_agentMintBasket_capAppliesToMaxUsdt` |
| A3 | Only the designated agent can act; only allowlisted underlyings/baskets; not after expiry; not after revocation (instant). | `_authorize`, allowlists, `revoke` | `invariant_revokeAndExpiryFinal`, `test_agentBuy_onlyAgent`, `test_agentBuy_underlyingNotAllowed`, `test_agentMintBasket_notAllowed`, `test_agentBuy_expiry`, `test_revoke_isInstant` |
| A4 | Only the owner can revoke or edit allowlists. | `NotOwner` | `test_revoke_isInstant`, `test_setAllowed_onlyOwner` |

## Share math (`ShareMath`, mirrored in `packages/sdk`)

| # | Invariant | Proven by |
|---|-----------|-----------|
| M1 | `tokensForShares(sharesForTokens(t)) <= t` and holding `tokensForShares(s)` tokens covers `s` shares (round down when crediting, up when holding). | `testFuzz_roundTrip_tokensSharesTokens`, `testFuzz_tokensForShares_coversShares` |
| M2 | Pro-rata slices never exceed the balance and are sub-additive (dust stays in the vault). | `testFuzz_proRata_neverExceedsBalance`, `testFuzz_proRata_additive` |
| M3 | TS mirror produces bit-identical results to Solidity for the same inputs. | `packages/sdk` parity tests against vectors generated by `forge` |

Run everything: `cd contracts && forge test` (unit + fuzz + invariant) and `FOUNDRY_NO_MATCH_PATH=zzz forge test --match-contract MainnetForkTest --fork-url $BSC_RPC_URL` (fork). Coverage: `forge coverage --no-match-coverage "(test|mocks|script)"` — 100 % lines on core contracts at the time of writing.


## X-ray invariant map (x-ray/invariants.md, generated before today's audit fixes; F-1..F-6 fixed since)
# Invariant Map

> Parallax | 46 guards | 21 inferred | 4 not enforced on-chain

---

## 1. Enforced Guards (Reference)

Per-call preconditions. Heading IDs below (`G-N`) are anchor targets from x-ray.md attack surfaces.

#### G-1
`if (admin == address(0) || usdt_ == address(0)) revert ZeroAddress()` · `StockRegistry.sol:66` · a registry with no admin or no settlement token can never be configured or used.

#### G-2
`if (_reps[token].exists) revert AlreadyRegistered(token)` · `StockRegistry.sol:91` · a representation's underlying/platform/ratio source is immutable once registered; re-registration cannot re-point a token.

#### G-3
`if (initialRatio == 0) revert ZeroRatio()` · `StockRegistry.sol:92` · a zero ratio would make `tokensForShares` divide by zero and `heldShares` read as zero backing.

#### G-4
`if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_, MAX_FEE_BPS)` · `StockRegistry.sol:126` · admin cannot set a fee above 1 %; bounds the value ADMIN can skim from every USDT flow.

#### G-5
`if (ratio == 0) revert ZeroRatio()` · `StockRegistry.sol:150` · `confirmRatio` cannot zero a ratio (same division/backing hazard as G-3).

#### G-6
`if (r.ratioSource != RatioSource.KEEPER) revert WrongRatioSource()` · `StockRegistry.sol:172` · the keeper may only post for keeper-sourced tokens; ERC-8056 checkpoints stay bound to the token's own multiplier.

#### G-7
`if (step > maxRatioStepBps) revert RatioStepTooLarge(step, maxRatioStepBps)` · `StockRegistry.sol:175-178` · one keeper post can move a ratio at most 5 % from the last value (bounded-keeper trust model).

#### G-8
`if (r.ratioSource != RatioSource.ERC8056) revert WrongRatioSource()` · `StockRegistry.sol:188` · `checkpointRatio` (permissionless) only ever copies a token's own `uiMultiplier()`, never a caller-supplied value.

#### G-9
`if (live == 0) revert ZeroRatio()` · `StockRegistry.sol:190` · a token reporting a zero multiplier cannot be checkpointed.

#### G-10
`if (step > maxRatioStepBps) revert RatioStepTooLarge(step, maxRatioStepBps)` · `StockRegistry.sol:192-195` · a corporate-action jump in an ERC-8056 multiplier keeps that token buy-ineligible until ADMIN `confirmRatio`.

#### G-11
`if (attestedAt_ > block.timestamp) revert StaleTimestamp()` · `StockRegistry.sol:201` · attestation timestamps cannot be in the future (would extend buy eligibility indefinitely).

#### G-12
`if (attestedAt_ < _attestedAt[platformId]) revert StaleTimestamp()` · `StockRegistry.sol:202` · attestations are monotone; a keeper cannot roll a platform back to a stale date.

#### G-13
`if (_underlyings[underlyingId].id == bytes32(0)) revert UnknownUnderlying(underlyingId)` · `StockRegistry.sol:90,208` · representations and market state can only attach to registered underlyings.

#### G-14
`if (!r.exists || !r.active || buysPaused) return false` · `StockRegistry.sol:282` · buy eligibility requires registration, activity and no guardian pause (sells never check this).

#### G-15
`if (block.timestamp - _attestedAt[r.platformId] > maxAttestationAge) return false` · `StockRegistry.sol:283` · buys stop when a platform's attestation is older than 36 h.

#### G-16
`return block.timestamp - p.updatedAt <= maxRatioAge` · `StockRegistry.sol:286` · keeper-sourced ratios older than 12 h block buys (never exits).

#### G-17
`return ShareMath.stepBps(p.ratio, live) <= maxRatioStepBps` · `StockRegistry.sol:291` · an ERC-8056 token whose live multiplier drifted > 5 % from its checkpoint is not buy-eligible.

#### G-18
`if (usdtIn == 0) revert ZeroAmount()` · `ShareRouter.sol:59` · rejects empty buys before any transfer.

#### G-19
`if (legs.length == 0) revert NoLegs()` · `ShareRouter.sol:61,97` · a buy/sell must execute at least one leg (no silent no-op that still charges).

#### G-20
`if (sharesOut < minShares) revert InsufficientShares(sharesOut, minShares)` · `ShareRouter.sol:71` · share-denominated slippage: the caller's minimum is measured in underlying shares via registry ratios, not token units.

#### G-21
`if (fee > available) revert InsufficientForFee(available, fee)` · `ShareRouter.sol:132`, `BasketVault.sol:183` · the fee is only ever paid from what the caller sent in / received; it can never be taken from held assets.

#### G-22
`if (!registry.isSellEligible(representation)) revert NotSellEligible(representation)` · `ShareRouter.sol:98` · only registered tokens are sellable through the router (receipts must resolve a ratio).

#### G-23
`if (registry.underlyingOf(representation) != underlyingId) revert WrongUnderlying(...)` · `ShareRouter.sol:99`, `:148` · a leg cannot buy or sell a token of a different stock than the one named in the call.

#### G-24
`if (usdtOut < minUsdtOut) revert InsufficientUsdtOut(usdtOut, minUsdtOut)` · `ShareRouter.sol:111`, `BasketVault.sol:165` · net-of-fee proceeds must meet the caller's minimum.

#### G-25
`if (!registry.isAllowedTarget(leg.target)) revert TargetNotAllowed(leg.target)` · `ShareRouter.sol:145,170`, `BasketVault.sol:105,152,242` · untrusted calldata can only reach ADMIN-allowlisted swap targets.

#### G-26
`if (leg.tokenIn != address(usdt)) revert LegTokenInMustBeUsdt(leg.tokenIn)` · `ShareRouter.sol:146`, `BasketVault.sol:106` · buy legs can only spend USDT the caller supplied, never a held representation.

#### G-27
`if (!registry.isBuyEligible(leg.tokenOut)) revert NotBuyEligible(leg.tokenOut)` · `ShareRouter.sol:147`, `BasketVault.sol:107,251` · fresh-ratio / fresh-attestation / not-paused gate on every acquired token.

#### G-28
`if (leg.tokenIn != representation) revert LegTokenInMismatch(leg.tokenIn)` · `ShareRouter.sol:171` · a sell leg spends exactly the token the seller deposited.

#### G-29
`if (leg.tokenIn == leg.tokenOut) revert LegSameToken()` · `LegExecutor.sol:30` · a same-token leg would make the balance-delta accounting meaningless.

#### G-30
`if (!ok) revert LegCallFailed(ret)` · `LegExecutor.sol:37` · a failed router call reverts the whole entry point (no partial fills counted).

#### G-31
`if (spent > leg.maxIn) revert LegOverspent(spent, leg.maxIn)` · `LegExecutor.sol:43` · per-leg hard cap on tokenIn measured by balance delta, independent of the approval.

#### G-32
`if (received == 0) revert LegNothingReceived()` · `LegExecutor.sol:45` · a leg must deliver tokenOut to the executing contract (recipient-in-calldata cannot divert output).

#### G-33
`if (c.sharesPerUnit == 0) revert ZeroSharesPerUnit(...)` · `BasketVault.sol:78` · every constituent contributes shares to a unit.

#### G-34
`if (c.maxIssuerBps == 0 || c.maxIssuerBps > BPS) revert BadIssuerCap(...)` · `BasketVault.sol:79` · issuer caps are within (0, 100 %].

#### G-35
`if (_constituentIndexPlusOne[c.underlyingId] != 0) revert DuplicateConstituent(...)` · `BasketVault.sol:80` · one constituent per underlying, so `heldShares(i)` is not double-counted.

#### G-36
`if (units == 0 || maxUsdtIn == 0) revert ZeroAmount()` · `BasketVault.sol:97` · a mint must create units and bring USDT.

#### G-37
`if (_constituentIndexPlusOne[uid] == 0) revert NotAConstituent(leg.tokenOut)` · `BasketVault.sol:109` · a mint leg can only acquire a constituent's token (the vault never holds a stock it does not owe).

#### G-38
`if (usdtSpent > maxUsdtIn) revert OverSpent(usdtSpent, maxUsdtIn)` · `BasketVault.sol:116` · total spend across legs is bounded by what the minter sent.

#### G-39
`if (held < req) revert BackingViolated(...)` · `BasketVault.sol:360` (via `_checkAllBacking` at `:119`, `_checkBacking` at `:270`) · after a mint or migration every constituent's held shares cover `totalSupply × sharesPerUnit`.

#### G-40
`if (platformShares > limit) revert IssuerCapExceeded(...)` · `BasketVault.sol:390` (via `:120`, `:269`) · no issuer exceeds `maxIssuerBps` of a constituent while ≥ 2 representations are buy-eligible.

#### G-41
`if (have < units) revert InsufficientUnits(have, units)` · `BasketVault.sol:144,203` · a holder can only redeem units they own.

#### G-42
`if (leg.tokenOut != address(usdt)) revert LegTokenOutMustBeUsdt(leg.tokenOut)` · `BasketVault.sol:153` · a redemption leg can only sell into USDT.

#### G-43
`if (leg.maxIn > remaining[j]) revert LegExceedsProRata(...)` · `BasketVault.sol:156` · a redeemer's legs can sell at most their pro-rata slice of each held token.

#### G-44
`if (afterTarget <= before[idx]) revert InsufficientShareGain(...)` / `if (shareGain < minShareGain) ...` · `BasketVault.sol:259-261` · a migration must strictly increase the target constituent's shares by ≥ `minShareGain`.

#### G-45
`if (a < before[i]) revert ConstituentDecreased(...)` / `if (usdtAfter < usdtBefore) revert UsdtDecreased(...)` · `BasketVault.sol:265,268` · a migration may not decrease any other constituent nor the vault's USDT.

#### G-46
`if (m.agent != msg.sender) revert NotAgent(); ... if (amount > m.perTxCapUsdt) ...; if (amount > remaining) ...` · `AgentMandate.sol:194-206` · only the named agent, while active and unexpired, within per-tx and rolling-24h caps.

---

## 2. Inferred Invariants (Single-Contract)

Inferred invariants are derived from structural analysis of the source code. Each block below cites one of five extraction methods in its `Derivation` field: Δ-pair analysis, guard lift, state-machine edge, temporal predicate, or NatSpec-stated global property. Each block is classified into one of five categories by shape: `Conservation` · `Bound` · `Ratio` · `StateMachine` · `Temporal`.

---

#### I-1

`Bound` · On-chain: **Yes**

> `feeBps ∈ [0, MAX_FEE_BPS]` (0–100 bps) at all times.

**Derivation** — guard-lift: `if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh` at `StockRegistry.sol:126`; write sites of `feeBps`: `setFee` only (`:127`).

**If violated** — ADMIN could set a confiscatory fee; the cap makes "at most 1 % per USDT flow" a code guarantee.

---

#### I-2

`Bound` · On-chain: **Yes**

> `fee()` reports `bps = 0` whenever `feeRecipient == address(0)`; no fee is ever transferred to the zero address.

**Derivation** — guard-lift: `return (feeRecipient == address(0) ? 0 : feeBps, feeRecipient)` at `StockRegistry.sol:134`; consumers `ShareRouter._chargeFee:129` and `BasketVault._chargeFee:180` return early on `bps == 0`.

**If violated** — `safeTransfer(address(0), fee)` would burn or revert every buy/mint.

---

#### I-3

`Bound` · On-chain: **No**

> `maxRatioStepBps ≤ 10_000` and `maxAttestationAge`, `maxRatioAge` are non-zero.

**Derivation** — guard-lift: no guard exists at the only write site `setLimits` (`StockRegistry.sol:137-145`); `stepBps` comparisons (`:175`, `:192`, `:291`) and age comparisons (`:283`, `:286`) accept any value.

**If violated** — `maxRatioStepBps = 10_000` lets a keeper post a 100 % ratio move in one call (I-6 becomes meaningless); `maxRatioAge = 0` blocks every keeper-sourced buy on the next block. ADMIN-only, but no code bound — a misconfiguration surface.

---

#### I-4

`Bound` · On-chain: **Yes**

> Every registered representation has `_posted[token].ratio > 0` (no ratio is ever written as zero).

**Derivation** — guard-lift: `ZeroRatio` checks at every write site of `_posted`: `addRepresentation:92`, `confirmRatio:150`, `postRatio:173`, `checkpointRatio:190`.

**If violated** — `tokensForShares` divides by ratio (`ShareMath.sol:20`); `heldShares` would credit zero shares for held tokens and break backing math.

---

#### I-5

`Bound` · On-chain: **Yes**

> For keeper-sourced tokens, each `postRatio` moves the ratio by at most `maxRatioStepBps` of the previous value; `confirmRatio` is the only unbounded writer and is ADMIN-gated.

**Derivation** — guard-lift: `stepBps(...) > maxRatioStepBps → revert` at `StockRegistry.sol:174-178` and `:191-195`; write sites of `_posted`: `addRepresentation` (initial), `confirmRatio` (ADMIN, unbounded by design), `postRatio` (bounded), `checkpointRatio` (bounded).

**If violated** — a keeper could inflate a ratio so the vault believes it holds more shares than it does, allowing under-backed mints (T2 in docs/threat-model.md).

---

#### I-6

## AGGREGATE_VARIABLES (grep)
src/AgentMandate.sol:31:        uint128 spentInWindow;
src/AgentMandate.sol:115:            spentInWindow: 0,
src/AgentMandate.sol:243:        return m.dailyCapUsdt - m.spentInWindow;
src/AgentMandate.sol:258:            m.spentInWindow = 0;
src/AgentMandate.sol:260:        uint128 remaining = m.dailyCapUsdt - m.spentInWindow;
src/AgentMandate.sol:281:        m.spentInWindow += uint128(spent);
src/BasketVault.sol:18:///           - Backing: heldShares(i) >= totalSupply * sharesPerUnit(i) / 1e18 for every i, after every call.
src/BasketVault.sol:162:            _proRataHoldings(units, totalSupply());
src/BasketVault.sol:229:        (address[] memory tokens, uint256[] memory amounts, uint256 usdtShare) = _proRataHoldings(units, totalSupply());
src/BasketVault.sol:260:            before[i] = heldShares(i);
src/BasketVault.sol:269:        uint256 afterTarget = heldShares(idx);
src/BasketVault.sol:275:            uint256 a = heldShares(i);
src/BasketVault.sol:322:    function heldShares(uint256 i) public view override returns (uint256 total) {
src/BasketVault.sol:326:            if (bal != 0) total += registry.sharesForTokens(reps[r], bal);
src/BasketVault.sol:330:    function requiredShares(uint256 i) public view returns (uint256) {
src/BasketVault.sol:331:        return ShareMath.requiredShares(totalSupply(), _constituents[i].sharesPerUnit);
src/BasketVault.sol:336:            if (heldShares(i) < requiredShares(i)) return false;
src/BasketVault.sol:369:                requiredShares: requiredShares(i),
src/BasketVault.sol:370:                heldShares: held,
src/BasketVault.sol:388:        uint256 held = heldShares(i);
src/BasketVault.sol:389:        uint256 req = requiredShares(i);
src/BasketVault.sol:405:    ///      representation on the same platform. `held` is the constituent total.
src/BasketVault.sol:426:            uint256 delivered = heldShares(i) - heldBefore[i];
src/BasketVault.sol:427:            uint256 required = ShareMath.requiredShares(units, _constituents[i].sharesPerUnit);
src/libraries/ShareMath.sol:24:    function requiredShares(uint256 units, uint256 sharesPerUnit) internal pure returns (uint256) {
src/libraries/ShareMath.sol:28:    /// @dev Pro-rata slice of `balance` for `units` out of `totalSupply` (round down: vault keeps dust).
src/libraries/ShareMath.sol:29:    function proRata(uint256 balance, uint256 units, uint256 totalSupply) internal pure returns (uint256) {
src/libraries/ShareMath.sol:30:        if (totalSupply == 0) return 0;
src/libraries/ShareMath.sol:31:        return Math.mulDiv(balance, units, totalSupply);


## PAIRED_OPERATIONS
mint/redeem/redeemInKind (BasketVault), buyShares/sellShares (ShareRouter), createMandate/revoke (AgentMandate), migrate (sell rep A → buy rep B, same constituent), postRatio/confirmRatio/checkpointRatio (StockRegistry), setBuysPaused(true/false)

## CONVERSION_FUNCTIONS
src/AgentMandate.sol:220:    function sharesFloor(uint256 id, bytes32 underlyingId, uint256 usdtSpent) public view returns (uint256) {
src/AgentMandate.sol:228:    function unitsFloor(uint256 id, address basket, uint256 usdtSpent) public view returns (uint256) {
src/BasketVault.sol:322:    function heldShares(uint256 i) public view override returns (uint256 total) {
src/BasketVault.sol:330:    function requiredShares(uint256 i) public view returns (uint256) {
src/StockRegistry.sol:333:    function sharesForTokens(address token, uint256 amount) external view override returns (uint256) {
src/StockRegistry.sol:338:    function tokensForShares(address token, uint256 shares) external view override returns (uint256) {
src/StockRegistry.sol:360:    function referencePrice(bytes32 underlyingId) external view override returns (uint256 priceUsd, uint64 updatedAt) {
src/libraries/ShareMath.sol:14:    function sharesForTokens(uint256 tokens, uint256 ratio) internal pure returns (uint256) {
src/libraries/ShareMath.sol:19:    function tokensForShares(uint256 shares, uint256 ratio) internal pure returns (uint256) {
src/libraries/ShareMath.sol:24:    function requiredShares(uint256 units, uint256 sharesPerUnit) internal pure returns (uint256) {
src/libraries/ShareMath.sol:29:    function proRata(uint256 balance, uint256 units, uint256 totalSupply) internal pure returns (uint256) {
src/libraries/ShareMath.sol:35:    function stepBps(uint256 oldRatio, uint256 newRatio) internal pure returns (uint256) {


## ACCESS_CONTROL
src/AgentMandate.sol:69:    error NotOwner();
src/AgentMandate.sol:70:    error NotAgent();
src/AgentMandate.sol:134:        if (m.owner != msg.sender) revert NotOwner();
src/AgentMandate.sol:140:        if (_mandates[id].owner != msg.sender) revert NotOwner();
src/AgentMandate.sol:146:        if (_mandates[id].owner != msg.sender) revert NotOwner();
src/AgentMandate.sol:252:        if (m.agent != msg.sender) revert NotAgent();
src/BasketFactory.sol:35:    ) external onlyRole(BASKET_CREATOR_ROLE) returns (address basket) {
src/StockRegistry.sol:99:    function setUnderlying(bytes32 id, string calldata ticker, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:112:    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:135:    function setRepresentationActive(address token, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:142:    function setAllowedTarget(address target, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:150:    function setFee(uint16 feeBps_, address recipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:164:        onlyRole(DEFAULT_ADMIN_ROLE)
src/StockRegistry.sol:173:    function setPriceLimits(uint64 maxPriceAge_, uint16 maxPriceStepBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:181:    function setPriceFeed(bytes32 underlyingId, address feed) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:188:    function confirmRatio(address token, uint256 ratio) external onlyRole(DEFAULT_ADMIN_ROLE) {
src/StockRegistry.sol:200:    function setBuysPaused(bool paused) external onlyRole(GUARDIAN_ROLE) {
src/StockRegistry.sol:211:    function postRatio(address token, uint256 ratio) external onlyRole(KEEPER_ROLE) {
src/StockRegistry.sol:228:    function postReferencePrice(bytes32 underlyingId, uint256 priceUsd) external onlyRole(KEEPER_ROLE) {
src/StockRegistry.sol:249:    function checkpointRatio(address token) external onlyRole(KEEPER_ROLE) {
src/StockRegistry.sol:265:    function postAttestation(bytes32 platformId, uint64 attestedAt_) external onlyRole(KEEPER_ROLE) {
src/StockRegistry.sol:272:    function postMarketState(bytes32 underlyingId, bool open) external onlyRole(KEEPER_ROLE) {
src/mocks/MockStockToken.sol:33:    function setPaused(bool p) external onlyOwner {
src/mocks/MockStockToken.sol:37:    function setBlocked(address user, bool b) external onlyOwner {
src/mocks/MockStockToken.sol:41:    function setMultiplier(uint256 m) external onlyOwner {
src/mocks/MockStockToken.sol:45:    function scheduleMultiplier(uint256 m, uint256 effectiveAt_) external onlyOwner {
src/mocks/MockStockToken.sol:75:        if (from != msg.sender && to != msg.sender && blocked[msg.sender]) revert UserBlocked(msg.sender);
src/mocks/MockSwapTarget.sol:37:    modifier onlyOperator() {
src/mocks/MockSwapTarget.sol:38:        if (msg.sender != owner && msg.sender != keeper) revert NotAuthorized(msg.sender);
src/mocks/MockSwapTarget.sol:47:        if (msg.sender != owner) revert NotAuthorized(msg.sender);
src/mocks/MockSwapTarget.sol:52:    function setPrice(address token, uint256 usdPerToken) external onlyOperator {
src/mocks/MockSwapTarget.sol:57:    function setFeeBps(uint16 bps) external onlyOperator {
src/mocks/MockSwapTarget.sol:61:    function setMode(Mode m, bytes calldata data) external onlyOperator {


## Harness files already in place (read them; do not duplicate the specific properties already implemented)
- test/fizz/Base.sol (Ghosts: routerDonated, vaultDonated, freeMintSucceeded, feePaid; helpers _leg/_mintLegs/_usdtForShares/_notional/_sharesHeld)
- test/fizz/Snapshots.sol (State: supply, heldShares[2], vaultUsdt, routerUsdt, mandateUsdt, feeRecipientUsdt, agentUsdt, agentUnits, backingOk)
- test/fizz/Properties.sol (specific properties _prop_* already wired from every handler; NO global property_* yet)
- test/fizz/handlers/{ShareRouter,BasketVault,AgentMandate,StockRegistry}Handler.sol
