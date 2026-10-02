// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Keeper / guardian / admin pressure on StockRegistry, plus the market environment (venue prices,
///         issuer multipliers, pauses) the registry reads. All secondary tier: one dispatcher each.
abstract contract StockRegistryHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function stockRegistry_secondary(uint8 selector, uint256 arg0, uint256 arg1, uint8 repSeed) public {
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        selector = uint8(selector % 10);
        if (selector == 0) _stockRegistry_checkpointRatio(rep);
        else if (selector == 1) {
            // admin confirms within +-20 % of the live value (a corporate action within reason)
            (uint256 live,) = registry.ratioOf(rep);
            _stockRegistry_confirmRatio(rep, clampBetween(arg0, live * 8 / 10, live * 12 / 10));
        } else if (selector == 2) _stockRegistry_postAttestation(repSeed % 2 == 0 ? ONDO : BSTOCK, uint64(block.timestamp - clampBetween(arg0, 0, 48 hours)));
        else if (selector == 3) _stockRegistry_postMarketState(uid, arg0 % 2 == 0);
        else if (selector == 4) {
            // keeper posts within +-8 % of the last value: some pass, some exceed the 5 % step bound
            uint256 last = registry.postedRatio(address(nvdaOn)).ratio;
            _stockRegistry_postRatio(address(nvdaOn), clampBetween(arg0, last * 92 / 100, last * 108 / 100));
        } else if (selector == 5) {
            (uint256 last,) = registry.referencePrice(uid);
            _stockRegistry_postReferencePrice(uid, clampBetween(arg0, last * 75 / 100, last * 125 / 100));
        } else if (selector == 6) _stockRegistry_setBuysPaused(arg0 % 2 == 0);
        else if (selector == 7) _stockRegistry_setFee(uint16(clampBetween(arg0, 0, 100)), arg1 % 5 == 0 ? address(0) : feeRecipient);
        else if (selector == 8) _stockRegistry_setLimits(uint64(clampBetween(arg0, 1 hours, 30 days)), uint64(clampBetween(arg1, 1 hours, 30 days)), uint16(clampBetween(arg0 >> 8, 100, 2_000)));
        else _stockRegistry_setRepresentationActive(rep, arg0 % 2 == 0);
    }

    /// @dev Market environment: prices move, ERC-8056 multipliers drift, issuers pause/blocklist, venue fees.
    function environment_secondary(uint8 selector, uint256 arg0, uint8 repSeed, address who) public {
        address rep = reps[repSeed % reps.length];
        selector = uint8(selector % 6);
        if (selector == 0) {
            uint256 p = venue.price(rep);
            venue.setPrice(rep, clampBetween(arg0, p * 80 / 100, p * 120 / 100));
        } else if (selector == 1) {
            if (!MockStockToken(rep).erc8056()) return;
            uint256 m = MockStockToken(rep).uiMultiplier();
            MockStockToken(rep).setMultiplier(clampBetween(arg0, m * 99 / 100, m * 101 / 100)); // dividend-scale drift
        } else if (selector == 2) {
            if (!MockStockToken(rep).erc8056()) return;
            MockStockToken(rep).setMultiplier(arg0 % 2 == 0 ? MockStockToken(rep).uiMultiplier() * 10 : MockStockToken(rep).uiMultiplier() / 4); // split
        } else if (selector == 3) MockStockToken(rep).setPaused(arg0 % 2 == 0);
        else if (selector == 4) MockStockToken(rep).setBlocked(toActor(who), arg0 % 2 == 0);
        else venue.setFeeBps(uint16(clampBetween(arg0, 0, 100)));
    }

    /// @dev The keeper's steady-state loop: refresh attestations, market state and reference prices at the
    ///      current time so freshness windows do not silently turn every buy into a revert after time travel.
    function stockRegistry_keeperRefresh() public asKeeper {
        registry.postAttestation(ONDO, uint64(block.timestamp));
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        registry.postMarketState(NVDA, true);
        registry.postMarketState(AAPL, true);
        (uint256 pn,) = registry.referencePrice(NVDA);
        (uint256 pa,) = registry.referencePrice(AAPL);
        registry.postReferencePrice(NVDA, pn);
        registry.postReferencePrice(AAPL, pa);
        uint256 last = registry.postedRatio(address(nvdaOn)).ratio;
        registry.postRatio(address(nvdaOn), last);
    }

    function environment_warp(uint256 secs) public {
        skipTime(clampBetween(secs, 1 minutes, 3 days));
    }

    /// @notice SP-05: flipping setRepresentationActive and flipping it back restores the original value.
    function stockRegistry_toggleActiveSanity(uint8 repSeed) public {
        address rep = reps[repSeed % reps.length];
        bool before = registry.getRepresentation(rep).active;
        vm.prank(admin);
        registry.setRepresentationActive(rep, !before);
        vm.prank(admin);
        registry.setRepresentationActive(rep, before);
        _prop_representationToggleSanity(rep, before);
    }

    /// @notice SP-12: a non-admin caller can never execute an ADMIN-only StockRegistry function, and a reverted
    ///         attempt never mutates the state that function would have changed.
    function stockRegistry_adminFn_wrongCaller(uint8 selector, uint256 callerSeed, uint256 arg0, uint8 repSeed) public {
        address caller = actors[callerSeed % actors.length];
        address rep = reps[repSeed % reps.length];
        selector = uint8(selector % 5);
        bool reverted;
        if (selector == 0) {
            uint16 before = registry.feeBps();
            vm.prank(caller);
            try registry.setFee(uint16(clampBetween(arg0, 0, 100)), feeRecipient) {} catch { reverted = true; }
            eq(registry.feeBps(), before, "SP-12: feeBps changed by a non-admin call");
        } else if (selector == 1) {
            bool before = registry.getRepresentation(rep).active;
            vm.prank(caller);
            try registry.setRepresentationActive(rep, arg0 % 2 == 0) {} catch { reverted = true; }
            eq(
                registry.getRepresentation(rep).active ? 1 : 0,
                before ? 1 : 0,
                "SP-12: representation active flag changed by a non-admin call"
            );
        } else if (selector == 2) {
            bool before = registry.isAllowedTarget(address(venue));
            vm.prank(caller);
            try registry.setAllowedTarget(address(venue), arg0 % 2 == 0) {} catch { reverted = true; }
            eq(
                registry.isAllowedTarget(address(venue)) ? 1 : 0,
                before ? 1 : 0,
                "SP-12: target allowlist changed by a non-admin call"
            );
        } else if (selector == 3) {
            uint16 before = registry.maxRatioStepBps();
            vm.prank(caller);
            try registry.setLimits(36 hours, 12 hours, uint16(clampBetween(arg0, 100, 2_000))) {} catch { reverted = true; }
            eq(registry.maxRatioStepBps(), before, "SP-12: limits changed by a non-admin call");
        } else {
            uint256 before = registry.postedRatio(rep).ratio;
            vm.prank(caller);
            try registry.confirmRatio(rep, clampBetween(arg0, 1, 1e30)) {} catch { reverted = true; }
            eq(registry.postedRatio(rep).ratio, before, "SP-12: posted ratio changed by a non-admin call");
        }
        _prop_nonAdminCannotCallAdminFns(reverted);
    }

    /// @notice SP-13: GUARDIAN cannot call KEEPER-only functions and KEEPER cannot call setBuysPaused.
    function stockRegistry_roleMix_wrongCaller(uint8 selector, uint256 arg0) public {
        selector = uint8(selector % 4);
        bool reverted;
        if (selector == 0) {
            uint256 before = registry.postedRatio(address(nvdaOn)).ratio;
            vm.prank(guardian);
            try registry.postRatio(address(nvdaOn), clampBetween(arg0, 1, 1e30)) {} catch { reverted = true; }
            eq(registry.postedRatio(address(nvdaOn)).ratio, before, "SP-13: guardian posted a ratio");
        } else if (selector == 1) {
            uint64 before = registry.attestedAt(BSTOCK);
            vm.prank(guardian);
            try registry.postAttestation(BSTOCK, uint64(block.timestamp)) {} catch { reverted = true; }
            eq(uint256(registry.attestedAt(BSTOCK)), uint256(before), "SP-13: guardian posted an attestation");
        } else if (selector == 2) {
            bool before = registry.marketState(NVDA).open;
            vm.prank(guardian);
            try registry.postMarketState(NVDA, arg0 % 2 == 0) {} catch { reverted = true; }
            eq(registry.marketState(NVDA).open ? 1 : 0, before ? 1 : 0, "SP-13: guardian posted market state");
        } else {
            bool before = registry.buysPaused();
            vm.prank(keeper);
            try registry.setBuysPaused(arg0 % 2 == 0) {} catch { reverted = true; }
            eq(registry.buysPaused() ? 1 : 0, before ? 1 : 0, "SP-13: keeper paused/unpaused buys");
        }
        _prop_roleSeparationEnforced(reverted);
    }

    /// @notice SP-16: an unclamped setFee call, however constructed (including values above the boundary or
    ///         type(uint16).max), can never leave feeBps above MAX_FEE_BPS.
    function stockRegistry_setFee_unclamped(uint16 feeBps_, address recipient) public asAdmin {
        try registry.setFee(feeBps_, recipient) {} catch {}
        _prop_setFeeNeverExceedsCap();
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function _stockRegistry_checkpointRatio(address token) internal asKeeper {
        registry.checkpointRatio(token);
        _prop_ratioStepBounded(token);
    }

    function _stockRegistry_confirmRatio(address token, uint256 ratio) internal asAdmin {
        registry.confirmRatio(token, ratio);
        _resetRatioWindowGhost(token, ratio);
    }

    function _stockRegistry_postAttestation(bytes32 platformId, uint64 attestedAt_) internal asKeeper {
        registry.postAttestation(platformId, attestedAt_);
    }

    function _stockRegistry_postMarketState(bytes32 underlyingId, bool open) internal asKeeper {
        registry.postMarketState(underlyingId, open);
    }

    function _stockRegistry_postRatio(address token, uint256 ratio) internal asKeeper {
        uint256 last = registry.postedRatio(token).ratio;
        registry.postRatio(token, ratio);
        _prop_ratioStepBounded(token);
        _prop_keeperStepAgainstLast(last, ratio);
    }

    function _stockRegistry_postReferencePrice(bytes32 underlyingId, uint256 priceUsd) internal asKeeper {
        registry.postReferencePrice(underlyingId, priceUsd);
    }

    function _stockRegistry_setBuysPaused(bool paused) internal asGuardian {
        registry.setBuysPaused(paused);
        _recordBuysPaused(paused);
    }

    function _stockRegistry_setFee(uint16 feeBps, address recipient) internal asAdmin {
        registry.setFee(feeBps, recipient);
    }

    function _stockRegistry_setLimits(uint64 maxAttestationAge, uint64 maxRatioAge, uint16 maxRatioStepBps) internal asAdmin {
        registry.setLimits(maxAttestationAge, maxRatioAge, maxRatioStepBps);
    }

    function _stockRegistry_setRepresentationActive(address token, bool active) internal asAdmin {
        registry.setRepresentationActive(token, active);
    }
}
