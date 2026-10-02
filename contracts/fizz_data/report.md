# Fuzzing Suite Report

## Suite Overview
- **Project**: Parallax (`contracts/` — ShareRouter, BasketVault, AgentMandate, StockRegistry, BasketFactory, libraries)
- **Suite location**: `test/fizz/`
- **Contracts targeted**: `BasketVault`, `ShareRouter`, `AgentMandate`, `StockRegistry`, `BasketFactory` (plus libraries `LegExecutor`, `ShareMath`, `ReceiptEmitter` exercised transitively)
- **Total handlers**: 67 (63 primary, 4 secondary/dispatcher: `agentMandate_secondary`, `basketVault_secondary`, `stockRegistry_secondary`, `environment_secondary`)
- **Properties**: 64 implemented in `Properties.sol` (32 global `property_*`, 32 internal `_prop_*` specifics — of the specifics, 17 are the pre-existing baseline wired one-per-handler and 15 are the newly-generated `SP-*` set from `fizz_data/property-plan.md`). Of the 54-property discovery plan (37 global + 17 specific), 47 are implemented (`[x]`) and 7 are documented skips (`[-]`): GL-10, GL-28, GL-33, GL-34, GL-35, SP-09, SP-11.

## Coverage Results
Fuzz profile requires `via_ir` (stack-too-deep in `BasketVault.migrate` without it) with `optimizer_runs=0`, which deflates raw line coverage numbers by roughly 10 points; targets in `fizz_data/coverage-targets.md` were set accordingly. Final campaign figures (Cycle 2, all targets met):

| Contract | Target | Achieved | Status |
|----------|--------|----------|--------|
| BasketVault | 70% | 98% | ✅ |
| AgentMandate | 70% | 97% | ✅ |
| ShareRouter | 70% | 96% | ✅ |
| StockRegistry | 50% | 88% | ✅ |
| LegExecutor | inherited | 100% | ✅ |
| ReceiptEmitter | inherited | 100% | ✅ |
| ShareMath | inherited | 100% | ✅ |
| BasketFactory | n/a (one-shot `createBasket` in setup only) | 90% | ✅ |

## Skipped Paths
| Contract | Function / Path | Reason |
|----------|----------------|--------|
| StockRegistry | `setPriceFeed` / `referencePrice` Chainlink-feed branch | No Chainlink mock in harness scope; covered separately by unit tests |
| StockRegistry | `addRepresentation`, `setUnderlying` beyond `Base.setup()` | Only called once during fixture setup; no handler re-exercises them mid-run (GL-20/GL-27 remain valid but cannot find new bugs on this path today) |
| StockRegistry | role management (`grantRole`/`revokeRole`) | Out of scope for this pass; access control is exercised via wrong-caller handlers instead |
| LegExecutor | `REENTER` / `TAKE_MORE` adversarial venue modes | Covered by Foundry fuzz/unit tests (`testFuzz_adversarial_modes`), not wired into the stateful harness |
| BasketFactory | `createBasket` beyond setup | Only the fixture `pxFUZZ` basket exists; `ghosts.everCreatedBaskets` / GL-09's multi-basket half is not exercised |
| LegExecutor (harness-only) | `MockSwapTarget.Mode.REFUND_THEN_DELIVER` | Not implemented — mock-contract change needed for SP-09; documented as a follow-up |

## Campaign Results
- **Fuzzer used**: Medusa
- **Duration**: 4m58s
- **Total calls**: 270,136 (1,064/sec)
- **Branches hit**: 35,498
- **Corpus size**: 451
- **Violations found**: 0 in the final campaign (93/93 assertion tests `[PASSED]`, 0 failed)

### Violation Details
No violations in the reported final campaign (0/2990+ sequence failures logged, `Test summary: 93 test(s) passed, 0 test(s) failed`). One real issue was found and fixed during earlier campaign cycles, and one contract tightening plus several harness-side false positives were resolved before this final run; all are recorded below for completeness since they shaped the suite that produced the clean result.

