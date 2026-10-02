// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {StockRegistry} from "../../src/StockRegistry.sol";
import {IStockRegistry} from "../../src/interfaces/IStockRegistry.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract StockRegistryTest is BaseTest {
    function test_constructor_rejectsZero() public {
        vm.expectRevert(StockRegistry.ZeroAddress.selector);
        new StockRegistry(address(0), address(usdg));
        vm.expectRevert(StockRegistry.ZeroAddress.selector);
        new StockRegistry(admin, address(0));
    }

    function test_setUnderlying_andList() public view {
        bytes32[] memory ids = registry.underlyingIds();
        assertEq(ids.length, 2);
        assertEq(registry.getUnderlying(NVDA).ticker, "NVDA");
        assertTrue(registry.getUnderlying(NVDA).active);
    }

    function test_setUnderlying_onlyAdmin() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.setUnderlying(bytes32("TSLA"), "TSLA", true);
    }

    function test_addRepresentation_storesMetadata() public view {
        IStockRegistry.Representation memory r = registry.getRepresentation(address(nvdaB));
        assertEq(r.token, address(nvdaB));
        assertEq(r.underlyingId, NVDA);
        assertEq(r.platformId, BSTOCK);
        assertEq(r.decimals, 18);
        assertEq(uint8(r.ratioSource), uint8(IStockRegistry.RatioSource.ERC8056));
        assertTrue(r.active);
        assertTrue(r.exists);
        assertEq(registry.representationsOf(NVDA).length, 2);
        assertEq(registry.underlyingOf(address(nvdaOn)), NVDA);
        assertEq(registry.platformOf(address(nvdaOn)), ONDO);
    }

    function test_addRepresentation_reverts() public {
        vm.startPrank(admin);
        vm.expectRevert(StockRegistry.ZeroAddress.selector);
        registry.addRepresentation(address(0), NVDA, ONDO, IStockRegistry.RatioSource.KEEPER, 1e18);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownUnderlying.selector, bytes32("XXX")));
        registry.addRepresentation(address(nvdaOn), bytes32("XXX"), ONDO, IStockRegistry.RatioSource.KEEPER, 1e18);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.AlreadyRegistered.selector, address(nvdaOn)));
        registry.addRepresentation(address(nvdaOn), NVDA, ONDO, IStockRegistry.RatioSource.KEEPER, 1e18);
        MockStockToken t = new MockStockToken("x", "x", false);
        vm.expectRevert(StockRegistry.ZeroRatio.selector);
        registry.addRepresentation(address(t), NVDA, ONDO, IStockRegistry.RatioSource.KEEPER, 0);
        vm.stopPrank();
    }

    function test_setRepresentationActive() public {
        vm.prank(admin);
        registry.setRepresentationActive(address(nvdaOn), false);
        assertFalse(registry.isBuyEligible(address(nvdaOn)));
        assertTrue(registry.isSellEligible(address(nvdaOn)));
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(0xdead)));
        registry.setRepresentationActive(address(0xdead), false);
    }

    function test_allowedTargets() public {
        assertTrue(registry.isAllowedTarget(address(venue)));
        assertFalse(registry.isAllowedTarget(alice));
        vm.prank(admin);
        registry.setAllowedTarget(address(venue), false);
        assertFalse(registry.isAllowedTarget(address(venue)));
        vm.prank(admin);
        vm.expectRevert(StockRegistry.ZeroAddress.selector);
        registry.setAllowedTarget(address(0), true);
    }

    function test_setLimits() public {
        vm.prank(admin);
        registry.setLimits(1 hours, 2 hours, 100);
        assertEq(registry.maxAttestationAge(), 1 hours);
        assertEq(registry.maxRatioAge(), 2 hours);
        assertEq(registry.maxRatioStepBps(), 100);
    }

    // ---- ratios ----

    function test_ratioOf_keeperAndErc8056() public view {
        (uint256 r1, uint64 t1) = registry.ratioOf(address(nvdaOn));
        assertEq(r1, NVDA_ON_RATIO);
        assertEq(t1, uint64(block.timestamp));
        (uint256 r2,) = registry.ratioOf(address(nvdaB));
        assertEq(r2, NVDA_B_MULT);
    }

    function test_ratioOf_unknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(0xbeef)));
        registry.ratioOf(address(0xbeef));
    }

    function test_sharesAndTokensConversions() public view {
        assertEq(registry.sharesForTokens(address(nvdaOn), 1e18), NVDA_ON_RATIO);
        // round trip: tokensForShares rounds up so shares(tokens(s)) >= s
        uint256 s = 123456789012345678;
        uint256 t = registry.tokensForShares(address(nvdaB), s);
        assertGe(registry.sharesForTokens(address(nvdaB), t), s);
    }

    function test_postRatio_withinStep() public {
        vm.prank(keeper);
        registry.postRatio(address(nvdaOn), 1.004e18);
        (uint256 r,) = registry.ratioOf(address(nvdaOn));
        assertEq(r, 1.004e18);
    }

    function test_postRatio_rejectsLargeStep() public {
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.RatioStepTooLarge.selector, 9926, 500));
        registry.postRatio(address(nvdaOn), 2.0e18);
    }

    /// @dev Audit lead: a run of in-bound posts must not compound past the bound inside one window.
    function test_postRatio_stepIsAnchoredOverWindow() public {
        vm.startPrank(keeper);
        registry.postRatio(address(nvdaOn), NVDA_ON_RATIO * 10_400 / 10_000); // +4 %
        // +4 % on top of that is within step of the last post but 8.2 % off the window anchor -> rejected
        uint256 next = NVDA_ON_RATIO * 10_400 / 10_000 * 10_400 / 10_000;
        vm.expectRevert();
        registry.postRatio(address(nvdaOn), next);
        // once the window has rolled the anchor moves to the last posted value and the same step passes
        vm.warp(block.timestamp + registry.STEP_WINDOW());
        registry.postRatio(address(nvdaOn), next);
        vm.stopPrank();
        (uint256 r,) = registry.ratioOf(address(nvdaOn));
        assertEq(r, next);
    }

    function test_confirmRatio_resetsAnchor() public {
        vm.prank(admin);
        registry.confirmRatio(address(nvdaOn), 2e18);
        vm.prank(keeper);
        registry.postRatio(address(nvdaOn), 2.04e18); // 2 % from the confirmed value, far from the old anchor
        (uint256 r,) = registry.ratioOf(address(nvdaOn));
        assertEq(r, 2.04e18);
    }

    function test_referencePrice_keeperPostedAndBounded() public {
        (uint256 p, uint64 at) = registry.referencePrice(NVDA);
        assertEq(p, NVDA_PX);
        assertEq(at, uint64(block.timestamp));
        vm.startPrank(keeper);
        registry.postReferencePrice(NVDA, NVDA_PX * 115 / 100); // +15 % within the 20 % bound
        vm.expectRevert(); // +15 % again compounds to +32 % against the window anchor
        registry.postReferencePrice(NVDA, NVDA_PX * 115 / 100 * 115 / 100);
        vm.expectRevert(StockRegistry.ZeroPrice.selector);
        registry.postReferencePrice(NVDA, 0);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownUnderlying.selector, bytes32("TSLA")));
        registry.postReferencePrice(bytes32("TSLA"), 1e18);
        vm.stopPrank();
        vm.expectRevert();
        registry.postReferencePrice(NVDA, NVDA_PX); // not the keeper
        (p,) = registry.referencePrice(NVDA);
        assertEq(p, NVDA_PX * 115 / 100);
        (p, at) = registry.referencePrice(bytes32("TSLA"));
        assertEq(p, 0);
        assertEq(at, 0);
    }

    function test_referencePrice_feedOverridesKeeper() public {
        vm.warp(block.timestamp + 1 days); // block 1 in tests starts at t=1
        MockAggregator feed = new MockAggregator(8, 250_00000000, block.timestamp - 60);
        vm.expectRevert();
        registry.setPriceFeed(NVDA, address(feed)); // admin only
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownUnderlying.selector, bytes32("TSLA")));
        registry.setPriceFeed(bytes32("TSLA"), address(feed));
        registry.setPriceFeed(NVDA, address(feed));
        vm.stopPrank();
        (uint256 p, uint64 at) = registry.referencePrice(NVDA);
        assertEq(p, 250e18); // 8-decimal feed scaled to 1e18
        assertEq(at, uint64(block.timestamp - 60));
        feed.set(-1, block.timestamp);
        (p, at) = registry.referencePrice(NVDA);
        assertEq(p, 0);
        vm.prank(admin);
        registry.setPriceFeed(NVDA, address(0));
        (p,) = registry.referencePrice(NVDA);
        assertEq(p, NVDA_PX); // back to the keeper's post
    }

    /// Robinhood Chain's stock feeds price the token with its multiplier already in it. The registry must hand
    /// back USD per underlying share, or the mandate's floor would be off by the multiplier.
    function test_referencePrice_tokenFeed_isPerShare() public {
        vm.warp(block.timestamp + 1 days);
        // NVDAB at $219 a share and a 1.000778 multiplier trades at $219.170382 a token
        MockAggregator feed = new MockAggregator(8, 219_17038200, block.timestamp - 60);
        vm.prank(admin);
        registry.setTokenPriceFeed(NVDA, address(feed), address(nvdaB));
        assertEq(registry.priceFeedOf(NVDA), address(feed));
        assertEq(registry.priceFeedToken(NVDA), address(nvdaB));

        (uint256 p, uint64 at) = registry.referencePrice(NVDA);
        assertEq(p, uint256(219_17038200) * 1e10 * 1e18 / NVDA_B_MULT);
        assertApproxEqAbs(p, 219e18, 1e12); // the feed above is rounded to 8 decimals
        assertEq(at, uint64(block.timestamp - 60));

        // a corporate action moves the multiplier and the token price together; the share price follows the feed
        nvdaB.setMultiplier(NVDA_B_MULT * 2);
        feed.set(438_34076400, block.timestamp);
        (p,) = registry.referencePrice(NVDA);
        assertApproxEqAbs(p, 219e18, 1e12);

        // a token reporting no multiplier cannot be priced per share
        nvdaB.setMultiplier(0);
        (p, at) = registry.referencePrice(NVDA);
        assertEq(p, 0);
        assertEq(at, 0);
    }

    function test_setTokenPriceFeed_guards() public {
        MockAggregator feed = new MockAggregator(8, 219_17038200, block.timestamp);
        vm.expectRevert();
        registry.setTokenPriceFeed(NVDA, address(feed), address(nvdaB)); // admin only
        vm.startPrank(admin);
        vm.expectRevert(StockRegistry.ZeroAddress.selector);
        registry.setTokenPriceFeed(NVDA, address(0), address(nvdaB));
        // the token must be a representation of this underlying, not of another one and not a stranger
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(aaplB)));
        registry.setTokenPriceFeed(NVDA, address(feed), address(aaplB));
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(this)));
        registry.setTokenPriceFeed(NVDA, address(feed), address(this));

        registry.setTokenPriceFeed(NVDA, address(feed), address(nvdaB));
        // switching to a per-share feed drops the token, so the answer is no longer divided
        registry.setPriceFeed(NVDA, address(feed));
        vm.stopPrank();
        assertEq(registry.priceFeedToken(NVDA), address(0));
        (uint256 p,) = registry.referencePrice(NVDA);
        assertEq(p, uint256(219_17038200) * 1e10);
    }

    function test_setPriceLimits() public {
        vm.startPrank(admin);
        vm.expectRevert(StockRegistry.BadLimits.selector);
        registry.setPriceLimits(1 hours, 0);
        vm.expectRevert(StockRegistry.BadLimits.selector);
        registry.setLimits(1 hours, 1 hours, 10_001);
        registry.setPriceLimits(1 hours, 1_000);
        vm.stopPrank();
        assertEq(registry.maxPriceAge(), 1 hours);
        assertEq(registry.maxPriceStepBps(), 1_000);
    }

    function test_postRatio_wrongSourceAndZero() public {
        vm.startPrank(keeper);
        vm.expectRevert(StockRegistry.WrongRatioSource.selector);
        registry.postRatio(address(nvdaB), 1e18);
        vm.expectRevert(StockRegistry.ZeroRatio.selector);
        registry.postRatio(address(nvdaOn), 0);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(0xbeef)));
        registry.postRatio(address(0xbeef), 1e18);
        vm.stopPrank();
    }

    function test_postRatio_onlyKeeper() public {
        vm.prank(alice);
        vm.expectRevert();
        registry.postRatio(address(nvdaOn), 1.004e18);
    }

    function test_confirmRatio_adminOverridesStep() public {
        vm.prank(admin);
        registry.confirmRatio(address(nvdaOn), 2.0e18);
        (uint256 r,) = registry.ratioOf(address(nvdaOn));
        assertEq(r, 2.0e18);
        vm.prank(admin);
        vm.expectRevert(StockRegistry.ZeroRatio.selector);
        registry.confirmRatio(address(nvdaOn), 0);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(0xbeef)));
        registry.confirmRatio(address(0xbeef), 1e18);
    }

    function test_checkpointRatio_erc8056() public {
        nvdaB.setMultiplier(1.002e18);
        vm.expectRevert(); // keeper-only: a buyer must not be able to re-anchor the corporate-action guard
        registry.checkpointRatio(address(nvdaB));
        vm.startPrank(keeper);
        registry.checkpointRatio(address(nvdaB));
        assertEq(registry.postedRatio(address(nvdaB)).ratio, 1.002e18);
        vm.expectRevert(StockRegistry.WrongRatioSource.selector);
        registry.checkpointRatio(address(nvdaOn));
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownRepresentation.selector, address(0xbeef)));
        registry.checkpointRatio(address(0xbeef));
        vm.stopPrank();
        nvdaB.setMultiplier(0);
        vm.prank(keeper);
        vm.expectRevert(StockRegistry.ZeroRatio.selector);
        registry.checkpointRatio(address(nvdaB));
    }

    function test_corporateAction_pausesBuysUntilAdminConfirms() public {
        // 10:1 split on an ERC-8056 token: multiplier jumps 10x -> buys paused, sells fine.
        nvdaB.setMultiplier(NVDA_B_MULT * 10);
        assertFalse(registry.isBuyEligible(address(nvdaB)));
        assertTrue(registry.isSellEligible(address(nvdaB)));
        vm.prank(keeper);
        vm.expectRevert();
        registry.checkpointRatio(address(nvdaB));
        vm.prank(admin);
        registry.confirmRatio(address(nvdaB), NVDA_B_MULT * 10);
        assertTrue(registry.isBuyEligible(address(nvdaB)));
    }

    // ---- attestation / market ----

    function test_postAttestation() public {
        vm.prank(keeper);
        registry.postAttestation(ONDO, uint64(block.timestamp));
        assertEq(registry.attestedAt(ONDO), uint64(block.timestamp));
        vm.prank(keeper);
        vm.expectRevert(StockRegistry.StaleTimestamp.selector);
        registry.postAttestation(ONDO, uint64(block.timestamp + 1));
        vm.prank(keeper);
        vm.expectRevert(StockRegistry.StaleTimestamp.selector);
        registry.postAttestation(ONDO, uint64(block.timestamp - 1));
    }

    function test_postMarketState() public {
        vm.prank(keeper);
        registry.postMarketState(NVDA, false);
        assertFalse(registry.marketState(NVDA).open);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(StockRegistry.UnknownUnderlying.selector, bytes32("XXX")));
        registry.postMarketState(bytes32("XXX"), true);
    }

    // ---- eligibility ----

    function test_isBuyEligible_freshness() public {
        assertTrue(registry.isBuyEligible(address(nvdaOn)));
        assertTrue(registry.isBuyEligible(address(nvdaB)));
        // stale keeper ratio
        vm.warp(block.timestamp + 13 hours);
        assertFalse(registry.isBuyEligible(address(nvdaOn)));
        assertTrue(registry.isBuyEligible(address(nvdaB))); // erc8056 is live
        // stale attestation
        vm.warp(block.timestamp + 36 hours);
        assertFalse(registry.isBuyEligible(address(nvdaB)));
        assertTrue(registry.isSellEligible(address(nvdaB)));
        assertFalse(registry.isBuyEligible(address(0xbeef)));
        assertFalse(registry.isSellEligible(address(0xbeef)));
    }

    function test_guardianPausesBuysOnly() public {
        vm.prank(guardian);
        registry.setBuysPaused(true);
        assertTrue(registry.buysPaused());
        assertFalse(registry.isBuyEligible(address(nvdaB)));
        assertTrue(registry.isSellEligible(address(nvdaB)));
        vm.prank(alice);
        vm.expectRevert();
        registry.setBuysPaused(false);
    }

    function test_isBuyEligible_zeroMultiplier() public {
        nvdaB.setMultiplier(0);
        assertFalse(registry.isBuyEligible(address(nvdaB)));
    }
}

contract MockAggregator {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;

    constructor(uint8 dec, int256 a, uint256 at) {
        decimals = dec;
        answer = a;
        updatedAt = at;
    }

    function set(int256 a, uint256 at) external {
        answer = a;
        updatedAt = at;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, answer, updatedAt, updatedAt, 1);
    }
}
