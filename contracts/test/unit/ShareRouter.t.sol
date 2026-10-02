// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {ShareRouter} from "../../src/ShareRouter.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {IRouteReceipt} from "../../src/interfaces/IRouteReceipt.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

contract ShareRouterTest is BaseTest {
    bytes32 constant QH = keccak256("quote-1");

    function _buy(address who, address rep, uint256 usdtIn, uint256 minShares) internal returns (uint256) {
        vm.startPrank(who);
        usdt.approve(address(router), usdtIn);
        uint256 out = router.buyShares(
            NVDA, usdtIn, minShares, _legs1(_leg(address(usdt), rep, usdtIn, address(router))), who, QH
        );
        vm.stopPrank();
        return out;
    }

    function test_buyShares_singleLeg_bstock() public {
        uint256 before = usdt.balanceOf(alice);
        uint256 shares = _buy(alice, address(nvdaB), 1000e18, 0);
        // fair price: 1000 USDT / (219 * 1.000778) tokens * 1.000778 = 1000/219 shares
        assertApproxEqRel(shares, 1000e18 * WAD / NVDA_PX, 1e12);
        assertEq(usdt.balanceOf(alice), before - 1000e18);
        assertEq(usdt.balanceOf(address(router)), 0);
        assertEq(nvdaB.balanceOf(address(router)), 0);
        assertGt(nvdaB.balanceOf(alice), 0);
        assertEq(registry.sharesForTokens(address(nvdaB), nvdaB.balanceOf(alice)), shares);
    }

    function test_buyShares_splitAcrossRepresentations() public {
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(usdt), address(nvdaB), 600e18, address(router)),
            _leg(address(usdt), address(nvdaOn), 400e18, address(router))
        );
        uint256 shares = router.buyShares(NVDA, 1000e18, 0, legs, alice, QH);
        vm.stopPrank();
        assertApproxEqRel(shares, 1000e18 * WAD / NVDA_PX, 1e12);
        assertGt(nvdaB.balanceOf(alice), 0);
        assertGt(nvdaOn.balanceOf(alice), 0);
    }

    function test_buyShares_emitsReceipt() public {
        vm.startPrank(alice);
        usdt.approve(address(router), 100e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 100e18, address(router)));
        uint256 expectedTokens = venue.quote(address(usdt), address(nvdaB), 100e18);
        vm.expectEmit(true, true, true, true);
        emit IRouteReceipt.RouteReceipt(
            QH,
            alice,
            NVDA,
            address(usdt),
            100e18,
            address(nvdaB),
            expectedTokens,
            expectedTokens * NVDA_B_MULT / WAD,
            NVDA_B_MULT,
            uint64(block.timestamp),
            0
        );
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);
        vm.stopPrank();
    }

    function test_buyShares_refundsUnspent() public {
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);
        // legs only spend 600 of the 1000 pulled
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 600e18, address(router)));
        uint256 before = usdt.balanceOf(alice);
        router.buyShares(NVDA, 1000e18, 0, legs, alice, QH);
        vm.stopPrank();
        assertEq(usdt.balanceOf(alice), before - 600e18);
    }

    function test_buyShares_minSharesEnforced() public {
        uint256 fair = 1000e18 * WAD / NVDA_PX;
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 1000e18, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.InsufficientShares.selector, fair, fair + 1));
        router.buyShares(NVDA, 1000e18, fair + 1, legs, alice, QH);
        vm.stopPrank();
    }

    function test_buyShares_minShares_catchesVenueSkim() public {
        venue.setMode(MockSwapTarget.Mode.SKIM_HALF, "");
        uint256 fair = 1000e18 * WAD / NVDA_PX;
        uint256 minShares = fair * 9_900 / 10_000; // 1 % slippage tolerance
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 1000e18, address(router)));
        uint256 skimmed = venue.quote(address(usdt), address(nvdaB), 1000e18) / 2 * NVDA_B_MULT / WAD;
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.InsufficientShares.selector, skimmed, minShares));
        router.buyShares(NVDA, 1000e18, minShares, legs, alice, QH);
        vm.stopPrank();
    }

    function test_buyShares_rejectsBadLegs() public {
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);

        // target not allowlisted
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 100e18, address(router)));
        legs[0].target = alice;
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.TargetNotAllowed.selector, alice));
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        // tokenIn must be USDT
        legs = _legs1(_leg(address(nvdaOn), address(nvdaB), 100e18, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.LegTokenInMustBeUsdt.selector, address(nvdaOn)));
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        // tokenOut must be buy-eligible
        legs = _legs1(_leg(address(usdt), address(usdt), 100e18, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.NotBuyEligible.selector, address(usdt)));
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        // wrong underlying
        legs = _legs1(_leg(address(usdt), address(aaplB), 100e18, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.WrongUnderlying.selector, address(aaplB), NVDA));
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        // zero amount / zero recipient / no legs
        vm.expectRevert(ShareRouter.ZeroAmount.selector);
        router.buyShares(NVDA, 0, 0, legs, alice, QH);
        vm.expectRevert(ShareRouter.ZeroAddress.selector);
        router.buyShares(NVDA, 100e18, 0, legs, address(0), QH);
        vm.expectRevert(ShareRouter.NoLegs.selector);
        router.buyShares(NVDA, 100e18, 0, new LegExecutor.Leg[](0), alice, QH);
        vm.stopPrank();
    }

    function test_buyShares_staleRepresentationExcluded() public {
        vm.warp(block.timestamp + 13 hours); // nvdaOn keeper ratio stale
        vm.startPrank(alice);
        usdt.approve(address(router), 100e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaOn), 100e18, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.NotBuyEligible.selector, address(nvdaOn)));
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);
        vm.stopPrank();
    }

    function test_buyShares_adversarialVenues() public {
        venue.setKeeper(alice); // alice flips the venue's mode while acting as the buyer
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 100e18, address(router)));

        venue.setMode(MockSwapTarget.Mode.NO_OUTPUT, "");
        vm.expectRevert(LegExecutor.LegNothingReceived.selector);
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        venue.setMode(MockSwapTarget.Mode.TAKE_MORE, "");
        vm.expectRevert(); // approval is exactly maxIn, transferFrom 2x fails inside the venue -> LegCallFailed
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        venue.setMode(MockSwapTarget.Mode.REVERT, "");
        vm.expectRevert();
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);

        // reenter buyShares -> ReentrancyGuard
        bytes memory reenter = abi.encodeCall(ShareRouter.buyShares, (NVDA, 1e18, 0, legs, alice, QH));
        venue.setMode(MockSwapTarget.Mode.REENTER, reenter);
        vm.expectRevert();
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);
        vm.stopPrank();
    }

    function test_leg_overspendDetected() public {
        // venue pulls exactly maxIn but we declare a smaller maxIn in the leg than the calldata amount
        vm.startPrank(alice);
        usdt.approve(address(router), 1000e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), address(nvdaB), 100e18, address(router)));
        legs[0].maxIn = 50e18; // approval is 50, venue tries 100 -> transferFrom fails -> LegCallFailed
        vm.expectRevert();
        router.buyShares(NVDA, 100e18, 0, legs, alice, QH);
        vm.stopPrank();
    }

    // ---- sell ----

    function test_sellShares() public {
        uint256 shares = _buy(alice, address(nvdaB), 1000e18, 0);
        uint256 tokens = nvdaB.balanceOf(alice);
        vm.startPrank(alice);
        nvdaB.approve(address(router), tokens);
        uint256 before = usdt.balanceOf(alice);
        vm.expectEmit(true, true, true, true);
        emit IRouteReceipt.RouteReceipt(
            QH,
            alice,
            NVDA,
            address(nvdaB),
            tokens,
            address(nvdaB),
            tokens,
            shares,
            NVDA_B_MULT,
            uint64(block.timestamp),
            1
        );
        uint256 out = router.sellShares(
            NVDA,
            address(nvdaB),
            tokens,
            990e18,
            _legs1(_leg(address(nvdaB), address(usdt), tokens, address(router))),
            alice,
            QH
        );
        vm.stopPrank();
        assertApproxEqRel(out, 1000e18, 1e12);
        assertEq(usdt.balanceOf(alice), before + out);
        assertEq(nvdaB.balanceOf(alice), 0);
        assertEq(nvdaB.balanceOf(address(router)), 0);
    }

    function test_sellShares_partialLegReturnsLeftover() public {
        _buy(alice, address(nvdaB), 1000e18, 0);
        uint256 tokens = nvdaB.balanceOf(alice);
        vm.startPrank(alice);
        nvdaB.approve(address(router), tokens);
        router.sellShares(
            NVDA,
            address(nvdaB),
            tokens,
            0,
            _legs1(_leg(address(nvdaB), address(usdt), tokens / 2, address(router))),
            alice,
            QH
        );
        vm.stopPrank();
        assertEq(nvdaB.balanceOf(alice), tokens - tokens / 2);
    }

    /// @dev Audit F-5/F-6: refunds are scoped to what the caller deposited; balances that reach the router by
    ///      other means are not swept to the next caller.
    function test_refunds_doNotSweepStrayBalances() public {
        usdt.mint(address(router), 500e18);
        nvdaB.mint(address(router), 7e18);
        uint256 aliceUsdt = usdt.balanceOf(alice);
        _buy(alice, address(nvdaB), 100e18, 0);
        assertEq(usdt.balanceOf(alice), aliceUsdt - 100e18);
        assertEq(usdt.balanceOf(address(router)), 500e18);

        uint256 tokens = nvdaB.balanceOf(alice);
        vm.startPrank(alice);
        nvdaB.approve(address(router), tokens);
        router.sellShares(
            NVDA,
            address(nvdaB),
            tokens,
            0,
            _legs1(_leg(address(nvdaB), address(usdt), tokens / 2, address(router))),
            alice,
            QH
        );
        vm.stopPrank();
        assertEq(nvdaB.balanceOf(alice), tokens - tokens / 2);
        assertEq(nvdaB.balanceOf(address(router)), 7e18);
    }

    function test_sellShares_deprecatedStillSellable() public {
        _buy(alice, address(nvdaB), 1000e18, 0);
        vm.prank(admin);
        registry.setRepresentationActive(address(nvdaB), false);
        vm.warp(block.timestamp + 100 days); // everything stale too
        uint256 tokens = nvdaB.balanceOf(alice);
        vm.startPrank(alice);
        nvdaB.approve(address(router), tokens);
        uint256 out = router.sellShares(
            NVDA,
            address(nvdaB),
            tokens,
            0,
            _legs1(_leg(address(nvdaB), address(usdt), tokens, address(router))),
            alice,
            QH
        );
        vm.stopPrank();
        assertGt(out, 0);
    }

    function test_sellShares_reverts() public {
        _buy(alice, address(nvdaB), 1000e18, 0);
        uint256 tokens = nvdaB.balanceOf(alice);
        vm.startPrank(alice);
        nvdaB.approve(address(router), tokens);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(nvdaB), address(usdt), tokens, address(router)));

        vm.expectRevert(ShareRouter.ZeroAmount.selector);
        router.sellShares(NVDA, address(nvdaB), 0, 0, legs, alice, QH);
        vm.expectRevert(ShareRouter.ZeroAddress.selector);
        router.sellShares(NVDA, address(nvdaB), tokens, 0, legs, address(0), QH);
        vm.expectRevert(ShareRouter.NoLegs.selector);
        router.sellShares(NVDA, address(nvdaB), tokens, 0, new LegExecutor.Leg[](0), alice, QH);
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.NotSellEligible.selector, address(usdt)));
        router.sellShares(NVDA, address(usdt), tokens, 0, legs, alice, QH);
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.WrongUnderlying.selector, address(nvdaB), AAPL));
        router.sellShares(AAPL, address(nvdaB), tokens, 0, legs, alice, QH);
        vm.expectRevert(
            abi.encodeWithSelector(
                ShareRouter.InsufficientUsdtOut.selector, venue.quote(address(nvdaB), address(usdt), tokens), 5000e18
            )
        );
        router.sellShares(NVDA, address(nvdaB), tokens, 5000e18, legs, alice, QH);

        legs[0].target = alice;
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.TargetNotAllowed.selector, alice));
        router.sellShares(NVDA, address(nvdaB), tokens, 0, legs, alice, QH);
        legs = _legs1(_leg(address(nvdaOn), address(usdt), tokens, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.LegTokenInMismatch.selector, address(nvdaOn)));
        router.sellShares(NVDA, address(nvdaB), tokens, 0, legs, alice, QH);
        legs = _legs1(_leg(address(nvdaB), address(nvdaOn), tokens, address(router)));
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.LegTokenOutMustBeUsdt.selector, address(nvdaOn)));
        router.sellShares(NVDA, address(nvdaB), tokens, 0, legs, alice, QH);
        vm.stopPrank();
    }
}