#### 1. Backing rounding gap after a pro-rata burn (fixed in contract)
- **Property violated**: B1 (backing), surfaced via the harness's post-burn backing check (predecessor of `_prop_burnKeepsBackingRatio` / GL-01)
- **Guarantee**: `SHOULD-HOLD` — docs/invariants.md B1
- **Assertion**: `basket.backingOk()` must be `true` after every state-changing vault call
- **Root cause**: `heldShares` summed per-representation floors (`sharesForTokens`, rounds down) while `requiredShares` used a ceiling. After a pro-rata burn, the sum of floors could land 1–2 wei below the ceiling, flipping `backingOk()` false and causing the next exact mint to revert.
- **Severity assessment**: `protocol bug` — genuine off-by-a-few-wei rounding mismatch between two independently-rounded quantities being compared
- **Fix**: `src/BasketVault.sol` now compares backing and delivery exactly in 1e36 scale (`_heldSharesWad`) instead of composing two separately-rounded values.
- **Reproducing sequence**: `basketVault_mint_dust(2335525000000000017167, 26522)` → `basketVault_secondary(141, 7237005577332262213973186563042994240829374041602535252464913625989141142508, address(0x6f05b59d3b20000), 17)` (a dust mint followed by a burn that exposed the gap)
- **Foundry repro**: `test_repro_burnKeepsBackingExactly` in `FoundryTester.sol:45` — `PASS` (confirms the fix holds: `basket.backingOk()` is true both before and after the burn)

#### 2. Issuer-cap dilution check tightened (contract change, not a violation)
- **Property violated**: B4 / GL-37 (`property_issuerCapOrDiluting`), flagged by discovery agent ADV-07 (SP-11 in the property plan)
- **Guarantee**: `SHOULD-HOLD` — docs/invariants.md B4, Audit F-4
- **Assertion**: while ≥2 representations are buy-eligible, an over-cap platform's share of a constituent must be within `maxIssuerBps` or strictly diluting
- **Root cause**: the original `_checkIssuerCap` compared two independently bps-floored ratios, which could let a platform's *true* (unrounded) share creep upward across a sequence of individually-accepted mints/migrations while each call's floored comparison still read as "diluted".
- **Severity assessment**: `protocol bug` (tightened proactively; no live campaign counterexample was needed once cross-multiplication replaced the floored comparison)
- **Fix**: the dilution test now cross-multiplies (`platformShares * totalBefore` vs `platformSharesBefore * totalAfter`) instead of comparing bps-floored ratios (commit `80fda00`).
- **Reproducing sequence**: N/A — found by discovery-agent static reasoning, not a live campaign failure
- **Foundry repro**: covered by the existing issuer-cap dilution unit test (exact ratio comparison), not a `test_repro_*` entry since no campaign failure occurred

