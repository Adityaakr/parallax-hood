// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {IBasketVault} from "../../src/interfaces/IBasketVault.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {IStockRegistry} from "../../src/interfaces/IStockRegistry.sol";

contract BasketVaultTest is BaseTest {
    bytes32 constant QH = keccak256("basket-quote");

    // ---------------- construction / factory ----------------

    function test_factory_createsAndLists() public view {
        assertEq(factory.basketCount(), 1);
        assertEq(factory.baskets()[0], address(basket));
        assertTrue(factory.isBasket(address(basket)));
        assertEq(factory.basketBySymbol(keccak256("pxTEST")), address(basket));
        assertEq(basket.name(), "Parallax Test Basket");
        assertEq(basket.symbol(), "pxTEST");
        assertEq(basket.constituentCount(), 2);
        assertEq(basket.constituent(0).sharesPerUnit, 0.1e18);
        assertEq(basket.constituents().length, 2);
    }

    function test_factory_reverts() public {
        IBasketVault.Constituent[] memory cs = new IBasketVault.Constituent[](1);
        cs[0] = IBasketVault.Constituent({underlyingId: NVDA, sharesPerUnit: 1e18, maxIssuerBps: 10_000});
        vm.prank(alice);
        vm.expectRevert();
        factory.createBasket("x", "x", cs);
        vm.startPrank(admin);
        vm.expectRevert(abi.encodeWithSelector(BasketFactory.SymbolTaken.selector, "pxTEST"));
        factory.createBasket("x", "pxTEST", cs);
        cs[0].underlyingId = bytes32("XXX");
        vm.expectRevert(abi.encodeWithSelector(BasketFactory.UnknownUnderlying.selector, bytes32("XXX")));
        factory.createBasket("x", "y", cs);
        vm.stopPrank();
    }

    function test_vault_constructorReverts() public {
        IBasketVault.Constituent[] memory cs = new IBasketVault.Constituent[](0);
        vm.expectRevert(BasketVault.NoConstituents.selector);
        new BasketVault("a", "b", registry, cs);
        cs = new IBasketVault.Constituent[](2);
        cs[0] = IBasketVault.Constituent({underlyingId: NVDA, sharesPerUnit: 1e18, maxIssuerBps: 10_000});
        cs[1] = IBasketVault.Constituent({underlyingId: NVDA, sharesPerUnit: 1e18, maxIssuerBps: 10_000});
        vm.expectRevert(abi.encodeWithSelector(BasketVault.DuplicateConstituent.selector, NVDA));
        new BasketVault("a", "b", registry, cs);
        cs[1].underlyingId = AAPL;
        cs[1].sharesPerUnit = 0;
        vm.expectRevert(abi.encodeWithSelector(BasketVault.ZeroSharesPerUnit.selector, AAPL));
        new BasketVault("a", "b", registry, cs);
        cs[1].sharesPerUnit = 1;
        cs[1].maxIssuerBps = 10_001;
        vm.expectRevert(abi.encodeWithSelector(BasketVault.BadIssuerCap.selector, AAPL));
        new BasketVault("a", "b", registry, cs);
    }

    // ---------------- mint ----------------

    function test_mint_backsEveryConstituent() public {
        uint256 spent = _mintBasket(alice, 10e18);
        assertEq(basket.balanceOf(alice), 10e18);
        assertTrue(basket.backingOk());
        assertGe(basket.heldShares(0), 1e18); // 10 units * 0.1 NVDA
        assertGe(basket.heldShares(1), 0.5e18); // 10 units * 0.05 AAPL
        // fair cost ~ 10*(0.1*219 + 0.05*332) = 385 USDG
        assertApproxEqRel(spent, 385e6, 0.01e18);
        assertEq(usdg.balanceOf(address(basket)), 0);
    }

    function test_mint_refundsLeftover() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        uint256 before = usdg.balanceOf(alice);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg + 100e6);
        uint256 spent = basket.mint(1e18, maxUsdg + 100e6, legs, alice, QH);
        vm.stopPrank();
        assertEq(usdg.balanceOf(alice), before - spent);
        assertLt(spent, maxUsdg + 100e6);
    }

    function test_mint_revertsWhenUnderBacked() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);
        vm.expectRevert(); // BackingViolated for AAPL: legs only cover 1 unit
        basket.mint(2e18, maxUsdg, legs, alice, QH);
        vm.stopPrank();
    }

    function test_mint_revertsWithoutLegsForAConstituent() public {
        uint256 u1 = _usdgForShares(address(nvdaB), 0.1e18 + 1);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdg), address(nvdaB), u1, address(basket)));
        vm.startPrank(alice);
        usdg.approve(address(basket), u1);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.UnderDelivered.selector, AAPL, 0, 0.05e18));
        basket.mint(1e18, u1, legs, alice, QH);
        vm.stopPrank();
    }

    /// @dev Audit F-1: a mint must be paid for by its own legs. Slack another holder built up (here a donation,
    ///      but a favourable migration or rounding residue does the same) is not mintable against.
    function test_mint_cannotMintAgainstSlack() public {
        _mintBasket(alice, 10e18);
        nvdaB.mint(address(basket), 100e18); // ~100 NVDA shares of slack
        aaplB.mint(address(basket), 100e18);
        assertTrue(basket.backingOk());
        LegExecutor.Leg[] memory none = new LegExecutor.Leg[](0);
        vm.startPrank(bob);
        usdg.approve(address(basket), 1);
        vm.expectRevert(BasketVault.NoLegs.selector);
        basket.mint(1e18, 1, none, bob, QH);
        // a token leg that delivers only one constituent is caught per constituent, not by the aggregate check
        uint256 u1 = _usdgForShares(address(nvdaB), 0.1e18 + 1);
        usdg.approve(address(basket), u1);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.UnderDelivered.selector, AAPL, 0, 0.05e18));
        basket.mint(1e18, u1, _legs1(_leg(address(usdg), address(nvdaB), u1, address(basket))), bob, QH);
        vm.stopPrank();
        assertEq(basket.balanceOf(bob), 0);
    }

    function test_mint_rejectsBadLegs() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);

        vm.expectRevert(BasketVault.ZeroAmount.selector);
        basket.mint(0, maxUsdg, legs, alice, QH);
        vm.expectRevert(BasketVault.ZeroAmount.selector);
        basket.mint(1e18, 0, legs, alice, QH);
        vm.expectRevert(BasketVault.ZeroAddress.selector);
        basket.mint(1e18, maxUsdg, legs, address(0), QH);

        LegExecutor.Leg[] memory bad = _legs1(legs[0]);
        bad[0].target = alice;
        vm.expectRevert(abi.encodeWithSelector(BasketVault.TargetNotAllowed.selector, alice));
        basket.mint(1e18, maxUsdg, bad, alice, QH);

        bad = _legs1(_leg(address(nvdaB), address(usdg), 1e18, address(basket)));
        vm.expectRevert(abi.encodeWithSelector(BasketVault.LegTokenInMustBeUsdg.selector, address(nvdaB)));
        basket.mint(1e18, maxUsdg, bad, alice, QH);

        vm.stopPrank();
    }

    function test_mint_rejectsNonConstituentAndIneligible() public {
        // deprecate nvdaB -> not buy eligible
        vm.prank(admin);
        registry.setRepresentationActive(address(nvdaB), false);
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.NotBuyEligible.selector, address(nvdaB)));
        basket.mint(1e18, maxUsdg, legs, alice, QH);
        vm.stopPrank();

        // token of an underlying that is not a constituent
        vm.startPrank(admin);
        registry.setRepresentationActive(address(nvdaB), true);
        registry.setUnderlying(bytes32("TSLA"), "TSLA", true);
        vm.stopPrank();
        MockStockToken tslaB = new MockStockToken("Tesla", "TSLAB", true);
        address tsla = address(tslaB);
        IStockRegistry.RatioSource src = registry.getRepresentation(address(nvdaB)).ratioSource;
        vm.prank(admin);
        registry.addRepresentation(tsla, bytes32("TSLA"), BSTOCK, src, 1e18);
        venue.setPrice(tsla, 300e18);
        tslaB.mint(address(venue), 1e24);
        LegExecutor.Leg[] memory bad = _legs1(_leg(address(usdg), tsla, 100e6, address(basket)));
        vm.startPrank(alice);
        usdg.approve(address(basket), 100e6);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.NotAConstituent.selector, tsla));
        basket.mint(1e18, 100e6, bad, alice, QH);
        vm.stopPrank();
    }

    function test_mint_overspendGuard() public {
        // Pre-existing vault USDG (donated) must not let legs exceed maxUsdgIn.
        usdg.mint(address(basket), 1000e6);
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), 1);
        vm.expectRevert(); // OverSpent
        basket.mint(1e18, 1, legs, alice, QH);
        vm.stopPrank();
        maxUsdg; // silence
    }

    function test_mint_issuerCapEnforced() public {
        // NVDA cap is 80 %. Fill 100 % from bstock while ondo is also eligible -> revert.
        uint256 u1 = _usdgForShares(address(nvdaB), 0.1e18 + 1);
        uint256 u2 = _usdgForShares(address(aaplB), 0.05e18 + 1);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(usdg), address(nvdaB), u1, address(basket)),
            _leg(address(usdg), address(aaplB), u2, address(basket))
        );
        vm.startPrank(alice);
        usdg.approve(address(basket), u1 + u2);
        vm.expectRevert(); // IssuerCapExceeded(NVDA, bstock, ...)
        basket.mint(1e18, u1 + u2, legs, alice, QH);
        vm.stopPrank();

        // 70/30 split satisfies the cap
        uint256 uB = _usdgForShares(address(nvdaB), 0.07e18 + 1);
        uint256 uO = _usdgForShares(address(nvdaOn), 0.03e18 + 1);
        LegExecutor.Leg[] memory legs3 = new LegExecutor.Leg[](3);
        legs3[0] = _leg(address(usdg), address(nvdaB), uB, address(basket));
        legs3[1] = _leg(address(usdg), address(nvdaOn), uO, address(basket));
        legs3[2] = _leg(address(usdg), address(aaplB), u2, address(basket));
        vm.startPrank(alice);
        usdg.approve(address(basket), uB + uO + u2);
        basket.mint(1e18, uB + uO + u2, legs3, alice, QH);
        vm.stopPrank();
        assertTrue(basket.backingOk());
        IBasketVault.ConstituentView[] memory comp = basket.composition();
        assertEq(comp[0].representations.length, 2);
        assertLe(comp[0].representations[1].shareBps, 8_000); // nvdaB is index 1 (registered second)
    }

    function test_mint_issuerCapSkippedWhenSingleEligible() public {
        // Make ondo stale -> only one eligible rep -> 100 % bstock is fine.
        vm.warp(block.timestamp + 13 hours);
        vm.prank(keeper);
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegsBstockOnly(1e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);
        basket.mint(1e18, maxUsdg, legs, alice, QH);
        vm.stopPrank();
        assertTrue(basket.backingOk());
    }

    /// @dev Audit F-4: concentration built while only one representation was eligible does not brick the vault
    ///      once the other one comes back: mints that dilute the over-cap platform pass, mints that add to it fail.
    function test_mint_overCapPlatformCanOnlyBeDiluted() public {
        vm.warp(block.timestamp + 13 hours);
        vm.prank(keeper);
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegsBstockOnly(1e18);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);
        basket.mint(1e18, maxUsdg, legs, alice, QH); // NVDA is now 100 % bstock (cap 80 %)
        vm.stopPrank();

        // ondo becomes eligible again
        vm.startPrank(keeper);
        registry.postAttestation(ONDO, uint64(block.timestamp));
        registry.postRatio(address(nvdaOn), NVDA_ON_RATIO);
        vm.stopPrank();

        // adding more bstock (100 % -> still 100 %) is rejected
        (LegExecutor.Leg[] memory more, uint256 moreUsdg) = _mintLegsBstockOnly(1e18);
        vm.startPrank(bob);
        usdg.approve(address(basket), moreUsdg);
        vm.expectRevert();
        basket.mint(1e18, moreUsdg, more, bob, QH);

        // a 70/30 mint dilutes bstock to ~85 %: still over the cap, but strictly better -> allowed
        (LegExecutor.Leg[] memory split, uint256 splitUsdg) = _mintLegs(1e18);
        usdg.approve(address(basket), splitUsdg);
        basket.mint(1e18, splitUsdg, split, bob, QH);
        vm.stopPrank();
        assertEq(basket.balanceOf(bob), 1e18);
        IBasketVault.ConstituentView[] memory comp = basket.composition();
        assertGt(comp[0].representations[1].shareBps, 8_000);
        assertLt(comp[0].representations[1].shareBps, 10_000);
    }

    // ---------------- redeem ----------------

    function test_redeem_toUsdg() public {
        _mintBasket(alice, 10e18);
        uint256 supply = basket.totalSupply();
        uint256 nB = nvdaB.balanceOf(address(basket)) * 4e18 / supply;
        uint256 nO = nvdaOn.balanceOf(address(basket)) * 4e18 / supply;
        uint256 aB = aaplB.balanceOf(address(basket)) * 4e18 / supply;
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](3);
        legs[0] = _leg(address(nvdaB), address(usdg), nB, address(basket));
        legs[1] = _leg(address(nvdaOn), address(usdg), nO, address(basket));
        legs[2] = _leg(address(aaplB), address(usdg), aB, address(basket));
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        uint256 out = basket.redeem(4e18, 150e6, legs, alice, QH);
        assertEq(basket.balanceOf(alice), 6e18);
        assertEq(usdg.balanceOf(alice), before + out);
        assertApproxEqRel(out, 4 * (0.1e18 * 219 + 0.05e18 * 332) / USDG_SCALE, 0.01e18);
        assertTrue(basket.backingOk());
        assertEq(usdg.balanceOf(address(basket)), 0);
    }

    function test_redeem_unsoldGoesInKind() public {
        _mintBasket(alice, 10e18);
        uint256 supply = basket.totalSupply();
        uint256 nB = nvdaB.balanceOf(address(basket)) * 5e18 / supply;
        uint256 aB = aaplB.balanceOf(address(basket)) * 5e18 / supply;
        // only sell NVDAB; AAPLB comes in kind
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(nvdaB), address(usdg), nB, address(basket)));
        vm.prank(alice);
        basket.redeem(5e18, 0, legs, alice, QH);
        assertEq(aaplB.balanceOf(alice), aB);
        assertEq(nvdaB.balanceOf(alice), 0);
        assertGt(nvdaOn.balanceOf(alice), 0); // unsold ondo slice also in kind
        assertTrue(basket.backingOk());
    }

    function test_redeem_cannotSellMoreThanProRata() public {
        _mintBasket(alice, 10e18);
        _mintBasket(bob, 10e18);
        uint256 all = nvdaB.balanceOf(address(basket));
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(nvdaB), address(usdg), all, address(basket)));
        vm.prank(alice);
        vm.expectRevert(); // LegExceedsProRata
        basket.redeem(10e18, 0, legs, alice, QH);
    }

    function test_redeem_reverts() public {
        _mintBasket(alice, 10e18);
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](0);
        vm.startPrank(alice);
        vm.expectRevert(BasketVault.ZeroAmount.selector);
        basket.redeem(0, 0, legs, alice, QH);
        vm.expectRevert(BasketVault.ZeroAddress.selector);
        basket.redeem(1e18, 0, legs, address(0), QH);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.InsufficientUnits.selector, 10e18, 11e18));
        basket.redeem(11e18, 0, legs, alice, QH);
        vm.expectRevert(); // InsufficientUsdgOut: no legs -> 0 usdg
        basket.redeem(1e18, 1, legs, alice, QH);

        uint256 nB = nvdaB.balanceOf(address(basket)) / 10;
        legs = _legs1(_leg(address(nvdaB), address(usdg), nB, address(basket)));
        legs[0].target = alice;
        vm.expectRevert(abi.encodeWithSelector(BasketVault.TargetNotAllowed.selector, alice));
        basket.redeem(1e18, 0, legs, alice, QH);
        legs = _legs1(_leg(address(nvdaB), address(nvdaOn), nB, address(basket)));
        vm.expectRevert(abi.encodeWithSelector(BasketVault.LegTokenOutMustBeUsdg.selector, address(nvdaOn)));
        basket.redeem(1e18, 0, legs, alice, QH);
        legs = _legs1(_leg(address(usdg), address(usdg), 1, address(basket)));
        vm.expectRevert(abi.encodeWithSelector(BasketVault.LegTokenInNotHeld.selector, address(usdg)));
        basket.redeem(1e18, 0, legs, alice, QH);
        vm.stopPrank();
    }

    // ---------------- redeem in kind ----------------

    function test_redeemInKind_proRata() public {
        _mintBasket(alice, 10e18);
        _mintBasket(bob, 30e18);
        uint256 nB = nvdaB.balanceOf(address(basket));
        uint256 aB = aaplB.balanceOf(address(basket));
        vm.prank(alice);
        basket.redeemInKind(10e18, alice);
        assertEq(nvdaB.balanceOf(alice), nB / 4);
        assertEq(aaplB.balanceOf(alice), aB / 4);
        assertEq(basket.balanceOf(alice), 0);
        assertTrue(basket.backingOk());
    }

    function test_redeemInKind_worksWhenEverythingIsStaleOrPaused() public {
        _mintBasket(alice, 10e18);
        vm.prank(guardian);
        registry.setBuysPaused(true);
        vm.warp(block.timestamp + 365 days);
        vm.prank(admin);
        registry.setRepresentationActive(address(nvdaB), false);
        vm.prank(alice);
        basket.redeemInKind(10e18, alice);
        assertGt(nvdaB.balanceOf(alice), 0);
        assertGt(aaplB.balanceOf(alice), 0);
    }

    function test_redeemInKind_distributesVaultUsdg() public {
        _mintBasket(alice, 10e18);
        usdg.mint(address(basket), 100e6); // e.g. leftover from a migration
        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        basket.redeemInKind(5e18, alice);
        assertEq(usdg.balanceOf(alice), before + 50e6);
    }

    function test_redeemInKind_skipFrozenToken() public {
        _mintBasket(alice, 10e18);
        aaplB.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(); // full in-kind reverts because AAPLB transfer is paused by the issuer
        basket.redeemInKind(10e18, alice);
        address[] memory skip = new address[](1);
        skip[0] = address(aaplB);
        vm.prank(alice);
        basket.redeemInKindSkipping(10e18, alice, skip);
        assertGt(nvdaB.balanceOf(alice), 0);
        assertEq(aaplB.balanceOf(alice), 0);
    }

    function test_redeemInKind_reverts() public {
        vm.startPrank(alice);
        vm.expectRevert(BasketVault.ZeroAmount.selector);
        basket.redeemInKind(0, alice);
        vm.expectRevert(BasketVault.ZeroAddress.selector);
        basket.redeemInKind(1, address(0));
        vm.expectRevert(abi.encodeWithSelector(BasketVault.InsufficientUnits.selector, 0, 1));
        basket.redeemInKind(1, alice);
        vm.stopPrank();
    }

    // ---------------- migrate ----------------

    function _setupMigration() internal returns (uint256 sellAmount) {
        // Vault holds NVDA as 70 % bstock / 30 % ondo (see cap test). Make ondo cheaper per share so migration
        // ondo -> bstock... no: make bstock cheaper so moving ondo -> bstock gains shares.
        _mintBasket(alice, 10e18);
        // bstock now trades at a 2 % discount per share -> selling ondo and buying bstock gains shares
        venue.setPrice(address(nvdaB), NVDA_PX * NVDA_B_MULT / WAD * 98 / 100);
        sellAmount = nvdaOn.balanceOf(address(basket));
    }

    function test_migrate_increasesShares() public {
        uint256 sell = _setupMigration();
        // NVDAon's keeper ratio goes stale -> it is no longer buy-eligible -> cap no longer binds and the
        // basket can migrate fully out of the stale representation into the fresh, cheaper one.
        vm.warp(block.timestamp + 13 hours);
        vm.prank(keeper);
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        uint256 before0 = basket.heldShares(0);
        uint256 before1 = basket.heldShares(1);
        uint256 usdgOut = venue.quote(address(nvdaOn), address(usdg), sell);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(nvdaB), usdgOut, address(basket))
        );
        vm.prank(bob); // permissionless
        uint256 gain = basket.migrate(NVDA, legs, 1, QH);
        assertGt(gain, 0);
        assertEq(basket.heldShares(0), before0 + gain);
        assertEq(basket.heldShares(1), before1);
        assertEq(nvdaOn.balanceOf(address(basket)), 0);
        assertTrue(basket.backingOk());
    }

    function test_migrate_partialWithinCap() public {
        uint256 held = _setupMigration();
        uint256 sell = held / 4; // move ~7.5 % of NVDA from ondo to bstock: 70 -> ~78 %, still within the 80 % cap
        uint256 before0 = basket.heldShares(0);
        uint256 usdgOut = venue.quote(address(nvdaOn), address(usdg), sell);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(nvdaB), usdgOut, address(basket))
        );
        vm.prank(bob);
        uint256 gain = basket.migrate(NVDA, legs, 1, QH);
        assertGt(gain, 0);
        assertEq(basket.heldShares(0), before0 + gain);
        assertTrue(basket.backingOk());
    }

    function test_migrate_revertsWhenSharesDecrease() public {
        uint256 sell = _setupMigration();
        venue.setPrice(address(nvdaB), NVDA_PX * NVDA_B_MULT / WAD * 105 / 100); // bstock now expensive
        uint256 usdgOut = venue.quote(address(nvdaOn), address(usdg), sell);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(nvdaB), usdgOut, address(basket))
        );
        vm.prank(bob);
        vm.expectRevert(); // InsufficientShareGain
        basket.migrate(NVDA, legs, 0, QH);
    }

    function test_migrate_minShareGainEnforced() public {
        uint256 sell = _setupMigration();
        uint256 usdgOut = venue.quote(address(nvdaOn), address(usdg), sell);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(nvdaB), usdgOut, address(basket))
        );
        vm.prank(bob);
        vm.expectRevert();
        basket.migrate(NVDA, legs, 1e30, QH);
    }

    function test_migrate_cannotDrainUsdg() public {
        _setupMigration();
        usdg.mint(address(basket), 500e6);
        // try to use vault USDG to buy without selling anything: USDG balance would drop
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdg), address(nvdaB), 500e6, address(basket)));
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.UsdgDecreased.selector, 500e6, 0));
        basket.migrate(NVDA, legs, 0, QH);
    }

    function test_migrate_cannotTouchOtherConstituents() public {
        _setupMigration();
        uint256 aB = aaplB.balanceOf(address(basket));
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(aaplB), address(usdg), aB, address(basket)),
            _leg(address(usdg), address(nvdaB), 1e6, address(basket))
        );
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.MigrateLegOutsideConstituent.selector, address(aaplB)));
        basket.migrate(NVDA, legs, 0, QH);
    }

    function test_migrate_rejectsIneligibleTargetAndBadLegs() public {
        uint256 sell = _setupMigration();
        vm.prank(admin);
        registry.setRepresentationActive(address(nvdaB), false);
        uint256 usdgOut = venue.quote(address(nvdaOn), address(usdg), sell);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(nvdaB), usdgOut, address(basket))
        );
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(BasketVault.NotBuyEligible.selector, address(nvdaB)));
        basket.migrate(NVDA, legs, 0, QH);

        vm.expectRevert(abi.encodeWithSelector(BasketVault.UnknownUnderlying.selector, bytes32("XXX")));
        basket.migrate(bytes32("XXX"), legs, 0, QH);
        vm.expectRevert(BasketVault.ZeroAmount.selector);
        basket.migrate(NVDA, new LegExecutor.Leg[](0), 0, QH);

        legs[0].target = alice;
        vm.expectRevert(abi.encodeWithSelector(BasketVault.TargetNotAllowed.selector, alice));
        basket.migrate(NVDA, legs, 0, QH);

        // tokenOut of wrong underlying
        LegExecutor.Leg[] memory bad = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(aaplB), usdgOut, address(basket))
        );
        vm.expectRevert(abi.encodeWithSelector(BasketVault.WrongUnderlying.selector, address(aaplB), NVDA));
        basket.migrate(NVDA, bad, 0, QH);
        vm.stopPrank();
    }

    function test_migrate_respectsIssuerCap() public {
        // Move everything into bstock when cap is 80 % and both reps are eligible -> cap exceeded.
        uint256 sell = _setupMigration();
        venue.setPrice(address(nvdaB), NVDA_PX * NVDA_B_MULT / WAD * 90 / 100);
        uint256 usdgOut = venue.quote(address(nvdaOn), address(usdg), sell);
        LegExecutor.Leg[] memory legs = _legs2(
            _leg(address(nvdaOn), address(usdg), sell, address(basket)),
            _leg(address(usdg), address(nvdaB), usdgOut, address(basket))
        );
        vm.prank(bob);
        vm.expectRevert(); // IssuerCapExceeded
        basket.migrate(NVDA, legs, 0, QH);
    }

    // ---------------- views ----------------

    function test_composition_view() public {
        _mintBasket(alice, 10e18);
        IBasketVault.ConstituentView[] memory comp = basket.composition();
        assertEq(comp.length, 2);
        assertEq(comp[0].underlyingId, NVDA);
        assertEq(comp[0].requiredShares, 1e18);
        assertGe(comp[0].heldShares, 1e18);
        assertEq(comp[0].representations.length, 2);
        assertGt(comp[0].representations[0].shares, 0); // ondo ~30 %
        assertLe(comp[0].representations[1].shareBps, 8_000); // bstock <= cap
        assertTrue(comp[0].representations[1].buyEligible);
        assertEq(comp[1].representations.length, 1);
        assertEq(basket.requiredShares(1), 0.5e18);
    }

    function test_reentrancy_blocked() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        bytes memory reenter = abi.encodeCall(BasketVault.redeemInKind, (1, alice));
        venue.setMode(MockSwapTarget.Mode.REENTER, reenter);
        vm.startPrank(alice);
        usdg.approve(address(basket), maxUsdg);
        vm.expectRevert();
        basket.mint(1e18, maxUsdg, legs, alice, QH);
        vm.stopPrank();
    }
}

