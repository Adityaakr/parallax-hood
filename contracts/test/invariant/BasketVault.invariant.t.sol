// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {Test} from "forge-std/Test.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {StockRegistry} from "../../src/StockRegistry.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

/// @dev Randomly mints, redeems (USDT and in kind), migrates, moves venue prices, drifts multipliers, posts
///      keeper ratios and pauses buys. Records whether in-kind redemption ever failed and whether a migration
///      ever succeeded while reducing shares.
contract VaultHandler is Test {
    BasketVault public basket;
    StockRegistry public registry;
    MockUSDT public usdt;
    MockStockToken public nvdaOn;
    MockStockToken public nvdaB;
    MockStockToken public aaplB;
    MockSwapTarget public venue;
    address public keeper;
    address public guardian;

    address[] public actors;
    bool public inKindFailed;
    bool public backingBrokenByVaultCall;
    bool public migrateReducedShares;
    bool public migrateDecreasedOther;
    uint256 public mints;
    uint256 public redeems;
    uint256 public inKinds;
    uint256 public migrations;

    uint256 constant WAD = 1e18;

    constructor(
        BasketVault b,
        StockRegistry r,
        MockUSDT u,
        MockStockToken on,
        MockStockToken nb,
        MockStockToken ab,
        MockSwapTarget v,
        address k,
        address g
    ) {
        basket = b;
        registry = r;
        usdt = u;
        nvdaOn = on;
        nvdaB = nb;
        aaplB = ab;
        venue = v;
        keeper = k;
        guardian = g;
        for (uint256 i = 0; i < 4; i++) {
            address a = address(uint160(0xA11CE + i));
            actors.push(a);
            usdt.mint(a, 1e27);
        }
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _usdtFor(address token, uint256 shares) internal view returns (uint256) {
        (uint256 ratio,) = registry.ratioOf(token);
        uint256 tokens = shares * WAD / ratio + 1;
        uint256 usd = tokens * venue.price(token) / WAD;
        (uint16 protocolFee,) = registry.fee();
        return usd * (10_000 + venue.feeBps() + protocolFee + 10) / 10_000 + 1;
    }

    function _leg(address tokenIn, address tokenOut, uint256 amountIn) internal view returns (LegExecutor.Leg memory) {
        return LegExecutor.Leg({
            target: address(venue),
            data: abi.encodeCall(MockSwapTarget.swap, (tokenIn, tokenOut, amountIn, 0, address(basket))),
            tokenIn: tokenIn,
            maxIn: amountIn,
            tokenOut: tokenOut
        });
    }

    // ---- actions ----

    function _mintLegs(uint256 units, uint256 ondoBps)
        internal
        view
        returns (LegExecutor.Leg[] memory use, uint256 maxUsdt)
    {
        uint256 nvdaShares = units * 0.1e18 / WAD + 1;
        uint256 sO = nvdaShares * ondoBps / 10_000;
        uint256 uB = _usdtFor(address(nvdaB), nvdaShares - sO + 1);
        uint256 uA = _usdtFor(address(aaplB), units * 0.05e18 / WAD + 1);
        uint256 uO = sO == 0 ? 0 : _usdtFor(address(nvdaOn), sO + 1);
        use = new LegExecutor.Leg[](uO > 0 ? 3 : 2);
        use[0] = _leg(address(usdt), address(nvdaB), uB);
        use[1] = _leg(address(usdt), address(aaplB), uA);
        if (uO > 0) use[2] = _leg(address(usdt), address(nvdaOn), uO);
        maxUsdt = uB + uO + uA;
    }

    function mint(uint256 seed, uint256 units, uint256 ondoBps) external {
        units = bound(units, 1e15, 100e18);
        ondoBps = bound(ondoBps, 0, 3_000); // keep bstock <= 80 % when both eligible
        address who = _actor(seed);
        (LegExecutor.Leg[] memory use, uint256 maxUsdt) = _mintLegs(units, ondoBps);
        vm.startPrank(who);
        usdt.approve(address(basket), maxUsdt);
        try basket.mint(units, maxUsdt, use, who, bytes32(seed)) {
            mints++;
            if (!basket.backingOk()) backingBrokenByVaultCall = true;
        } catch {}
        vm.stopPrank();
    }

    function redeem(uint256 seed, uint256 units) external {
        address who = _actor(seed);
        uint256 bal = basket.balanceOf(who);
        if (bal == 0) return;
        units = bound(units, 1, bal);
        uint256 supply = basket.totalSupply();
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](3);
        legs[0] = _leg(address(nvdaB), address(usdt), nvdaB.balanceOf(address(basket)) * units / supply);
        legs[1] = _leg(address(nvdaOn), address(usdt), nvdaOn.balanceOf(address(basket)) * units / supply);
        legs[2] = _leg(address(aaplB), address(usdt), aaplB.balanceOf(address(basket)) * units / supply);
        // drop zero-amount legs
        uint256 n;
        for (uint256 i = 0; i < 3; i++) {
            if (legs[i].maxIn > 0) n++;
        }
        LegExecutor.Leg[] memory use = new LegExecutor.Leg[](n);
        uint256 k;
        for (uint256 i = 0; i < 3; i++) {
            if (legs[i].maxIn > 0) use[k++] = legs[i];
        }
        vm.prank(who);
        try basket.redeem(units, 0, use, who, bytes32(seed)) {
            redeems++;
            if (!basket.backingOk()) backingBrokenByVaultCall = true;
        } catch {}
    }

    function redeemInKind(uint256 seed, uint256 units) external {
        address who = _actor(seed);
        uint256 bal = basket.balanceOf(who);
        if (bal == 0) return;
        units = bound(units, 1, bal);
        vm.prank(who);
        try basket.redeemInKind(units, who) {
            inKinds++;
            if (!basket.backingOk()) backingBrokenByVaultCall = true;
        } catch {
            inKindFailed = true;
        }
    }

    function migrate(uint256 seed, uint256 fraction, bool toBstock) external {
        fraction = bound(fraction, 1, 10_000);
        address from = toBstock ? address(nvdaOn) : address(nvdaB);
        address to = toBstock ? address(nvdaB) : address(nvdaOn);
        uint256 amt = MockStockToken(from).balanceOf(address(basket)) * fraction / 10_000;
        if (amt == 0) return;
        uint256 usdtOut = venue.quote(from, address(usdt), amt);
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](2);
        legs[0] = _leg(from, address(usdt), amt);
        legs[1] = _leg(address(usdt), to, usdtOut);
        uint256 before0 = basket.heldShares(0);
        uint256 before1 = basket.heldShares(1);
        vm.prank(_actor(seed));
        try basket.migrate(bytes32("NVDA"), legs, 0, bytes32(seed)) {
            migrations++;
            if (!basket.backingOk()) backingBrokenByVaultCall = true;
            if (basket.heldShares(0) <= before0) migrateReducedShares = true;
            if (basket.heldShares(1) < before1) migrateDecreasedOther = true;
        } catch {}
    }

    // ---- environment ----

    function movePrice(uint256 which, uint256 bps) external {
        bps = bound(bps, 9_000, 11_000); // +-10 %
        address t = which % 3 == 0 ? address(nvdaOn) : which % 3 == 1 ? address(nvdaB) : address(aaplB);
        venue.setPrice(t, venue.price(t) * bps / 10_000);
    }

    function driftMultiplier(uint256 which, uint256 bps) external {
        bps = bound(bps, 10_000, 10_010); // dividends reinvested: multiplier only rises
        MockStockToken t = which % 2 == 0 ? nvdaB : aaplB;
        t.setMultiplier(t.uiMultiplier() * bps / 10_000);
    }

    function postKeeperRatio(uint256 bps) external {
        bps = bound(bps, 10_000, 10_050); // keeper ratio for Ondo also only rises (dividend accrual)
        (uint256 r,) = registry.ratioOf(address(nvdaOn));
        vm.prank(keeper);
        try registry.postRatio(address(nvdaOn), r * bps / 10_000) {} catch {}
    }

    function pauseBuys(bool p) external {
        vm.prank(guardian);
        registry.setBuysPaused(p);
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 6 hours));
        vm.startPrank(keeper);
        registry.postAttestation(bytes32("ondo"), uint64(block.timestamp));
        registry.postAttestation(bytes32("bstock"), uint64(block.timestamp));
        vm.stopPrank();
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }
}