#### 3. Harness-side false positives (restated, not contract bugs)
- **Property violated**: an earlier, stronger form of B1 ("backing holds after redeem"); an earlier, stronger form of B6-adjacent USDT-ledger check ("vault keeps no USDT beyond donations"); GL-05 (fee ledger completeness); GL-01 (definition of `heldShares`); SP-02 (round-trip no-profit); SP-10 (fee-splitting floor)
- **Guarantee**: `SHOULD-HOLD` for the backing/USDT/GL-01/GL-05 restatements (they still assert real invariants, just correctly scoped); `EXPLORATORY` for SP-02/SP-10 (inferred economic properties, correctly bounded)
- **Assertion / root cause**:
  - *"Backing holds after redeem"*: issuer multiplier drift (ERC-8056) or a keeper ratio post between calls can legitimately lower `heldShares` without any vault action — this is documented "backing on live ratio" behaviour, not a bug. Restated as `_prop_burnKeepsBackingRatio`: "a burn never *lowers* the backing ratio" (with a 1e6-share tolerance for share-level rounding stacked on the token-level floor), plus `t(stateAfter.backingOk || !stateBefore.backingOk, ...)` so a burn cannot newly break backing that already held.
  - *"Vault keeps no USDT beyond donations"*: the vault legitimately holds USDT from migration residue and forfeited in-kind slices (`redeemInKindSkipping` with USDT skipped) — this is not a leak. Restated as "a mint does not change vault USDT" (`_prop_mint`'s `eq(stateAfter.vaultUsdt, stateBefore.vaultUsdt, ...)`), which is the operation-specific guarantee that actually holds.
  - *GL-05*: the mandate and round-trip handlers charge fees without going through the original `_recordFeePaid` ghost, so a strict equality against `ghosts.feePaid` was a false positive. Restated as a floor (`gte(balance, ghosts.feePaid)`) plus monotonicity (`feeRecipientHigh` never decreases), with the exact per-call identity moved to `_prop_feeExact` (`notional * bps / 10_000`).
  - *GL-01*: `heldShares` is defined as one floor over the summed balance×ratio (not a sum of per-representation floors), so it can legitimately sit up to `rs.length` wei above the naive sum-of-floors. The property now asserts the exact recomputed value (`held == wad / 1e18`) plus bounds against the sum-of-floors (`gte(held, floors)`, `lte(held, floors + rs.length)`).
  - *SP-02*: other holders' by-design over-delivery slack (rounding residue, favorable migrations, donations) legitimately accrues pro rata to remaining holders, so a round-trip check that includes other actors' activity can show apparent "profit" that is really pre-existing slack. The round-trip handler now only runs the check on a sole-holder, windfall-free vault state.
  - *SP-10*: the fee is floored per call (`notional * bps / 10_000`), so splitting one notional into N dust calls legitimately under-pays by up to 1 wei *per call* versus a single call — this is bounded dust loss, not a fee-avoidance exploit. The assertion is `gte(splitFee + calls, singleCallFee)`, i.e. bounded to 1 wei per call rather than an unbounded shortfall.
- **Severity assessment**: `test harness false positive` for all six — each was an over-strong property that did not account for a documented, intentional protocol behavior (live-ratio backing, legitimate vault USDT residue, fee paths outside one ghost, `heldShares`'s single-floor definition, pro-rata slack accrual, and per-call fee flooring).
- **Reproducing sequence**: N/A — these were corrected during property design/tuning in earlier cycles (see `fizz_data/coverage-targets.md` Cycle 1/2 notes), not left as live campaign failures.
- **Foundry repro**: N/A — no `test_repro_*` entries needed since the restated properties pass cleanly in the final campaign.

## Properties Implemented

### Global (`property_*`)
| # | Property | Type | Guarantee | Confidence |
|---|----------|------|-----------|------------|
| GL-01 | property_heldSharesIsSumOfRepresentationShares | Global | SHOULD-HOLD | HIGH — exact recomputation (`held == wad/1e18`) plus bounded slack check against sum-of-floors |
| GL-02 | property_basketSupplyEqualsHolders | Global | SHOULD-HOLD | HIGH — exact identity over all known holder addresses |
| GL-03 | property_routerHoldsOnlyDonations | Global | SHOULD-HOLD | HIGH — exact equality per token against a donation ghost |
| GL-04 | property_mandateHoldsOnlyDonations | Global | SHOULD-HOLD | MEDIUM — exact for USDT, but reps/basket-units have no donation path today so those legs are untested by construction |
| GL-05 | property_feeRecipientBalanceMatchesChargedFees | Global | SHOULD-HOLD | MEDIUM — floor + monotonicity only (`gte`), not exact, since mandate/round-trip fee flows bypass the `feePaid` ghost; exact check lives in `_prop_feeExact` instead |
| GL-06 | property_spentInWindowMatchesGhostSum | Global | SHOULD-HOLD | MEDIUM — checks boundedness and monotonicity within an unchanged window, not a fully independent re-derivation of the spend total |
| GL-07 | property_mandateBookkeepingIsConsistent | Global | SHOULD-HOLD | HIGH — exact identity across three independent counts |
| GL-08 | property_compositionShareBpsSumsToBps | Global | SHOULD-HOLD | MEDIUM — allows up to 1 unit of floor-rounding slack per representation |
| GL-09 | property_basketFactoryBookkeepingConsistent | Global | SHOULD-HOLD | MEDIUM — only ever exercises the single fixture basket (`createBasket` not wired mid-run) |
| GL-11 | property_shareMath_tokensRoundTripNeverGrows | Global | SHOULD-HOLD | HIGH — exact round-trip identity over 4 sampled magnitudes per representation |
| GL-12 | property_shareMath_sharesRoundTripNeverShrinks | Global | SHOULD-HOLD | HIGH — exact round-trip identity |
| GL-13 | property_sharesForTokens_roundsDownAndZeroSafe | Global | SHOULD-HOLD | HIGH |
| GL-14 | property_tokensForShares_roundsUpAndZeroSafe | Global | SHOULD-HOLD | HIGH |
| GL-15 | property_requiredShares_roundsUp | Global | SHOULD-HOLD | HIGH — exact ceiling identity |
| GL-16 | property_proRata_boundedAndSubAdditive | Global | SHOULD-HOLD | HIGH |
| GL-17 | property_shareMath_monotonic | Global | SHOULD-HOLD | MEDIUM — fixed ratio, 3 sampled magnitude pairs; does not sweep ratio |
| GL-18 | property_agentMandate_floorsMonotonicAndZeroSafe | Global | SHOULD-HOLD | MEDIUM — evaluated only against mandate id 0 (never created, `maxSlippageBps==0`), not a live created mandate |
| GL-19 | property_ratioNeverCompoundsPastStepWithinWindow | Global | SHOULD-HOLD | HIGH — independent harness-tracked window anchor, not the contract's own bookkeeping |
| GL-20 | property_representationIdentityImmutable | Global | SHOULD-HOLD | MEDIUM — `addRepresentation` only runs in setup, so this never observes a live re-registration attempt |
| GL-21 | property_revokedMandateStaysInactive | Global | SHOULD-HOLD | HIGH |
| GL-22 | property_representationExistsIsPermanent | Global | SHOULD-HOLD | HIGH |
| GL-23 | property_buysPausedChangesOnlyViaSetBuysPaused | Global | SHOULD-HOLD | HIGH |
| GL-24 | property_mandateNextIdMonotonicNoReuse | Global | SHOULD-HOLD | HIGH |
| GL-25 | property_attestationTimestampMonotone | Global | SHOULD-HOLD | HIGH |
| GL-26 | property_representationCountNeverShrinks | Global | SHOULD-HOLD | MEDIUM — same setup-only caveat as GL-20/GL-27 |
| GL-27 | property_underlyingIdsMonotoneNoDuplicates | Global | SHOULD-HOLD | MEDIUM — `setUnderlying` only runs in setup |
| GL-29 | property_representationRatioNeverZero | Global | SHOULD-HOLD | HIGH |
| GL-30 | property_noDanglingApprovalToVenue | Global | SHOULD-HOLD | HIGH — checked after every call, not just leg-executing ones |
| GL-31 | property_mandateOwnerAgentImmutable | Global | SHOULD-HOLD | HIGH |
| GL-32 | property_basketConstituentSetImmutable | Global | SHOULD-HOLD | HIGH |
| GL-36 | property_vaultNeverHoldsOwnUnits | Global | EXPLORATORY | MEDIUM — general ERC-20 self-transfer footgun check, not a documented guarantee; `basketVault_transferSelf_clamped` deliberately can't target the vault itself |
| GL-37 | property_issuerCapOrDiluting | Global | SHOULD-HOLD | HIGH — recomputed independently of `_checkIssuerCap` using a live snapshot |

### Specific — newly generated (`_prop_*`, `SP-*`)
| # | Property | Type | Guarantee | Confidence |
|---|----------|------|-----------|------------|
| SP-01 | _prop_mintRedeemInKindRoundTrip | Specific | EXPLORATORY | MEDIUM — restricted to a sole-holder, windfall-free vault state to avoid the pro-rata-slack false positive |
| SP-02 | _prop_mintRedeemFullSellZeroFee | Specific | EXPLORATORY | MEDIUM — same sole-holder restriction as SP-01 |
| SP-03 | _prop_mintRedeemInKindNCycles | Specific | EXPLORATORY | MEDIUM — compounding-rounding detector over N cycles in one call |
| SP-04 | _prop_buySellSharesRoundTrip | Specific | SHOULD-HOLD | HIGH — math-identity guarantee (floor `mulDiv` + non-negative fee subtraction is non-increasing) |
| SP-05 | _prop_representationToggleSanity | Specific | SHOULD-HOLD | HIGH |
| SP-06 | _prop_mandateAllowanceResetAfterAgentCall | Specific | SHOULD-HOLD | HIGH |
| SP-07 | _prop_revokeSucceedsAtMaxUtilization | Specific | SHOULD-HOLD | HIGH |
| SP-08 | _prop_agentCannotSpendAfterRevoke | Specific | SHOULD-HOLD | HIGH |
| SP-10 | _prop_feeNotReducedBySplitting | Specific | EXPLORATORY | MEDIUM — 1-wei-per-call tolerance may mask a small systematic shortfall if the tolerance is looser than actual behavior |
| SP-12 | _prop_nonAdminCannotCallAdminFns | Specific | SHOULD-HOLD | HIGH |
| SP-13 | _prop_roleSeparationEnforced | Specific | SHOULD-HOLD | HIGH |
| SP-14 | _prop_nonAgentCannotSpendMandate | Specific | SHOULD-HOLD | HIGH |
| SP-15 | _prop_nonOwnerCannotControlMandate | Specific | SHOULD-HOLD | HIGH |
| SP-16 | _prop_setFeeNeverExceedsCap | Specific | SHOULD-HOLD | HIGH |
| SP-17 | _prop_selfAndZeroTransferAreNoOps | Specific | EXPLORATORY | HIGH — OZ `_update` self-transfer identity is well-established, included as a coverage-gap check |

### Specific — pre-existing baseline (wired one per handler, not itemized in PROPERTIES.md)
| # | Property | Type | Guarantee | Confidence |
|---|----------|------|-----------|------------|
| N/A | _prop_feeExact | Specific | N/A | HIGH — exact `floor(notional*bps/10000)` identity, the precise counterpart to GL-05's floor |
| N/A | _prop_buyShares | Specific | N/A | HIGH — asserts R1/R2/R3/F-5 together on every buy |
| N/A | _prop_sellShares | Specific | N/A | HIGH — asserts R1/R3/F-6 together on every sell |
| N/A | _prop_mint | Specific | N/A | HIGH — B1/B1a/B6/S5 bundled per mint |
| N/A | _prop_mintWithoutDelivery | Specific | N/A | HIGH — B1a negative-path check |
| N/A | _prop_redeem | Specific | N/A | HIGH |
| N/A | _prop_burnKeepsBackingRatio | Specific | N/A | MEDIUM — 1e6-share tolerance stacked on the token-level floor; loosens the "never lowers" check by that margin |
| N/A | _prop_redeemInKind | Specific | N/A | HIGH — B2 pro-rata delivery check per representation |
| N/A | _prop_redeemInKindSkipping | Specific | N/A | MEDIUM — mostly delegates to `_prop_burnKeepsBackingRatio`; does not independently verify the skipped-token forfeiture amount |
| N/A | _prop_migrate | Specific | N/A | HIGH — B3 monotonicity bundle |
| N/A | _prop_transferKeepsBacking | Specific | N/A | HIGH |
| N/A | _prop_createMandate | Specific | N/A | HIGH |
| N/A | _prop_agentBuy | Specific | N/A | HIGH — A1/A2/A3/A5/F-3 bundled |
| N/A | _prop_agentMint | Specific | N/A | HIGH — A1/A2/A3/A5/B1 bundled |
| N/A | _prop_revoked | Specific | N/A | HIGH |
| N/A | _prop_ratioStepBounded | Specific | N/A | LOW — function body is a no-op stub (`token;`), asserts nothing |
| N/A | _prop_keeperStepAgainstLast | Specific | N/A | HIGH — exact step-bound check against the immediately prior value |

`PROPERTIES.md` cross-reference: 47/54 planned properties `[x]` implemented, 7 `[-]` skipped (GL-10, GL-28, GL-33, GL-34, GL-35, SP-09, SP-11) — all with documented reasons in `Properties.sol` inline comments and `fizz_data/property-plan.md`.

## Open TODOs
- `test/fizz/Properties.sol:204` — GL-10 (`property_vaultTokenLedgerBalances`) skipped: EXPLORATORY per-token cash-flow ledger across mint/redeem/migrate/donation flows has no on-chain ledger to check against; needs a dedicated per-token inflow/outflow ghost.
- `test/fizz/Properties.sol:506` — GL-33/GL-34 (`redeemInKindSkippingAlwaysWorks`, `sellNeverBlockedByBuyGates`) skipped: asserting "never reverts under adversity" needs either a snapshot/revertTo cheat (not exposed by this suite's IHevm) or wrapping the real handler call in try/catch under adversarial pre-state, which changes handler control flow.
- `test/fizz/Properties.sol:509` — GL-35 (`redeemInKindNeverBlockedByOtherActors`) skipped for the same reason as GL-33/34.
- `test/fizz/Properties.sol:826` — SP-09 (`_prop_legSpentZeroImpliesNoReceive`) skipped: requires a new `MockSwapTarget.Mode.REFUND_THEN_DELIVER`, a mock-contract change outside this pass's scope.
- `test/fizz/Properties.sol:840` — SP-11 (`_prop_issuerCapCannotCreepViaRounding`) skipped: needs a cross-call ghost tracking each platform's true (unrounded) share of a constituent across a run.
- `_prop_ratioStepBounded` (`test/fizz/Properties.sol:739-742`) is a dead stub (`function _prop_ratioStepBounded(address token) internal { token; }`) — the real check lives in `_prop_keeperStepAgainstLast` and `property_ratioNeverCompoundsPastStepWithinWindow`; the stub should either be removed or wired to assert something, since as written it is a LOW-confidence no-op.
- GL-28 (`property_ratioAnchorRolloverCorrect`) is written up in `fizz_data/property-plan.md` but marked infeasible: `StockRegistry._ratioAnchor` is private with no getter.

## Next Steps
1. **Remove or wire the dead `_prop_ratioStepBounded` stub** (`test/fizz/Properties.sol:739-742`) — it currently asserts nothing; either delete it (its job is done by `_prop_keeperStepAgainstLast`/GL-19) or give it a real assertion so it isn't misleading in a future audit of the suite.
2. **Strengthen GL-04's donation coverage** by adding donation paths for representations/basket units to the mandate (or documenting explicitly why none is needed), since the property is currently exact for USDT only by construction.
3. **Strengthen GL-09/GL-20/GL-26/GL-27** by wiring `createBasket`/`addRepresentation`/`setUnderlying` into a mid-run handler (even a low-frequency one) so these MEDIUM-confidence properties get a chance to catch a real regression instead of only re-verifying setup state every call.
4. **Close SP-09 and SP-11**: add `MockSwapTarget.Mode.REFUND_THEN_DELIVER` for SP-09 and a per-platform true-share ghost for SP-11 — both were flagged HIGH priority in `fizz_data/property-plan.md` and are the two highest-value remaining gaps.
5. **Consider a try/catch restructuring** for GL-33/GL-34/GL-35 (the "always works under adversity" properties) since they encode B2 and S2, the two invariants the project treats as escape hatches — currently they're asserted only via targeted Foundry unit tests, not the stateful campaign.
6. **No contract-side follow-up is required** for the one real bug found (`BasketVault` backing rounding) — it's fixed and regression-tested (`test_repro_burnKeepsBackingExactly`).
7. **Recommended campaign duration for production validation**: the reported run (4m58s, 270k calls, corpus 451) is a validation-grade smoke run. For pre-audit/production confidence, run Medusa for 4–8 hours (or `testLimit` in the low millions) with the same config, plus a parallel Echidna run per the manual commands below to cross-validate with a different exploration strategy before treating the suite as audit-complete.

## Manual Campaign Commands
- `medusa fuzz` (run from `contracts/`)
- `echidna . --contract FuzzTester --config echidna.yaml`

Note: Slither must stay disabled (`useSlither: false`) for this project — it hangs on this codebase.
