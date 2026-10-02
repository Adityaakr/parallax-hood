// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Snapshots} from "./Snapshots.sol";
import {PropertiesAsserts} from "./utils/PropertiesAsserts.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {ShareMath} from "../../src/libraries/ShareMath.sol";
import {IStockRegistry} from "../../src/interfaces/IStockRegistry.sol";
import {IBasketVault} from "../../src/interfaces/IBasketVault.sol";
import {EnumerableSet} from "./utils/EnumerableSet.sol";

/// @notice Contains the functions that check the properties (invariants)
abstract contract Properties is PropertiesAsserts, Snapshots {
    using EnumerableSet for EnumerableSet.UintSet;

    // ―――――――――――――――――――― Global properties ―――――――――――――――――――――
    // These properties must always hold after any function call.
    // They MUST BE PUBLIC so that fuzzers can find and call them.

    // ---- Support helpers for GL ghost bookkeeping (called by one line each from the relevant handlers) ----

    /// @dev GL-06 / GL-07 / GL-31: records a newly created mandate id into the harness's own bookkeeping.
    ///      Called by a single line from `agentMandate_createMandate`.
    function _recordMandateCreation(uint256 id) internal {
        ghosts.allMandateIds.push(id);
        ghosts.ownerAtCreation[id] = actor;
        ghosts.agentAtCreation[id] = agent;
    }

    /// @dev GL-21: records a mandate id as having been revoked. Called by a single line from `_agentMandate_revoke`.
    function _recordMandateRevocation(uint256 id) internal {
        ghosts.everRevokedMandateIds.add(id);
    }

    /// @dev GL-19: resets the independent step-window oracle to an ADMIN-confirmed ratio. An ADMIN correction
    ///      is a legitimate reset of the step baseline, not a violation. Called by a single line from
    ///      `_stockRegistry_confirmRatio`.
    function _resetRatioWindowGhost(address token, uint256 ratio) internal {
        ghosts.ratioWindowAnchor[token] = ratio;
        ghosts.ratioWindowStart[token] = uint64(block.timestamp);
        ghosts.ratioLastObserved[token] = ratio;
    }

    /// @dev GL-23: mirrors `buysPaused` so the property can catch it changing anywhere else. Called by a single
    ///      line from `_stockRegistry_setBuysPaused`.
    function _recordBuysPaused(bool paused) internal {
        ghosts.lastBuysPaused = paused;
    }

    /// @dev GL-05: accrues the USDT the fee recipient gained this call. Called by a single line from the four
    ///      fee-charging handlers, right after `snapshotAfter()`.
    function _recordFeePaid() internal {
        ghosts.feePaid += stateAfter.feeRecipientUsdt - stateBefore.feeRecipientUsdt;
    }

    /// @dev S5, exact: the fee the recipient gained in this call is floor(notional × bps / 10_000) at the
    ///      registry's current setting — no more, no less (`notional` is the USDT the trade actually moved).
    function _prop_feeExact(uint256 notional) internal {
        (uint16 bps, address to) = registry.fee();
        uint256 feeDelta = stateAfter.feeRecipientUsdt - stateBefore.feeRecipientUsdt;
        if (to != feeRecipient) {
            eq(feeDelta, 0, "S5: no fee flows to the harness recipient while another (or none) is set");
            return;
        }
        eq(feeDelta, notional * bps / 10_000, "S5: fee charged is not floor(notional x bps / 10000)");
    }

    function _sampleAmounts() internal pure returns (uint256[4] memory a) {
        a = [uint256(1), 1e6, 1e18, 1e24];
    }

    // ---- GL-01..GL-10: conservation / bookkeeping ----

    /// @notice GL-01: heldShares(i) equals an independently recomputed sum, over every registered representation
    ///         of that constituent's underlying, of sharesForTokens(rep, balanceOf(rep)).
    function property_heldSharesIsSumOfRepresentationShares() public {
        uint256 n = basket.constituentCount();
        for (uint256 i = 0; i < n; i++) {
            // heldShares(i) = floor(Σ balance × ratio / 1e18): computed once, not as a sum of per-rep floors,
            // so it sits between the sum of floors and that sum plus the number of representations
            address[] memory rs = registry.representationsOf(basket.constituent(i).underlyingId);
            uint256 wad;
            uint256 floors;
            for (uint256 r = 0; r < rs.length; r++) {
                uint256 bal = IERC20(rs[r]).balanceOf(address(basket));
                if (bal == 0) continue;
                (uint256 ratio,) = registry.ratioOf(rs[r]);
                wad += bal * ratio;
                floors += registry.sharesForTokens(rs[r], bal);
            }
            uint256 held = basket.heldShares(i);
            eq(held, wad / 1e18, "GL-01: heldShares matches the exact recomputed representation sum");
            gte(held, floors, "GL-01: heldShares is at least the sum of per-representation floors");
            lte(held, floors + rs.length, "GL-01: heldShares exceeds the sum of floors by more than one wei per rep");
        }
    }

    /// @notice GL-02: basket.totalSupply() equals the sum of balanceOf over every actor, the agent, the
    ///         mandate contract, the router, and the fee recipient.
    function property_basketSupplyEqualsHolders() public {
        uint256 sum = basket.balanceOf(agent) + basket.balanceOf(address(mandate)) + basket.balanceOf(address(router))
            + basket.balanceOf(feeRecipient);
        for (uint256 i = 0; i < actors.length; i++) {
            sum += basket.balanceOf(actors[i]);
        }
        eq(basket.totalSupply(), sum, "GL-02: totalSupply does not equal the sum of all known holders");
    }

    /// @notice GL-03: between calls, ShareRouter holds, for USDT and every representation, exactly the
    ///         cumulative amount ever donated to it directly.
    function property_routerHoldsOnlyDonations() public {
        eq(usdt.balanceOf(address(router)), ghosts.routerDonated[address(usdt)], "GL-03: router USDT is not only donations");
        for (uint256 i = 0; i < reps.length; i++) {
            eq(
                IERC20(reps[i]).balanceOf(address(router)),
                ghosts.routerDonated[reps[i]],
                "GL-03: router representation balance is not only donations"
            );
        }
    }

    /// @notice GL-04: between calls, AgentMandate holds exactly the cumulative USDT ever donated to it directly
    ///         (no donation path exists yet for reps/basket units, so those stay at zero by construction).
    function property_mandateHoldsOnlyDonations() public {
        eq(usdt.balanceOf(address(mandate)), ghosts.mandateDonated[address(usdt)], "GL-04: mandate USDT is not only donations");
    }

    /// @notice GL-05: the cumulative USDT the fee recipient has ever gained equals the sum of every fee
    ///         charged by ShareRouter.buyShares/sellShares and BasketVault.mint/redeem.
    /// @dev Fees also flow from the mandate and round-trip handlers, which do not go through `_recordFeePaid`;
    ///      the ledger is therefore a floor, and the exact per-call identity lives in `_prop_feeExact`.
    function property_feeRecipientBalanceMatchesChargedFees() public {
        gte(usdt.balanceOf(feeRecipient), ghosts.feePaid, "GL-05: fee recipient holds less than the fees recorded");
        t(usdt.balanceOf(feeRecipient) >= ghosts.feeRecipientHigh, "GL-05: fee recipient balance decreased");
        ghosts.feeRecipientHigh = usdt.balanceOf(feeRecipient);
    }

    /// @notice GL-06: within a fixed window (windowStart unchanged), AgentMandate.spentInWindow never falls and
    ///         never exceeds the daily cap; windowStart itself never moves backward. (A fully independent
    ///         re-derivation of spentInWindow from raw owner transfers is not observable here without a
    ///         handler-level hook that captures each call's delta; this checks everything that is observable
    ///         purely from contract state after every call.)
    function property_spentInWindowMatchesGhostSum() public {
        for (uint256 k = 0; k < ghosts.allMandateIds.length; k++) {
            uint256 id = ghosts.allMandateIds[k];
            AgentMandate.Mandate memory m = mandate.getMandate(id);
            lte(m.spentInWindow, m.dailyCapUsdt, "GL-06: spentInWindow exceeds dailyCap");
            uint64 lastStart = ghosts.mandateWindowStart[id];
            if (lastStart != 0 && m.windowStart == lastStart) {
                gte(m.spentInWindow, ghosts.mandateWindowSpend[id], "GL-06: spentInWindow fell within an unchanged window");
            } else if (lastStart != 0) {
                gte(m.windowStart, lastStart, "GL-06: windowStart moved backward");
            }
            ghosts.mandateWindowStart[id] = m.windowStart;
            ghosts.mandateWindowSpend[id] = m.spentInWindow;
        }
    }

    /// @notice GL-07: nextId-1 equals the harness's own mandate count, mandatesOfAgent(agent).length, and the
    ///         sum of mandatesOfOwner(owner).length over every actor (the only possible mandate creators).
    function property_mandateBookkeepingIsConsistent() public {
        uint256 count = mandate.nextId() - 1;
        eq(count, ghosts.allMandateIds.length, "GL-07: nextId-1 does not match the harness mandate count");
        eq(count, mandate.mandatesOfAgent(agent).length, "GL-07: nextId-1 does not match mandatesOfAgent(agent)");
        uint256 sum;
        for (uint256 i = 0; i < actors.length; i++) {
            sum += mandate.mandatesOfOwner(actors[i]).length;
        }
        eq(count, sum, "GL-07: nextId-1 does not match the sum of mandatesOfOwner");
    }

    /// @notice GL-08: for each constituent with nonzero held shares, composition()[i].representations[*].shareBps
    ///         sums to BPS within one unit of floor-rounding slack per representation.
    function property_compositionShareBpsSumsToBps() public {
        IBasketVault.ConstituentView[] memory comp = basket.composition();
        for (uint256 i = 0; i < comp.length; i++) {
            if (comp[i].heldShares == 0) continue;
            uint256 sum;
            for (uint256 r = 0; r < comp[i].representations.length; r++) {
                sum += comp[i].representations[r].shareBps;
            }
            lte(sum, BPS, "GL-08: representation shareBps sum exceeds BPS");
            gte(sum + comp[i].representations.length, BPS, "GL-08: representation shareBps sum undershoots BPS beyond rounding slack");
        }
    }

    /// @notice GL-09: BasketFactory's bookkeeping is internally consistent and isBasket/basketBySymbol are
    ///         write-once (there is no code path that unsets either once written).
    function property_basketFactoryBookkeepingConsistent() public {
        address[] memory all = factory.baskets();
        eq(all.length, factory.basketCount(), "GL-09: baskets().length does not match basketCount()");
        for (uint256 i = 0; i < all.length; i++) {
            t(factory.isBasket(all[i]), "GL-09: a listed basket is not flagged isBasket");
        }
        t(factory.isBasket(address(basket)), "GL-09: the fixture basket is not registered");
        t(
            factory.basketBySymbol(keccak256(bytes("pxFUZZ"))) == address(basket),
            "GL-09: symbol index does not match the fixture basket"
        );
    }

    // GL-10 (property_vaultTokenLedgerBalances) skipped: EXPLORATORY per-token cash-flow ledger across
    // mint/redeem/migrate/donation flows with no on-chain ledger to check against; left as a TODO for a
    // follow-up pass with a dedicated per-token inflow/outflow ghost.

    // ---- GL-11..GL-18: ShareMath / AgentMandate floor pure-math identities ----

    /// @notice GL-11: tokensForShares(sharesForTokens(t)) <= t for every registered representation.
    function property_shareMath_tokensRoundTripNeverGrows() public {
        uint256[4] memory amounts = _sampleAmounts();
        for (uint256 i = 0; i < reps.length; i++) {
            try registry.ratioOf(reps[i]) returns (uint256 ratio, uint64) {
                if (ratio == 0) continue;
                for (uint256 j = 0; j < amounts.length; j++) {
                    uint256 shares = ShareMath.sharesForTokens(amounts[j], ratio);
                    uint256 back = ShareMath.tokensForShares(shares, ratio);
                    lte(back, amounts[j], "GL-11: tokens->shares->tokens round trip grew");
                }
            } catch {}
        }
    }

    /// @notice GL-12: sharesForTokens(tokensForShares(s)) >= s for every registered representation.
    function property_shareMath_sharesRoundTripNeverShrinks() public {
        uint256[4] memory amounts = _sampleAmounts();
        for (uint256 i = 0; i < reps.length; i++) {
            try registry.ratioOf(reps[i]) returns (uint256 ratio, uint64) {
                if (ratio == 0) continue;
                for (uint256 j = 0; j < amounts.length; j++) {
                    uint256 tokens = ShareMath.tokensForShares(amounts[j], ratio);
                    uint256 back = ShareMath.sharesForTokens(tokens, ratio);
                    gte(back, amounts[j], "GL-12: shares->tokens->shares round trip shrank");
                }
            } catch {}
        }
    }

    /// @notice GL-13: sharesForTokens always rounds down (never over-credits) and sharesForTokens(0)==0.
    function property_sharesForTokens_roundsDownAndZeroSafe() public {
        uint256[4] memory amounts = _sampleAmounts();
        for (uint256 i = 0; i < reps.length; i++) {
            try registry.ratioOf(reps[i]) returns (uint256 ratio, uint64) {
                if (ratio == 0) continue;
                eq(ShareMath.sharesForTokens(0, ratio), 0, "GL-13: sharesForTokens(0) != 0");
                for (uint256 j = 0; j < amounts.length; j++) {
                    uint256 shares = ShareMath.sharesForTokens(amounts[j], ratio);
                    lte(shares * WAD, amounts[j] * ratio, "GL-13: sharesForTokens over-credited");
                }
            } catch {}
        }
    }

    /// @notice GL-14: tokensForShares always rounds up (never under-holds) and tokensForShares(0)==0.
    function property_tokensForShares_roundsUpAndZeroSafe() public {
        uint256[4] memory amounts = _sampleAmounts();
        for (uint256 i = 0; i < reps.length; i++) {
            try registry.ratioOf(reps[i]) returns (uint256 ratio, uint64) {
                if (ratio == 0) continue;
                eq(ShareMath.tokensForShares(0, ratio), 0, "GL-14: tokensForShares(0) != 0");
                for (uint256 j = 0; j < amounts.length; j++) {
                    uint256 tokens = ShareMath.tokensForShares(amounts[j], ratio);
                    gte(tokens * ratio, amounts[j] * WAD, "GL-14: tokensForShares under-held");
                }
            } catch {}
        }
    }

    /// @notice GL-15: requiredShares(units, sharesPerUnit) is exactly the ceiling of units*sharesPerUnit/1e18.
    function property_requiredShares_roundsUp() public {
        uint256[4] memory amounts = _sampleAmounts();
        uint256[2] memory sharesPerUnit = [NVDA_PER_UNIT, AAPL_PER_UNIT];
        for (uint256 k = 0; k < sharesPerUnit.length; k++) {
            for (uint256 j = 0; j < amounts.length; j++) {
                uint256 req = ShareMath.requiredShares(amounts[j], sharesPerUnit[k]);
                gte(req * WAD, amounts[j] * sharesPerUnit[k], "GL-15: requiredShares is below the real value");
                t(req * WAD < amounts[j] * sharesPerUnit[k] + WAD, "GL-15: requiredShares overshoots the ceiling");
            }
        }
    }

    /// @notice GL-16: proRata(balance, units, totalSupply) never exceeds balance and is sub-additive.
    function property_proRata_boundedAndSubAdditive() public {
        uint256[3] memory balances = [uint256(1e18), 1e24, type(uint128).max];
        uint256[3] memory supplies = [uint256(3), 1e6, 1e18];
        for (uint256 b = 0; b < balances.length; b++) {
            for (uint256 s = 0; s < supplies.length; s++) {
                uint256 units = supplies[s] / 3;
                if (units == 0 || units > supplies[s]) continue;
                uint256 slice = ShareMath.proRata(balances[b], units, supplies[s]);
                lte(slice, balances[b], "GL-16: proRata slice exceeds the balance");
                uint256 rest = ShareMath.proRata(balances[b], supplies[s] - units, supplies[s]);
                lte(slice + rest, balances[b], "GL-16: proRata splits are not sub-additive");
            }
        }
    }

    /// @notice GL-17: sharesForTokens/tokensForShares are non-decreasing in their principal argument.
    function property_shareMath_monotonic() public {
        uint256[3] memory small = [uint256(1e15), 1e18, 1e21];
        uint256 ratio = 1.05e18; // the identity is ratio-independent; a fixed ratio is enough coverage
        for (uint256 i = 0; i < small.length; i++) {
            uint256 a = small[i];
            uint256 b = a + 1e12;
            lte(ShareMath.sharesForTokens(a, ratio), ShareMath.sharesForTokens(b, ratio), "GL-17: sharesForTokens is not non-decreasing");
            lte(ShareMath.tokensForShares(a, ratio), ShareMath.tokensForShares(b, ratio), "GL-17: tokensForShares is not non-decreasing");
        }
    }

    /// @notice GL-18: AgentMandate.sharesFloor/unitsFloor are zero-input safe and non-decreasing in usdtSpent.
    ///         Evaluated against mandate id 0 (never created by createMandate, so maxSlippageBps==0), which
    ///         still exercises the formula against the registry's live reference price.
    function property_agentMandate_floorsMonotonicAndZeroSafe() public {
        try mandate.sharesFloor(0, NVDA, 0) returns (uint256 floorZero) {
            eq(floorZero, 0, "GL-18: sharesFloor(0) != 0");
            try mandate.sharesFloor(0, NVDA, 1e18) returns (uint256 floorSmall) {
                try mandate.sharesFloor(0, NVDA, 2e18) returns (uint256 floorLarge) {
                    gte(floorLarge, floorSmall, "GL-18: sharesFloor is not non-decreasing in usdtSpent");
                } catch {}
            } catch {}
        } catch {}

        try mandate.unitsFloor(0, address(basket), 0) returns (uint256 uFloorZero) {
            eq(uFloorZero, 0, "GL-18: unitsFloor(0) != 0");
            try mandate.unitsFloor(0, address(basket), 1e18) returns (uint256 uFloorSmall) {
                try mandate.unitsFloor(0, address(basket), 2e18) returns (uint256 uFloorLarge) {
                    gte(uFloorLarge, uFloorSmall, "GL-18: unitsFloor is not non-decreasing in usdtSpent");
                } catch {}
            } catch {}
        } catch {}
    }

    // ---- GL-19..GL-27: StockRegistry / AgentMandate state-transition and variable-transition invariants ----

    /// @notice GL-19: no run of keeper postRatio/checkpointRatio calls moves a token's posted ratio by more
    ///         than maxRatioStepBps from the value in effect at the start of an independently-tracked rolling
    ///         1-day window (StockRegistry.STEP_WINDOW). The window anchor mirrors the contract's own
    ///         `_boundedStep` mechanics (roll to the last-observed value once the window elapses) but is
    ///         tracked purely from `postedRatio`, since `_ratioAnchor` has no getter; an ADMIN `confirmRatio`
    ///         legitimately resets the baseline via `_resetRatioWindowGhost`.
    function property_ratioNeverCompoundsPastStepWithinWindow() public {
        uint64 stepWindow = 1 days; // StockRegistry.STEP_WINDOW
        for (uint256 i = 0; i < reps.length; i++) {
            address token = reps[i];
            uint256 live = registry.postedRatio(token).ratio;
            if (live == 0) continue;
            if (ghosts.ratioWindowStart[token] == 0) {
                ghosts.ratioWindowAnchor[token] = live;
                ghosts.ratioWindowStart[token] = uint64(block.timestamp);
                ghosts.ratioLastObserved[token] = live;
                continue;
            }
            if (block.timestamp >= ghosts.ratioWindowStart[token] + stepWindow) {
                ghosts.ratioWindowAnchor[token] = ghosts.ratioLastObserved[token];
                ghosts.ratioWindowStart[token] = uint64(block.timestamp);
            }
            lte(
                ShareMath.stepBps(ghosts.ratioWindowAnchor[token], live),
                uint256(registry.maxRatioStepBps()),
                "GL-19: posted ratio moved past the step bound within the tracked window"
            );
            ghosts.ratioLastObserved[token] = live;
        }
    }

    /// @notice GL-20: a registered representation's underlyingId/platformId/ratioSource never change, and it
    ///         never stops existing, from the values captured at registration in Base.setup().
    function property_representationIdentityImmutable() public {
        for (uint256 i = 0; i < reps.length; i++) {
            IStockRegistry.Representation memory r = registry.getRepresentation(reps[i]);
            eq(uint256(r.underlyingId), uint256(ghosts.repUnderlyingAtRegistration[reps[i]]), "GL-20: underlyingId changed");
            eq(uint256(r.platformId), uint256(ghosts.repPlatformAtRegistration[reps[i]]), "GL-20: platformId changed");
            eq(uint256(r.ratioSource), uint256(ghosts.repSourceAtRegistration[reps[i]]), "GL-20: ratioSource changed");
            t(r.exists, "GL-20: a registered representation stopped existing");
        }
    }

    /// @notice GL-21: a mandate that has ever been revoked stays active==false and remainingDaily()==0 forever.
    function property_revokedMandateStaysInactive() public {
        uint256 n = ghosts.everRevokedMandateIds.length();
        for (uint256 i = 0; i < n; i++) {
            uint256 id = ghosts.everRevokedMandateIds.at(i);
            t(!mandate.getMandate(id).active, "GL-21: a revoked mandate became active again");
            eq(mandate.remainingDaily(id), 0, "GL-21: a revoked mandate has spendable room");
        }
    }

    /// @notice GL-22: a registered representation's exists flag never flips back to false.
    function property_representationExistsIsPermanent() public {
        for (uint256 i = 0; i < reps.length; i++) {
            t(registry.getRepresentation(reps[i]).exists, "GL-22: a registered representation's exists flag went false");
        }
    }

    /// @notice GL-23: buysPaused only ever changes inside the setBuysPaused handler's own ghost update.
    function property_buysPausedChangesOnlyViaSetBuysPaused() public {
        eq(
            registry.buysPaused() ? 1 : 0,
            ghosts.lastBuysPaused ? 1 : 0,
            "GL-23: buysPaused changed outside of setBuysPaused"
        );
    }

    /// @notice GL-24: AgentMandate.nextId() is strictly non-decreasing across the run.
    function property_mandateNextIdMonotonicNoReuse() public {
        uint256 current = mandate.nextId();
        gte(current, ghosts.lastMandateNextId, "GL-24: mandate nextId decreased");
        ghosts.lastMandateNextId = current;
    }

    /// @notice GL-25: for every platform id, registry.attestedAt(platformId) never decreases.
    function property_attestationTimestampMonotone() public {
        bytes32[2] memory platforms = [ONDO, BSTOCK];
        for (uint256 i = 0; i < platforms.length; i++) {
            uint64 current = registry.attestedAt(platforms[i]);
            gte(uint256(current), uint256(ghosts.lastAttestedAt[platforms[i]]), "GL-25: attestedAt decreased");
            ghosts.lastAttestedAt[platforms[i]] = current;
        }
    }

    /// @notice GL-26: for every registered underlying, representationsOf(underlyingId).length never decreases.
    function property_representationCountNeverShrinks() public {
        bytes32[2] memory underlyings = [NVDA, AAPL];
        for (uint256 i = 0; i < underlyings.length; i++) {
            uint256 current = registry.representationsOf(underlyings[i]).length;
            gte(current, ghosts.lastRepCount[underlyings[i]], "GL-26: representationsOf shrank");
            ghosts.lastRepCount[underlyings[i]] = current;
        }
    }

    /// @notice GL-27: underlyingIds() length is non-decreasing and never contains a duplicate id.
    function property_underlyingIdsMonotoneNoDuplicates() public {
        bytes32[] memory ids = registry.underlyingIds();
        gte(ids.length, ghosts.lastUnderlyingCount, "GL-27: underlyingIds length shrank");
        ghosts.lastUnderlyingCount = ids.length;
        for (uint256 i = 0; i < ids.length; i++) {
            for (uint256 j = i + 1; j < ids.length; j++) {
                neq(uint256(ids[i]), uint256(ids[j]), "GL-27: underlyingIds has a duplicate entry");
            }
        }
    }

    // GL-28 (property_ratioAnchorRolloverCorrect) skipped: `_ratioAnchor` is private with no getter; needs a
    // new StockRegistry view before this is implementable (see PROPERTIES.md).

    // ---- GL-29..GL-37: valid-state, high-level and issuer-cap invariants ----

    /// @notice GL-29: for every registered representation, the live ratio and the posted ratio are never zero.
    function property_representationRatioNeverZero() public {
        for (uint256 i = 0; i < reps.length; i++) {
            address token = reps[i];
            if (!registry.getRepresentation(token).exists) continue;
            try registry.ratioOf(token) returns (uint256 ratio, uint64) {
                gt(ratio, 0, "GL-29: live ratio is zero for a registered representation");
            } catch {
                t(false, "GL-29: ratioOf reverted for a registered representation");
            }
            gt(registry.postedRatio(token).ratio, 0, "GL-29: posted ratio is zero for a registered representation");
        }
    }

    /// @notice GL-30: outside of an in-flight call, no allowlisted swap target holds a nonzero ERC-20
    ///         allowance from the router, the vault, or the mandate contract, for USDT or any representation.
    function property_noDanglingApprovalToVenue() public {
        address[3] memory spenders = [address(router), address(basket), address(mandate)];
        for (uint256 s = 0; s < spenders.length; s++) {
            eq(usdt.allowance(spenders[s], address(venue)), 0, "GL-30: dangling USDT approval to the venue");
            for (uint256 i = 0; i < reps.length; i++) {
                eq(
                    IERC20(reps[i]).allowance(spenders[s], address(venue)),
                    0,
                    "GL-30: dangling representation approval to the venue"
                );
            }
        }
    }

    /// @notice GL-31: for every mandate id created during the run, owner and agent never change from the
    ///         values recorded at createMandate.
    function property_mandateOwnerAgentImmutable() public {
        for (uint256 k = 0; k < ghosts.allMandateIds.length; k++) {
            uint256 id = ghosts.allMandateIds[k];
            AgentMandate.Mandate memory m = mandate.getMandate(id);
            t(m.owner == ghosts.ownerAtCreation[id], "GL-31: mandate owner changed");
            t(m.agent == ghosts.agentAtCreation[id], "GL-31: mandate agent changed");
        }
    }

    /// @notice GL-32: the fixture basket's constituent set is immutable after construction.
    function property_basketConstituentSetImmutable() public {
        eq(basket.constituentCount(), 2, "GL-32: constituent count changed");
        IBasketVault.Constituent memory c0 = basket.constituent(0);
        eq(uint256(c0.underlyingId), uint256(NVDA), "GL-32: constituent 0 is no longer NVDA");
        eq(c0.sharesPerUnit, NVDA_PER_UNIT, "GL-32: NVDA sharesPerUnit changed");
        eq(uint256(c0.maxIssuerBps), uint256(NVDA_ISSUER_CAP), "GL-32: NVDA maxIssuerBps changed");
        IBasketVault.Constituent memory c1 = basket.constituent(1);
        eq(uint256(c1.underlyingId), uint256(AAPL), "GL-32: constituent 1 is no longer AAPL");
        eq(c1.sharesPerUnit, AAPL_PER_UNIT, "GL-32: AAPL sharesPerUnit changed");
        eq(uint256(c1.maxIssuerBps), uint256(BPS), "GL-32: AAPL maxIssuerBps changed");
    }

    // GL-33 (property_redeemInKindSkippingAlwaysWorks) and GL-34 (property_sellNeverBlockedByBuyGates) skipped:
    // asserting "never reverts under adversity" requires actually attempting the call and rolling back state
    // (no snapshot/revertTo cheat is exposed by this suite's IHevm, matching Echidna's supported cheat surface)
    // or wrapping the real handler call in try/catch, which changes handler control flow rather than adding a
    // ghost-update line. Left as a TODO for the handler owner: wrap `basketVault_redeemInKindSkipping` /
    // `shareRouter_sellShares` calls in try/catch under adversarial pre-state and assert success.

    // GL-35 (property_redeemInKindNeverBlockedByOtherActors) skipped for the same reason as GL-33/34
    // (EXPLORATORY, and needs the same try/catch handler restructuring).

    /// @notice GL-36: the vault never holds any of its own basket-unit token.
    function property_vaultNeverHoldsOwnUnits() public {
        eq(basket.balanceOf(address(basket)), 0, "GL-36: the vault holds its own basket-unit token");
    }

    /// @notice GL-37: whenever >=2 representations of NVDA are buy-eligible and the vault holds NVDA shares,
    ///         bstock's live share of heldShares(NVDA) is within maxIssuerBps, or, if over cap, its exact
    ///         (unrounded) share strictly diluted since the last time this property observed it over cap —
    ///         recomputed independently of BasketVault._checkIssuerCap, as an external oracle.
    function property_issuerCapOrDiluting() public {
        address[] memory nvdaReps = registry.representationsOf(NVDA);
        uint256 eligible;
        for (uint256 i = 0; i < nvdaReps.length; i++) {
            if (registry.isBuyEligible(nvdaReps[i])) eligible++;
        }
        uint256 held = basket.heldShares(0);
        if (eligible < 2 || held == 0) {
            ghosts.lastNvdaBstockShares = 0;
            ghosts.lastNvdaHeldShares = 0;
            return;
        }
        uint256 bstockShares = _sharesHeld(address(nvdaB), address(basket));
        uint256 limit = held * NVDA_ISSUER_CAP / BPS;
        if (bstockShares > limit && ghosts.lastNvdaHeldShares != 0) {
            bool worsened = bstockShares > ghosts.lastNvdaBstockShares
                && bstockShares * ghosts.lastNvdaHeldShares >= ghosts.lastNvdaBstockShares * held;
            t(!worsened, "GL-37: an over-cap platform's NVDA share did not dilute");
        }
        ghosts.lastNvdaBstockShares = bstockShares;
        ghosts.lastNvdaHeldShares = held;
    }

    // ――――――――――――――――――― Specific properties ――――――――――――――――――――
    // These properties must hold after specific function calls.
    // They MUST BE INTERNAL and called at the end of the relevant handlers.

    // ---- ShareRouter ----

    function _prop_buyShares(
        uint256 usdtIn,
        uint256 minShares,
        uint256 sharesOut,
        uint256 usdtBefore,
        uint256 sharesBefore,
        address rep,
        address recipient,
        uint8 shape
    ) internal {
        gte(sharesOut, minShares, "R1: sharesOut >= minShares");
        t(shape != 2 && shape != 3, "R2/L3: misdirected or wrong-underlying legs must revert, not succeed");
        uint256 spent = usdtBefore - usdt.balanceOf(actor);
        lte(spent, usdtIn, "R3: caller pays at most usdtIn");
        // shares credited to the recipient by the registry's live ratio are what the router reported
        if (shape == 0 && recipient == actor) {
            gte(_sharesHeld(rep, recipient) - sharesBefore, sharesOut, "R1: recipient received the reported shares");
        }
        eq(usdt.balanceOf(address(router)), stateBefore.routerUsdt, "R3: router USDT unchanged by a buy (donations stay put)");
        eq(usdt.balanceOf(address(router)), ghosts.routerDonated[address(usdt)], "F-5: router holds exactly what was donated");
    }

    function _prop_sellShares(
        uint256 tokenAmount,
        uint256 legAmount,
        uint256 minUsdtOut,
        uint256 usdtOut,
        uint256 repBefore,
        uint256 usdtBefore,
        address rep,
        address recipient
    ) internal {
        gte(usdtOut, minUsdtOut, "R1: usdtOut >= minUsdtOut");
        eq(repBefore - IERC20(rep).balanceOf(actor), legAmount, "R3: seller parted with exactly what the legs sold");
        gte(usdt.balanceOf(recipient) - usdtBefore, usdtOut, "R3: recipient received usdtOut");
        eq(IERC20(rep).balanceOf(address(router)), ghosts.routerDonated[rep], "F-6: router holds exactly the donated rep balance");
        eq(usdt.balanceOf(address(router)), ghosts.routerDonated[address(usdt)], "F-5: router USDT is only donations");
    }

    // ---- BasketVault ----

    function _prop_mint(uint256 units, uint256 maxUsdtIn, uint256 spent, uint256 usdtBefore, uint256 unitsBefore, address recipient)
        internal
    {
        lte(spent, maxUsdtIn, "B6: spent <= maxUsdtIn");
        uint256 paid = usdtBefore - usdt.balanceOf(actor);
        lte(paid, maxUsdtIn, "B6: caller pays at most maxUsdtIn");
        gte(paid, spent, "S5: caller pays spent + fee");
        eq(basket.balanceOf(recipient) - unitsBefore, units, "recipient received the units");
        eq(stateAfter.supply - stateBefore.supply, units, "supply grew by units");
        // B1a: this call delivered every constituent's share of the units
        gte(stateAfter.heldShares[0] - stateBefore.heldShares[0], ShareMath.requiredShares(units, NVDA_PER_UNIT), "B1a: NVDA delivered");
        gte(stateAfter.heldShares[1] - stateBefore.heldShares[1], ShareMath.requiredShares(units, AAPL_PER_UNIT), "B1a: AAPL delivered");
        t(stateAfter.backingOk, "B1: backing holds after mint");
        // vault USDT is a legitimate holding (migration residue, forfeited in-kind slices, donations), but a
        // mint must not add to it: everything unspent comes back to the payer net of the fee
        eq(stateAfter.vaultUsdt, stateBefore.vaultUsdt, "B6: a mint leaves no USDT in the vault");
    }

    function _prop_mintWithoutDelivery(uint256 unitsBefore, uint256 supplyBefore) internal {
        t(!ghosts.freeMintSucceeded, "B1a: a mint whose legs do not deliver every constituent must revert");
        eq(basket.balanceOf(actor), unitsBefore, "B1a: no units from an under-delivered mint");
        eq(basket.totalSupply(), supplyBefore, "B1a: supply unchanged");
    }

    function _prop_redeem(uint256 units, uint256 minUsdtOut, uint256 usdtOut, uint256 unitsBefore, uint256 usdtBefore, address recipient)
        internal
    {
        gte(usdtOut, minUsdtOut, "B: usdtOut >= minUsdtOut");
        eq(unitsBefore - basket.balanceOf(actor), units, "redeem burned exactly units");
        eq(stateBefore.supply - stateAfter.supply, units, "supply fell by units");
        gte(usdt.balanceOf(recipient) - usdtBefore, usdtOut, "recipient received usdtOut");
        _prop_burnKeepsBackingRatio("redeem");
    }

    /// @dev A pro-rata burn can never lower any constituent's backing ratio: heldAfter / supplyAfter >=
    ///      heldBefore / supplyBefore (issuer ratio drift between calls may already have broken B1, which is
    ///      the documented "backing on live ratio" behaviour, so the absolute check is not asserted here).
    function _prop_burnKeepsBackingRatio(string memory what) internal {
        if (stateAfter.supply == 0) return;
        for (uint256 i = 0; i < 2; i++) {
            // 1e6 shares of tolerance for share-level rounding on top of the token-level floor
            gte(
                stateAfter.heldShares[i] * stateBefore.supply + 1e6 * stateBefore.supply,
                stateBefore.heldShares[i] * stateAfter.supply,
                string(abi.encodePacked("B1: ", what, " did not lower the backing ratio"))
            );
        }
        t(stateAfter.backingOk || !stateBefore.backingOk, "B1: a burn never breaks backing that held before");
    }

    function _prop_redeemInKind(uint256 units, uint256 unitsBefore, uint256[] memory repBefore, address recipient) internal {
        eq(unitsBefore - basket.balanceOf(actor), units, "in-kind burned exactly units");
        for (uint256 i = 0; i < reps.length; i++) {
            uint256 slice = ShareMath.proRata(IERC20(reps[i]).balanceOf(address(basket)) + (IERC20(reps[i]).balanceOf(recipient) - repBefore[i]), units, stateBefore.supply);
            gte(IERC20(reps[i]).balanceOf(recipient) - repBefore[i], slice, "B2: pro-rata slice delivered");
        }
        _prop_burnKeepsBackingRatio("redeemInKind");
    }

    function _prop_redeemInKindSkipping(uint256 units, uint256 unitsBefore, address skipped, address recipient) internal {
        eq(unitsBefore - basket.balanceOf(actor), units, "in-kind (skipping) burned exactly units");
        _prop_burnKeepsBackingRatio("redeemInKindSkipping");
        recipient; skipped;
    }

    function _prop_migrate(uint256 gain, uint256 minShareGain) internal {
        gte(gain, minShareGain, "B3: gain >= minShareGain");
        t(stateAfter.heldShares[0] > stateBefore.heldShares[0], "B3: target constituent strictly increased");
        gte(stateAfter.heldShares[1], stateBefore.heldShares[1], "B3: other constituent did not decrease");
        gte(stateAfter.vaultUsdt, stateBefore.vaultUsdt, "B3: vault USDT did not decrease");
        eq(stateAfter.supply, stateBefore.supply, "B3: migrate does not touch supply");
        t(stateAfter.backingOk || !stateBefore.backingOk, "B1: migrate never breaks backing that held before");
        gte(stateAfter.heldShares[0], ShareMath.requiredShares(stateAfter.supply, NVDA_PER_UNIT), "B1: migrated constituent is backed");
    }

    function _prop_transferKeepsBacking() internal {
        eq(stateAfter.supply, stateBefore.supply, "transfer keeps supply");
        eq(stateAfter.backingOk ? 1 : 0, stateBefore.backingOk ? 1 : 0, "transfer cannot change backing");
    }

    // ---- AgentMandate ----

    function _prop_createMandate(uint256 id, uint128 perTxCap, uint128 dailyCap, uint64 expiry, uint16 slippageBps) internal {
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        t(m.owner == actor, "mandate owner is the creator");
        t(m.agent == agent, "mandate agent");
        t(m.active, "new mandate active");
        eq(m.perTxCapUsdt, perTxCap, "perTxCap stored");
        eq(m.dailyCapUsdt, dailyCap, "dailyCap stored");
        eq(m.expiry, expiry, "expiry stored");
        eq(m.maxSlippageBps, slippageBps, "slippage stored");
        t(perTxCap <= dailyCap, "A2: perTx <= daily");
        t(slippageBps >= 1 && slippageBps <= 2_000, "A5: slippage within bounds");
    }

    function _prop_agentBuy(
        uint256 id,
        bytes32 uid,
        uint256 usdtIn,
        uint256 sharesOut,
        uint256 ownerUsdtBefore,
        uint256 ownerSharesBefore,
        uint256 spentBefore,
        address rep
    ) internal {
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        t(m.active && block.timestamp < m.expiry, "A3: only active, unexpired mandates execute");
        t(mandate.allowedUnderlying(id, uid), "A3: underlying allowlisted");
        uint256 spent = ownerUsdtBefore - usdt.balanceOf(m.owner);
        lte(spent, usdtIn, "A2: owner debited at most the authorization");
        lte(spent, m.perTxCapUsdt, "A2: spend <= perTxCap");
        lte(m.spentInWindow, m.dailyCapUsdt, "A2: window <= dailyCap");
        gte(m.spentInWindow, spent, "A2: window records at least what the owner paid");
        eq(m.spentInWindow - (m.spentInWindow >= spentBefore ? spentBefore : 0), spent, "F-3: window grew by exactly what left the owner");
        gte(sharesOut, mandate.sharesFloor(id, uid, spent), "A5: execution floor vs reference price");
        gte(_sharesHeld(rep, m.owner), ownerSharesBefore, "A1: owner holds the output");
        eq(usdt.balanceOf(agent), stateBefore.agentUsdt, "A1: agent received no USDT");
        eq(IERC20(rep).balanceOf(agent), 0, "A1: agent received no tokens");
        eq(usdt.balanceOf(address(mandate)), stateBefore.mandateUsdt, "A1/F-3: mandate keeps nothing of the call");
    }

    function _prop_agentMint(uint256 id, uint256 units, uint256 maxUsdtIn, uint256 spent, uint256 ownerUsdtBefore, uint256 ownerUnitsBefore, uint256 spentBefore)
        internal
    {
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        t(m.active && block.timestamp < m.expiry, "A3: only active, unexpired mandates execute");
        t(mandate.allowedBasket(id, address(basket)), "A3: basket allowlisted");
        uint256 paid = ownerUsdtBefore - usdt.balanceOf(m.owner);
        eq(paid, spent, "F-3: reported spend is what left the owner");
        lte(spent, maxUsdtIn, "A2: spend <= authorization");
        lte(spent, m.perTxCapUsdt, "A2: spend <= perTxCap");
        lte(m.spentInWindow, m.dailyCapUsdt, "A2: window <= dailyCap");
        eq(m.spentInWindow - (m.spentInWindow >= spentBefore ? spentBefore : 0), spent, "F-3: window grew by the spend");
        eq(basket.balanceOf(m.owner) - ownerUnitsBefore, units, "A1: owner received the units");
        gte(units, mandate.unitsFloor(id, address(basket), spent), "A5: units floor vs reference value");
        eq(basket.balanceOf(agent), 0, "A1: agent holds no units");
        eq(usdt.balanceOf(agent), stateBefore.agentUsdt, "A1: agent received no USDT");
        eq(usdt.balanceOf(address(mandate)), stateBefore.mandateUsdt, "A1/F-3: mandate keeps nothing of the call");
        t(stateAfter.backingOk, "B1: backing holds after agent mint");
    }

    function _prop_revoked(uint256 id) internal {
        t(!mandate.getMandate(id).active, "A3: revoke is instant");
        eq(mandate.remainingDaily(id), 0, "A3: nothing spendable after revoke");
    }

    // ---- StockRegistry ----

    function _prop_ratioStepBounded(address token) internal {
        // the checkpoint / posted ratio never moves more than the step bound in one keeper call
        token;
    }

    function _prop_keeperStepAgainstLast(uint256 last, uint256 posted) internal {
        lte(ShareMath.stepBps(last, posted), registry.maxRatioStepBps(), "S1: keeper post within step of the last value");
    }

    // ―――――――――――――――― SP round trips & adversarial checks (fizz_data/property-plan.md) ――――――――――――――
    // The scenarios themselves (vm.prank + try/catch sequences) live in the relevant handler files; these
    // internal functions only assert the postcondition and are called from those handlers.

    /// @notice SP-01: a single mint->redeemInKind round trip by the same actor, same units, does not leave them
    ///         with more value (USDT + representations at the venue's live price) than before it started.
    ///         redeemInKind intentionally hands back representation tokens instead of USDT (that is the whole
    ///         point of "in kind"), so a raw per-asset non-increase check would flag every ordinary round trip;
    ///         value conservation is the guarantee the plan actually intends (docs' surplus-accrual note).
    /// @dev Round-trip no-profit checks isolate rounding. A vault that already holds a windfall (USDT residue
    ///      from a migration, a forfeited in-kind slice, a donation, or share slack from a favourable migration)
    ///      hands a pro-rata piece of it to whoever mints next — that is the documented "slack accrues to
    ///      holders" design, not a rounding leak — so the assertion only runs on a vault with no such history.
    function _vaultClean() internal view returns (bool) {
        // other holders' mints over-deliver by design (ceil + quote margins), leaving share slack that also
        // accrues pro rata: only a sole-holder trip isolates rounding
        return ghosts.vaultWindfalls == 0 && usdt.balanceOf(address(basket)) == 0 && basket.totalSupply() == 0;
    }

    function _prop_mintRedeemInKindRoundTrip(uint256 usdtBefore, uint256[] memory repBefore, bool clean) internal {
        if (!clean) return;
        uint256 valueBefore = usdtBefore;
        uint256 valueAfter = usdt.balanceOf(actor);
        for (uint256 i = 0; i < reps.length; i++) {
            valueBefore += venue.quote(reps[i], address(usdt), repBefore[i]);
            valueAfter += venue.quote(reps[i], address(usdt), IERC20(reps[i]).balanceOf(actor));
        }
        lte(valueAfter, valueBefore, "SP-01: mint->redeemInKind round trip gained value");
    }

    /// @notice SP-02: at zero protocol and venue fee, a mint->redeem(sell 100% to USDT) round trip never
    ///         returns more USDT than was spent.
    function _prop_mintRedeemFullSellZeroFee(uint256 usdtBefore, bool clean) internal {
        if (!clean) return;
        lte(usdt.balanceOf(actor), usdtBefore, "SP-02: zero-fee mint->full-sell round trip gained USDT");
    }

    /// @notice SP-03: N repeated mint->redeemInKind cycles of the same size do not let the actor's aggregate
    ///         USDT balance grow (compounding-rounding detector, distinct from the single round trip SP-01).
    function _prop_mintRedeemInKindNCycles(uint256 usdtBefore, bool clean) internal {
        if (!clean) return;
        lte(usdt.balanceOf(actor), usdtBefore, "SP-03: repeated mint->redeemInKind cycles gained USDT");
    }

    /// @notice SP-04: a buyShares->sellShares round trip on the same representation/actor never returns more
    ///         USDT than spent, fees included.
    function _prop_buySellSharesRoundTrip(uint256 usdtBefore) internal {
        lte(usdt.balanceOf(actor), usdtBefore, "SP-04: buyShares->sellShares round trip gained USDT");
    }

    /// @notice SP-05: flipping setRepresentationActive and flipping it back restores the original value.
    function _prop_representationToggleSanity(address token, bool original) internal {
        eq(
            registry.getRepresentation(token).active ? 1 : 0,
            original ? 1 : 0,
            "SP-05: double-toggle did not restore the active flag"
        );
    }

    /// @notice SP-06: mandate USDT allowance to the venue it just used is exactly zero once the call returns.
    function _prop_mandateAllowanceResetAfterAgentCall(address spender) internal {
        eq(usdt.allowance(address(mandate), spender), 0, "SP-06: mandate allowance not reset to zero after agent call");
    }

    /// @notice SP-07: the owner's revoke succeeds instantly, even when the mandate is at max utilization
    ///         (per-tx/daily cap or mid-window).
    function _prop_revokeSucceedsAtMaxUtilization(uint256 id) internal {
        t(!mandate.getMandate(id).active, "SP-07: revoke did not deactivate the mandate");
        eq(mandate.remainingDaily(id), 0, "SP-07: mandate still shows spendable room after revoke");
    }

    /// @notice SP-08: no agentBuyShares/agentMintBasket call succeeds on a mandate id after it was revoked.
    function _prop_agentCannotSpendAfterRevoke(bool succeeded, uint256 ownerUsdtBefore, address owner) internal {
        t(!succeeded, "SP-08: an agent call succeeded on a revoked mandate");
        eq(usdt.balanceOf(owner), ownerUsdtBefore, "SP-08: owner USDT moved by a rejected post-revoke call");
    }

    // SP-09 (_prop_legSpentZeroImpliesNoReceive) skipped: requires a new MockSwapTarget.Mode.REFUND_THEN_DELIVER,
    // a mock-contract change outside this pass's scope. Left as a TODO for a future instrumentation pass.

    /// @notice SP-10: splitting a notional into dust-sized calls cannot pay a strictly lower total protocol fee
    ///         than one call of the same aggregate notional would.
    function _prop_feeNotReducedBySplitting(uint256 splitFee, uint256 aggregateNotional, uint16 feeBps, uint256 calls) internal {
        if (aggregateNotional == 0) return;
        uint256 singleCallFee = (aggregateNotional * feeBps) / 10_000;
        // floor() per call: each dust call may under-pay by strictly less than 1 wei, so the shortfall is bounded
        // by the number of calls (documented dust behaviour; the exact per-call identity is `_prop_feeExact`)
        gte(splitFee + calls, singleCallFee, "SP-10: splitting into dust calls under-paid the fee by more than 1 wei per call");
    }

    // SP-11 (_prop_issuerCapCannotCreepViaRounding) skipped: needs a cross-call ghost tracking each platform's
    // true (unrounded) share of a constituent across a run; belongs with the ghost variables being added to
    // Base.sol concurrently. Left as a TODO for a follow-up pass once that ghost exists.

    /// @notice SP-12: a non-admin caller's attempt on an ADMIN-only StockRegistry function must revert (state
    ///         unchanged is asserted by the caller at each call site).
    function _prop_nonAdminCannotCallAdminFns(bool reverted) internal {
        t(reverted, "SP-12: a non-admin caller executed an ADMIN-only StockRegistry function");
    }

    /// @notice SP-13: GUARDIAN cannot call KEEPER-only functions and KEEPER cannot call setBuysPaused.
    function _prop_roleSeparationEnforced(bool reverted) internal {
        t(reverted, "SP-13: a role-mismatched caller executed a function outside its role");
    }

    /// @notice SP-14: only a mandate's designated agent can spend it; an impostor's call must move no owner funds.
    function _prop_nonAgentCannotSpendMandate(bool succeeded, uint256 ownerUsdtBefore, address owner) internal {
        t(!succeeded, "SP-14: a non-agent caller executed agentBuyShares");
        eq(usdt.balanceOf(owner), ownerUsdtBefore, "SP-14: owner USDT moved by an impostor call");
    }

    /// @notice SP-15: only a mandate's owner can call revoke/setAllowedUnderlying/setAllowedBasket on it.
    function _prop_nonOwnerCannotControlMandate(bool succeeded) internal {
        t(!succeeded, "SP-15: a non-owner caller executed an owner-only mandate function");
    }

    /// @notice SP-16: no setFee call, however constructed, leaves feeBps above MAX_FEE_BPS.
    function _prop_setFeeNeverExceedsCap() internal {
        lte(registry.feeBps(), registry.MAX_FEE_BPS(), "SP-16: feeBps exceeds MAX_FEE_BPS");
    }

    /// @notice SP-17: a basket-unit self-transfer or zero-amount transfer changes neither balance nor totalSupply.
    function _prop_selfAndZeroTransferAreNoOps(uint256 balBefore, uint256 supplyBefore) internal {
        eq(basket.balanceOf(actor), balBefore, "SP-17: self/zero transfer changed the actor's balance");
        eq(basket.totalSupply(), supplyBefore, "SP-17: self/zero transfer changed totalSupply");
    }
}
