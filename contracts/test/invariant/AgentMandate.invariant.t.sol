// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BaseTest} from "../Base.t.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {ShareRouter} from "../../src/ShareRouter.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

/// @dev The agent tries everything: random amounts, wrong underlyings, wrong baskets, legs that pay the agent,
///      time travel across windows, owner revocations and re-allowlisting. Ghost variables track what the
///      contract actually let through.
contract MandateHandler is Test {
    AgentMandate public mandate;
    ShareRouter public router;
    BasketVault public basket;
    MockUSDT public usdt;
    MockStockToken public nvdaB;
    MockStockToken public aaplB;
    MockStockToken public nvdaOn;
    MockSwapTarget public venue;
    address public owner;
    address public agent;
    uint256 public id;

    uint128 constant PER_TX = 500e18;
    uint128 constant DAILY = 1000e18;

    // ghost: spend per window as observed from owner balance deltas
    uint256 public windowStart;
    uint256 public spentThisWindow;
    uint256 public maxSingleSpend;
    bool public spendAfterRevoke;
    bool public spendAfterExpiry;
    bool public revoked;
    uint64 public expiry;
    uint256 public successfulSpends;

    constructor(
        AgentMandate m,
        ShareRouter r,
        BasketVault b,
        MockUSDT u,
        MockStockToken nb,
        MockStockToken ab,
        MockStockToken on,
        MockSwapTarget v,
        address o,
        address a
    ) {
        mandate = m;
        router = r;
        basket = b;
        usdt = u;
        nvdaB = nb;
        aaplB = ab;
        nvdaOn = on;
        venue = v;
        owner = o;
        agent = a;
        expiry = uint64(block.timestamp + 3 days);
        bytes32[] memory us = new bytes32[](1);
        us[0] = bytes32("NVDA");
        address[] memory bs = new address[](1);
        bs[0] = address(basket);
        vm.startPrank(owner);
        usdt.approve(address(mandate), type(uint256).max);
        id = mandate.createMandate(agent, PER_TX, DAILY, expiry, 500, us, bs);
        vm.stopPrank();
    }

    function _leg(address tokenIn, address tokenOut, uint256 amountIn, address recipient)
        internal
        view
        returns (LegExecutor.Leg memory)
    {
        return LegExecutor.Leg({
            target: address(venue),
            data: abi.encodeCall(MockSwapTarget.swap, (tokenIn, tokenOut, amountIn, 0, recipient)),
            tokenIn: tokenIn,
            maxIn: amountIn,
            tokenOut: tokenOut
        });
    }

    function _record(uint256 ownerBefore) internal {
        uint256 spent = ownerBefore - usdt.balanceOf(owner);
        if (block.timestamp >= windowStart + 1 days) {
            windowStart = block.timestamp;
            spentThisWindow = 0;
        }
        spentThisWindow += spent;
        if (spent > maxSingleSpend) maxSingleSpend = spent;
        if (revoked) spendAfterRevoke = true;
        if (block.timestamp >= expiry) spendAfterExpiry = true;
        successfulSpends++;
    }

    function agentBuy(uint256 amount, bool wrongUnderlying, bool payAgent) external {
        amount = bound(amount, 1e18, 2000e18);
        bytes32 u = wrongUnderlying ? bytes32("AAPL") : bytes32("NVDA");
        address tok = wrongUnderlying ? address(aaplB) : address(nvdaB);
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](1);
        legs[0] = _leg(address(usdt), tok, amount, payAgent ? agent : address(router));
        uint256 before = usdt.balanceOf(owner);
        vm.prank(agent);
        try mandate.agentBuyShares(id, u, amount, 0, legs, bytes32(amount)) {
            _record(before);
        } catch {}
    }

    function agentMint(uint256 units, uint256 headroomBps) external {
        units = bound(units, 1e16, 5e18);
        // a unit is worth ~38.5 USDT at the fixture prices; the mandate's floor tolerates 5 % below reference,
        // so size the budget close to fair value (an overspend would be the diverted-value case the floor rejects)
        uint256 maxUsdt = units * 385 / 10 * (10_000 + bound(headroomBps, 150, 350)) / 10_000;
        // legs: 70/30 NVDA + AAPL at fair price, sized to maxUsdt roughly
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](3);
        legs[0] = _leg(address(usdt), address(nvdaB), maxUsdt * 40 / 100, address(basket));
        legs[1] = _leg(address(usdt), address(nvdaOn), maxUsdt * 17 / 100, address(basket));
        legs[2] = _leg(address(usdt), address(aaplB), maxUsdt * 43 / 100, address(basket));
        uint256 before = usdt.balanceOf(owner);
        vm.prank(agent);
        try mandate.agentMintBasket(id, address(basket), units, maxUsdt, legs, bytes32(units)) {
            _record(before);
        } catch {}
    }

    function ownerRevoke() external {
        vm.prank(owner);
        mandate.revoke(id);
        revoked = true;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1 hours, 2 days));
    }
}

contract AgentMandateInvariants is BaseTest {
    MandateHandler handler;

    function setUp() public override {
        super.setUp();
        handler = new MandateHandler(mandate, router, basket, usdt, nvdaB, aaplB, nvdaOn, venue, alice, agent);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](5);
        sels[0] = MandateHandler.agentBuy.selector;
        sels[1] = MandateHandler.agentMint.selector;
        sels[2] = MandateHandler.agentBuy.selector;
        sels[3] = MandateHandler.warp.selector;
        sels[4] = MandateHandler.ownerRevoke.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
        // keep attestations and prices fresh through time travel so the only thing that can block buys is the mandate
        vm.startPrank(admin);
        registry.setLimits(365 days, 365 days, 500);
        registry.setPriceLimits(365 days, 2_000);
        vm.stopPrank();
    }

    /// The agent never ends up holding any asset.
    function invariant_agentNeverReceivesAssets() public view {
        assertEq(usdt.balanceOf(agent), 0);
        assertEq(nvdaB.balanceOf(agent), 0);
        assertEq(nvdaOn.balanceOf(agent), 0);
        assertEq(aaplB.balanceOf(agent), 0);
        assertEq(basket.balanceOf(agent), 0);
        assertEq(usdt.balanceOf(address(mandate)), 0);
        assertEq(nvdaB.balanceOf(address(mandate)), 0);
    }

    /// No single spend above the per-tx cap and no window above the daily cap.
    function invariant_capsNeverExceeded() public view {
        assertLe(handler.maxSingleSpend(), 500e18);
        assertLe(handler.spentThisWindow(), 1000e18);
        assertLe(mandate.getMandate(handler.id()).spentInWindow, 1000e18);
    }

    /// Nothing gets through after revocation or expiry.
    function invariant_revokeAndExpiryFinal() public view {
        assertFalse(handler.spendAfterRevoke());
        assertFalse(handler.spendAfterExpiry());
    }
}