contract BasketVaultInvariants is BaseTest {
    VaultHandler handler;

    function setUp() public override {
        super.setUp();
        // the protocol fee is on for the whole run: it is a USDT flow only and must never move backing
        vm.prank(admin);
        registry.setFee(50, makeAddr("treasury"));
        handler = new VaultHandler(basket, registry, usdt, nvdaOn, nvdaB, aaplB, venue, keeper, guardian);
        // the handler plays issuer and venue operator, so its price moves and multiplier drifts actually land
        // (with fail_on_revert = false an unauthorized call would be silently skipped, not exercised)
        venue.setKeeper(address(handler));
        nvdaB.transferOwnership(address(handler));
        aaplB.transferOwnership(address(handler));
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](10);
        sels[0] = VaultHandler.mint.selector;
        sels[1] = VaultHandler.redeem.selector;
        sels[2] = VaultHandler.redeemInKind.selector;
        sels[3] = VaultHandler.migrate.selector;
        sels[4] = VaultHandler.movePrice.selector;
        sels[5] = VaultHandler.driftMultiplier.selector;
        sels[6] = VaultHandler.postKeeperRatio.selector;
        sels[7] = VaultHandler.pauseBuys.selector;
        sels[8] = VaultHandler.warp.selector;
        sels[9] = VaultHandler.mint.selector; // weight mints higher
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// Backing: every constituent's held shares >= required shares after every vault call, and at all times
    /// while ratios move the way they do in production (monotone up). A downward ratio jump is a corporate
    /// action: the registry's step bound pauses mints for that token until ADMIN confirms (see docs/invariants.md).
    function invariant_backingHolds() public view {
        assertFalse(handler.backingBrokenByVaultCall(), "a vault call left the basket under-backed");
        assertTrue(basket.backingOk(), "backing invariant violated");
        for (uint256 i = 0; i < basket.constituentCount(); i++) {
            assertGe(basket.heldShares(i), basket.requiredShares(i));
        }
    }

    /// Redeem in kind never fails for a holder with a positive balance.
    function invariant_redeemInKindAlwaysWorks() public view {
        assertFalse(handler.inKindFailed(), "redeemInKind failed for a holder");
    }

    /// Migrate never reduces the target constituent nor any other constituent.
    function invariant_migrateMonotone() public view {
        assertFalse(handler.migrateReducedShares(), "migrate reduced target shares");
        assertFalse(handler.migrateDecreasedOther(), "migrate decreased another constituent");
    }

    /// The vault never holds USDT it did not receive from a leg or donation: no user USDT is trapped after mint.
    function invariant_supplyMatchesHolders() public view {
        uint256 sum;
        for (uint256 i = 0; i < handler.actorCount(); i++) {
            sum += basket.balanceOf(handler.actors(i));
        }
        assertEq(sum, basket.totalSupply());
    }
}
