// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {StockRegistry} from "../../src/StockRegistry.sol";
import {ShareRouter} from "../../src/ShareRouter.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// The protocol fee: 50 bps of USDG notional on buys, sells, mints and USDG redemptions, paid to a recipient
/// ADMIN sets, capped at 1 % in code. It never touches shares, backing, in-kind redemption or migrations.
contract FeeTest is BaseTest {
    address treasury = makeAddr("treasury");
    uint256 constant FEE = 50;
    bytes32 constant QH = keccak256("quote-fee");

    function _buy(address who, address rep, uint256 usdgIn, uint256 minShares) internal returns (uint256 out) {
        vm.startPrank(who);
        usdg.approve(address(router), usdgIn);
        out = router.buyShares(
            NVDA, usdgIn, minShares, _legs1(_leg(address(usdg), rep, usdgIn, address(router))), who, QH
        );
        vm.stopPrank();
    }

    function _enableFee() internal {
        vm.prank(admin);
        registry.setFee(uint16(FEE), treasury);
    }

    function test_setFee_onlyAdminAndCapped() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, bytes32(0))
        );
        registry.setFee(uint16(FEE), treasury);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.FeeTooHigh.selector, 101, 100));
        registry.setFee(101, treasury);

        _enableFee();
        (uint16 bps, address to) = registry.fee();
        assertEq(bps, FEE);
        assertEq(to, treasury);

        // a zero recipient disables the fee whatever bps says
        vm.prank(admin);
        registry.setFee(uint16(FEE), address(0));
        (bps,) = registry.fee();
        assertEq(bps, 0);
    }

    function test_buy_chargesFeeOnSpent_fromHeadroom() public {
        _enableFee();
        uint256 spendLeg = 1000e6;
        uint256 headroom = 10e6; // the quote sends usdgIn = spend + fee (+ slack)
        vm.startPrank(alice);
        usdg.approve(address(router), spendLeg + headroom);
        uint256 before = usdg.balanceOf(alice);
        router.buyShares(
            NVDA,
            spendLeg + headroom,
            0,
            _legs1(_leg(address(usdg), address(nvdaB), spendLeg, address(router))),
            alice,
            QH
        );
        vm.stopPrank();
        uint256 fee = spendLeg * FEE / 10_000;
        assertEq(usdg.balanceOf(treasury), fee);
        assertEq(usdg.balanceOf(alice), before - spendLeg - fee); // the rest of the headroom came back
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_buy_revertsWhenNothingLeftForFee() public {
        _enableFee();
        vm.startPrank(alice);
        usdg.approve(address(router), 1000e6);
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.InsufficientForFee.selector, 0, 1000e6 * FEE / 10_000));
        router.buyShares(
            NVDA, 1000e6, 0, _legs1(_leg(address(usdg), address(nvdaB), 1000e6, address(router))), alice, QH
        );
        vm.stopPrank();
    }

    function test_sell_paysNetOfFee_andMinIsNet() public {
        _buy(alice, address(nvdaB), 1000e6, 0);
        _enableFee();
        uint256 tokens = nvdaB.balanceOf(alice);
        vm.startPrank(alice);
        nvdaB.approve(address(router), tokens);
        uint256 before = usdg.balanceOf(alice);
        // gross ~1000, net ~995: a net minimum above that must revert, one below must pass
        vm.expectRevert();
        router.sellShares(
            NVDA,
            address(nvdaB),
            tokens,
            999e6,
            _legs1(_leg(address(nvdaB), address(usdg), tokens, address(router))),
            alice,
            QH
        );
        uint256 out = router.sellShares(
            NVDA,
            address(nvdaB),
            tokens,
            990e6,
            _legs1(_leg(address(nvdaB), address(usdg), tokens, address(router))),
            alice,
            QH
        );
        vm.stopPrank();
        assertApproxEqRel(out, 1000e6 * (10_000 - FEE) / 10_000, 1e12);
        assertEq(usdg.balanceOf(alice), before + out);
        assertApproxEqRel(usdg.balanceOf(treasury), 1000e6 * FEE / 10_000, 1e12);
    }

    function test_mint_chargesFeeFromRefund_backingUntouched() public {
        _enableFee();
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(10e18);
        uint256 fee = maxUsdg * FEE / 10_000; // upper bound; the real fee is on what was spent
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg + fee);
        uint256 before = usdg.balanceOf(alice);
        uint256 spent = basket.mint(10e18, maxUsdg + fee, legs, alice, QH);
        vm.stopPrank();
        uint256 charged = usdg.balanceOf(treasury);
        assertEq(charged, spent * FEE / 10_000);
        assertEq(usdg.balanceOf(alice), before - spent - charged);
        assertTrue(basket.backingOk());
        assertEq(basket.balanceOf(alice), 10e18);
        assertEq(usdg.balanceOf(address(basket)), 0);
    }

    function test_mint_revertsWhenMaxUsdgInDoesNotCoverFee() public {
        _enableFee();
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(10e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);
        vm.expectRevert(); // InsufficientForFee(leftover, fee): the legs' slack is smaller than 50 bps
        basket.mint(10e18, maxUsdg, legs, alice, QH);
        vm.stopPrank();
    }

    function test_redeemToUsdg_netOfFee_butInKindIsFree() public {
        _mintBasket(alice, 10e18);
        _enableFee();
        uint256 supply = basket.totalSupply();
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](3);
        legs[0] = _leg(address(nvdaB), address(usdg), nvdaB.balanceOf(address(basket)) * 4e18 / supply, address(basket));
        legs[1] =
            _leg(address(nvdaOn), address(usdg), nvdaOn.balanceOf(address(basket)) * 4e18 / supply, address(basket));
        legs[2] = _leg(address(aaplB), address(usdg), aaplB.balanceOf(address(basket)) * 4e18 / supply, address(basket));
        vm.prank(alice);
        uint256 out = basket.redeem(4e18, 150e6, legs, alice, QH);
        uint256 gross = out * 10_000 / (10_000 - FEE);
        // grossing the net payout back up floors once more: at most 1 raw unit (1e-6 USDG) off the fee charged
        assertApproxEqAbs(usdg.balanceOf(treasury), gross - out, 1);

        // in kind: no USDG flow, no fee, whatever the registry says
        uint256 treasuryBefore = usdg.balanceOf(treasury);
        vm.prank(alice);
        basket.redeemInKind(6e18, alice);
        assertEq(usdg.balanceOf(treasury), treasuryBefore);
        assertEq(basket.balanceOf(alice), 0);
        assertGt(nvdaB.balanceOf(alice) + nvdaOn.balanceOf(alice) + aaplB.balanceOf(alice), 0);
    }
}
