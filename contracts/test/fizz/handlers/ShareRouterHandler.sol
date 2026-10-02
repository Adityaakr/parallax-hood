// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with ShareRouter. Legs are built from live state rather than fuzzed raw:
///         a fuzzer cannot produce meaningful swap calldata, but it can pick the amount, the representation,
///         the recipient and the *shape* of the legs (single, split, misdirected, wrong underlying).
abstract contract ShareRouterHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    /// @dev Buy with a sensible budget and a minShares that fair execution satisfies (5 % below fair).
    function shareRouter_buyShares_clamped(uint256 usdtIn, uint8 repSeed, uint8 shape, address recipient) public {
        uint256 bal = usdt.balanceOf(actor);
        if (bal < 1e18) return;
        usdtIn = clampBetween(usdtIn, 1e18, bal < 50_000e18 ? bal : 50_000e18);
        address rep = reps[repSeed % reps.length];
        uint256 fair = _fairSharesForUsdt(rep, _notional(usdtIn));
        shareRouter_buyShares(usdtIn, fair * 95 / 100, repSeed, shape % 2, toActor(recipient));
    }

    /// @dev Dust budgets: the fee rounds to zero and share math truncates.
    function shareRouter_buyShares_dust(uint256 usdtIn, uint8 repSeed) public {
        usdtIn = clampBetween(usdtIn, 1, 1e12);
        shareRouter_buyShares(usdtIn, 0, repSeed, 0, actor);
    }

    /// @dev The whole USDT balance in one buy.
    function shareRouter_buyShares_full(uint8 repSeed) public {
        uint256 bal = usdt.balanceOf(actor);
        if (bal == 0) return;
        shareRouter_buyShares(bal, 0, repSeed, 0, actor);
    }

    /// @dev Sell part of a held representation for USDT, minUsdtOut 5 % below fair net of the protocol fee.
    function shareRouter_sellShares_clamped(uint256 tokenAmount, uint8 repSeed, bool partialLeg, address recipient) public {
        address rep = reps[repSeed % reps.length];
        uint256 bal = IERC20(rep).balanceOf(actor);
        if (bal == 0) return;
        tokenAmount = clampBetween(tokenAmount, 1, bal);
        uint256 legAmount = partialLeg ? tokenAmount / 2 : tokenAmount;
        if (legAmount == 0) return;
        uint256 fair = venue.quote(rep, address(usdt), legAmount);
        (uint16 feeBps,) = registry.fee();
        uint256 minOut = (fair - fair * feeBps / BPS) * 95 / 100;
        shareRouter_sellShares(tokenAmount, minOut, repSeed, partialLeg, toActor(recipient));
    }

    function shareRouter_sellShares_full(uint8 repSeed) public {
        address rep = reps[repSeed % reps.length];
        uint256 bal = IERC20(rep).balanceOf(actor);
        if (bal == 0) return;
        shareRouter_sellShares(bal, 0, repSeed, false, actor);
    }

    /// @dev Somebody sends tokens straight to the router; the next caller must not receive them.
    function shareRouter_donateERC20(uint256 amount, uint8 tokenSeed) public {
        address token = tokenSeed % 4 == 3 ? address(usdt) : reps[tokenSeed % reps.length];
        uint256 bal = IERC20(token).balanceOf(actor);
        if (bal == 0) return;
        amount = clampBetween(amount, 1, bal);
        vm.prank(actor);
        IERC20(token).transfer(address(router), amount);
        ghosts.routerDonated[token] += amount;
    }

    /// @notice SP-04: a buyShares->sellShares round trip on the same representation/actor must never return
    ///         more USDT than spent, fees included.
    function shareRouter_buyThenSell(uint256 usdtIn, uint8 repSeed) public {
        uint256 bal = usdt.balanceOf(actor);
        if (bal < 1e18) return;
        usdtIn = clampBetween(usdtIn, 1e18, bal < 20_000e18 ? bal : 20_000e18);
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        uint256 notional = _notional(usdtIn);
        LegExecutor.Leg[] memory buyLegs = _legs1(_leg(address(usdt), rep, notional, address(router)));

        uint256 usdtBefore = usdt.balanceOf(actor);
        uint256 repBefore = IERC20(rep).balanceOf(actor);
        vm.startPrank(actor);
        try router.buyShares(
            uid, usdtIn, 0, buyLegs, actor, keccak256(abi.encode("SP04b", usdtIn, block.timestamp, actor))
        ) returns (uint256) {
            uint256 tokenGot = IERC20(rep).balanceOf(actor) - repBefore;
            if (tokenGot > 0) {
                LegExecutor.Leg[] memory sellLegs = _legs1(_leg(rep, address(usdt), tokenGot, address(router)));
                try router.sellShares(
                    uid, rep, tokenGot, 0, sellLegs, actor, keccak256(abi.encode("SP04s", tokenGot, block.timestamp, actor))
                ) returns (uint256) {
                    _prop_buySellSharesRoundTrip(usdtBefore);
                } catch {}
            }
        } catch {}
        vm.stopPrank();
    }

    /// @notice SP-10: splitting a notional into dust-sized buys cannot pay a strictly lower total protocol fee
    ///         than one call of the same aggregate notional would.
    function shareRouter_buyShares_dustBatch(uint256 usdtEach, uint8 repSeed, uint8 count) public {
        // small enough for per-call fee truncation to bite (bps of a few hundred), large enough that the venue
        // leg still delivers a nonzero token amount (LegNothingReceived guards zero-output legs).
        usdtEach = clampBetween(usdtEach, 300, 5_000);
        count = uint8(clampBetween(count, 3, 10));
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        (uint16 feeBps, address feeTo) = registry.fee();
        if (feeBps == 0 || feeTo == actor) return; // the recipient may have been re-pointed by the SP-16 handler

        uint256 feeRecipientBefore = usdt.balanceOf(feeTo);
        uint256 aggregateNotional;
        for (uint256 i = 0; i < count; i++) {
            if (usdt.balanceOf(actor) < usdtEach) break;
            uint256 notional = _notional(usdtEach);
            LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), rep, notional, address(router)));
            vm.prank(actor);
            try router.buyShares(uid, usdtEach, 0, legs, actor, keccak256(abi.encode("SP10", i, block.timestamp, actor)))
                returns (uint256)
            {
                aggregateNotional += notional;
            } catch {}
        }
        uint256 splitFee = usdt.balanceOf(feeTo) - feeRecipientBefore;
        _prop_feeNotReducedBySplitting(splitFee, aggregateNotional, feeBps, count);
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    /// @param shape 0 single leg to the router · 1 split across both NVDA reps · 2 leg pays the actor directly
    ///        (misdirected, must revert LegNothingReceived) · 3 leg buys a rep of another underlying (must revert)
    function shareRouter_buyShares(uint256 usdtIn, uint256 minShares, uint8 repSeed, uint8 shape, address recipient)
        public
        asActor
    {
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        LegExecutor.Leg[] memory legs;
        shape = shape % 4;
        uint256 notional = _notional(usdtIn); // the protocol fee is paid from what the legs leave unspent
        if (shape == 1 && uid == NVDA) {
            legs = new LegExecutor.Leg[](2);
            legs[0] = _leg(address(usdt), address(nvdaB), notional / 2, address(router));
            legs[1] = _leg(address(usdt), address(nvdaOn), notional - notional / 2, address(router));
        } else if (shape == 2) {
            legs = _legs1(_leg(address(usdt), rep, notional, actor));
        } else if (shape == 3) {
            address other = uid == NVDA ? address(aaplB) : address(nvdaB);
            legs = _legs1(_leg(address(usdt), other, notional, address(router)));
        } else {
            legs = _legs1(_leg(address(usdt), rep, notional, address(router)));
        }

        snapshotBefore();
        uint256 usdtBefore = usdt.balanceOf(actor);
        uint256 sharesBefore = _sharesHeld(rep, recipient);
        uint256 sharesOut = router.buyShares(uid, usdtIn, minShares, legs, recipient, keccak256(abi.encode(usdtIn, repSeed)));
        snapshotAfter();
        _recordFeePaid();
        // what the caller paid = notional spent by the legs + fee
        _prop_feeExact((usdtBefore - usdt.balanceOf(actor)) - (stateAfter.feeRecipientUsdt - stateBefore.feeRecipientUsdt));
        _prop_buyShares(usdtIn, minShares, sharesOut, usdtBefore, sharesBefore, rep, recipient, shape);
    }

    function shareRouter_sellShares(uint256 tokenAmount, uint256 minUsdtOut, uint8 repSeed, bool partialLeg, address recipient)
        public
        asActor
    {
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        uint256 legAmount = partialLeg ? tokenAmount / 2 : tokenAmount;
        LegExecutor.Leg[] memory legs = _legs1(_leg(rep, address(usdt), legAmount, address(router)));

        snapshotBefore();
        uint256 repBefore = IERC20(rep).balanceOf(actor);
        uint256 usdtBefore = usdt.balanceOf(recipient);
        uint256 usdtOut = router.sellShares(uid, rep, tokenAmount, minUsdtOut, legs, recipient, keccak256(abi.encode(tokenAmount, repSeed)));
        snapshotAfter();
        _recordFeePaid();
        _prop_feeExact(usdtOut + (stateAfter.feeRecipientUsdt - stateBefore.feeRecipientUsdt)); // gross proceeds
        _prop_sellShares(tokenAmount, legAmount, minUsdtOut, usdtOut, repBefore, usdtBefore, rep, recipient);
    }

    // ――――――――――――――――――――――――― Helpers ――――――――――――――――――――――――――

    /// @dev Shares `usdtIn` buys of `rep` at the venue's current price (before venue fee).
    function _fairSharesForUsdt(address rep, uint256 usdtIn) internal view returns (uint256) {
        uint256 tokens = venue.quote(address(usdt), rep, usdtIn);
        return tokens == 0 ? 0 : registry.sharesForTokens(rep, tokens);
    }
}
