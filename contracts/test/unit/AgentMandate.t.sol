// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

contract AgentMandateTest is BaseTest {
    bytes32 constant QH = keccak256("agent-quote");
    uint256 id;

    function setUp() public override {
        super.setUp();
        bytes32[] memory u = new bytes32[](1);
        u[0] = NVDA;
        address[] memory b = new address[](1);
        b[0] = address(basket);
        vm.startPrank(alice);
        usdg.approve(address(mandate), type(uint256).max);
        id = mandate.createMandate(agent, 500e6, 1000e6, uint64(block.timestamp + 7 days), 300, u, b);
        vm.stopPrank();
    }

    function _buyLegs(uint256 usdgIn) internal view returns (LegExecutor.Leg[] memory) {
        return _legs1(_leg(address(usdg), address(nvdaB), usdgIn, address(router)));
    }

    function test_create_storesMandate() public view {
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        assertEq(m.owner, alice);
        assertEq(m.agent, agent);
        assertEq(m.perTxCapUsdg, 500e6);
        assertEq(m.dailyCapUsdg, 1000e6);
        assertTrue(m.active);
        assertTrue(mandate.allowedUnderlying(id, NVDA));
        assertFalse(mandate.allowedUnderlying(id, AAPL));
        assertTrue(mandate.allowedBasket(id, address(basket)));
        assertEq(mandate.mandatesOfOwner(alice)[0], id);
        assertEq(mandate.mandatesOfAgent(agent)[0], id);
        assertEq(mandate.remainingDaily(id), 1000e6);
        assertEq(mandate.nextId(), 2);
    }

    function test_create_reverts() public {
        bytes32[] memory u = new bytes32[](0);
        address[] memory b = new address[](0);
        vm.startPrank(alice);
        vm.expectRevert(AgentMandate.ZeroAddress.selector);
        mandate.createMandate(address(0), 1, 1, uint64(block.timestamp + 1), 300, u, b);
        vm.expectRevert(AgentMandate.BadCaps.selector);
        mandate.createMandate(agent, 0, 1, uint64(block.timestamp + 1), 300, u, b);
        vm.expectRevert(AgentMandate.BadCaps.selector);
        mandate.createMandate(agent, 2, 1, uint64(block.timestamp + 1), 300, u, b);
        vm.expectRevert(AgentMandate.BadExpiry.selector);
        mandate.createMandate(agent, 1, 1, uint64(block.timestamp), 300, u, b);
        vm.stopPrank();
    }

    function test_agentBuy_outputGoesToOwner() public {
        uint256 ownerUsdg = usdg.balanceOf(alice);
        vm.prank(agent);
        uint256 shares = mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
        assertGt(shares, 0);
        assertGt(nvdaB.balanceOf(alice), 0);
        assertEq(nvdaB.balanceOf(agent), 0);
        assertEq(nvdaB.balanceOf(address(mandate)), 0);
        assertEq(usdg.balanceOf(address(mandate)), 0);
        assertEq(usdg.balanceOf(alice), ownerUsdg - 100e6);
        assertEq(mandate.remainingDaily(id), 900e6);
        assertEq(mandate.getMandate(id).spentInWindow, 100e6);
    }

    function test_agentBuy_refundGoesToOwner() public {
        uint256 ownerUsdg = usdg.balanceOf(alice);
        // authorize 200, legs only spend 100 -> 100 refunded to owner, 100 counted as spent
        vm.prank(agent);
        mandate.agentBuyShares(id, NVDA, 200e6, 0, _buyLegs(100e6), QH);
        assertEq(usdg.balanceOf(alice), ownerUsdg - 100e6);
        assertEq(mandate.getMandate(id).spentInWindow, 100e6);
    }

    /// @dev Audit F-2: the agent supplies the leg calldata and minShares. Routing the swap output to itself
    ///      with a dust minShares used to pass every mandate check; the reference-price floor rejects it.
    function test_agentBuy_cannotDivertOutputBelowFloor() public {
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](2);
        // 1 % of the budget buys for the owner (so the leg "receives" something); 99 % is paid out to the agent
        legs[0] = _leg(address(usdg), address(nvdaB), 1e6, address(router));
        legs[1] = _leg(address(usdg), address(nvdaB), 99e6, agent);
        vm.prank(agent);
        vm.expectRevert(); // legs[1] receives nothing at the router -> LegNothingReceived; and the floor would catch it
        mandate.agentBuyShares(id, NVDA, 100e6, 1, legs, QH);

        // single leg that "swaps" at a terrible price: venue keeps half -> far below the 3 % allowance
        venue.setMode(MockSwapTarget.Mode.SKIM_HALF, "");
        vm.prank(agent);
        vm.expectRevert(); // SharesBelowFloor
        mandate.agentBuyShares(id, NVDA, 100e6, 1, _buyLegs(100e6), QH);
        venue.setMode(MockSwapTarget.Mode.NORMAL, "");
        assertEq(nvdaB.balanceOf(agent), 0);
        assertEq(mandate.getMandate(id).spentInWindow, 0);

        // fair execution passes: the floor is the reference price less the allowance
        vm.prank(agent);
        uint256 shares = mandate.agentBuyShares(id, NVDA, 100e6, 1, _buyLegs(100e6), QH);
        assertGe(shares, mandate.sharesFloor(id, NVDA, 100e6));
    }

    function test_agentBuy_blockedByStaleReferencePrice() public {
        vm.warp(block.timestamp + 37 hours);
        vm.startPrank(keeper);
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        registry.postAttestation(ONDO, uint64(block.timestamp));
        vm.stopPrank();
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.StaleReferencePrice.selector, NVDA));
        mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
        // the owner's own trade is unaffected
        vm.startPrank(alice);
        usdg.approve(address(router), 100e6);
        router.buyShares(NVDA, 100e6, 0, _buyLegs(100e6), alice, QH);
        vm.stopPrank();
    }

    function test_create_rejectsBadSlippage() public {
        bytes32[] memory u = new bytes32[](0);
        address[] memory b = new address[](0);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.BadSlippage.selector, 0));
        mandate.createMandate(agent, 1, 1, uint64(block.timestamp + 1), 0, u, b);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.BadSlippage.selector, 2_001));
        mandate.createMandate(agent, 1, 1, uint64(block.timestamp + 1), 2_001, u, b);
        vm.stopPrank();
        assertEq(mandate.getMandate(id).maxSlippageBps, 300);
    }

    /// @dev Audit F-3: USDG that reaches the shared mandate contract by other means is neither swept to the next
    ///      owner nor counted against their window.
    function test_settle_doesNotSweepStrayBalance() public {
        usdg.mint(address(mandate), 1_000e6);
        uint256 ownerUsdg = usdg.balanceOf(alice);
        vm.prank(agent);
        mandate.agentBuyShares(id, NVDA, 200e6, 0, _buyLegs(100e6), QH);
        assertEq(usdg.balanceOf(alice), ownerUsdg - 100e6); // only the unspent 100 came back
        assertEq(usdg.balanceOf(address(mandate)), 1_000e6);
        assertEq(mandate.getMandate(id).spentInWindow, 100e6);
    }

    function test_agentBuy_perTxCap() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.PerTxCapExceeded.selector, 501e6, 500e6));
        mandate.agentBuyShares(id, NVDA, 501e6, 0, _buyLegs(501e6), QH);
    }

    function test_agentBuy_dailyCapAndWindowReset() public {
        vm.startPrank(agent);
        mandate.agentBuyShares(id, NVDA, 500e6, 0, _buyLegs(500e6), QH);
        mandate.agentBuyShares(id, NVDA, 400e6, 0, _buyLegs(400e6), QH);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.DailyCapExceeded.selector, 200e6, 100e6));
        mandate.agentBuyShares(id, NVDA, 200e6, 0, _buyLegs(200e6), QH);
        assertEq(mandate.remainingDaily(id), 100e6);
        vm.warp(block.timestamp + 1 days);
        assertEq(mandate.remainingDaily(id), 1000e6);
        mandate.agentBuyShares(id, NVDA, 500e6, 0, _buyLegs(500e6), QH);
        assertEq(mandate.remainingDaily(id), 500e6);
        vm.stopPrank();
    }

    function test_agentBuy_underlyingNotAllowed() public {
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.UnderlyingNotAllowed.selector, AAPL));
        mandate.agentBuyShares(
            id, AAPL, 100e6, 0, _legs1(_leg(address(usdg), address(aaplB), 100e6, address(router))), QH
        );
        // owner can allow it
        vm.prank(alice);
        mandate.setAllowedUnderlying(id, AAPL, true);
        vm.prank(agent);
        mandate.agentBuyShares(
            id, AAPL, 100e6, 0, _legs1(_leg(address(usdg), address(aaplB), 100e6, address(router))), QH
        );
        assertGt(aaplB.balanceOf(alice), 0);
    }

    function test_agentBuy_onlyAgent() public {
        vm.prank(bob);
        vm.expectRevert(AgentMandate.NotAgent.selector);
        mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
        vm.prank(alice); // even the owner cannot use the agent path
        vm.expectRevert(AgentMandate.NotAgent.selector);
        mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
    }

    function test_agentBuy_expiry() public {
        vm.warp(block.timestamp + 7 days);
        vm.prank(agent);
        vm.expectRevert(AgentMandate.MandateExpired.selector);
        mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
        assertEq(mandate.remainingDaily(id), 0);
    }

    function test_revoke_isInstant() public {
        vm.prank(bob);
        vm.expectRevert(AgentMandate.NotOwner.selector);
        mandate.revoke(id);
        vm.prank(alice);
        mandate.revoke(id);
        assertFalse(mandate.getMandate(id).active);
        assertEq(mandate.remainingDaily(id), 0);
        vm.prank(agent);
        vm.expectRevert(AgentMandate.MandateInactive.selector);
        mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
    }

    function test_setAllowed_onlyOwner() public {
        vm.startPrank(bob);
        vm.expectRevert(AgentMandate.NotOwner.selector);
        mandate.setAllowedUnderlying(id, AAPL, true);
        vm.expectRevert(AgentMandate.NotOwner.selector);
        mandate.setAllowedBasket(id, address(0x1), true);
        vm.stopPrank();
        vm.prank(alice);
        mandate.setAllowedBasket(id, address(basket), false);
        assertFalse(mandate.allowedBasket(id, address(basket)));
    }

    function test_agentMintBasket() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        uint256 ownerUsdg = usdg.balanceOf(alice);
        vm.prank(agent);
        uint256 spent = mandate.agentMintBasket(id, address(basket), 1e18, maxUsdg, legs, QH);
        assertEq(basket.balanceOf(alice), 1e18);
        assertEq(basket.balanceOf(agent), 0);
        assertEq(usdg.balanceOf(alice), ownerUsdg - spent);
        assertEq(usdg.balanceOf(address(mandate)), 0);
        assertEq(mandate.getMandate(id).spentInWindow, spent);
        assertTrue(basket.backingOk());
    }

    function test_agentMintBasket_notAllowed() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(1e18);
        vm.prank(alice);
        mandate.setAllowedBasket(id, address(basket), false);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.BasketNotAllowed.selector, address(basket)));
        mandate.agentMintBasket(id, address(basket), 1e18, maxUsdg, legs, QH);
    }

    function test_agentMintBasket_capAppliesToMaxUsdg() public {
        (LegExecutor.Leg[] memory legs,) = _mintLegs(1e18);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.PerTxCapExceeded.selector, 600e6, 500e6));
        mandate.agentMintBasket(id, address(basket), 1e18, 600e6, legs, QH);
    }

    function test_agent_cannotRedirectRecipient() public {
        // The agent controls the leg calldata; a leg whose swap recipient is the agent yields nothing for the
        // router (balance delta 0) and reverts. Assets can only ever land with the owner.
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdg), address(nvdaB), 100e6, agent));
        vm.prank(agent);
        vm.expectRevert(LegExecutor.LegNothingReceived.selector);
        mandate.agentBuyShares(id, NVDA, 100e6, 0, legs, QH);
        assertEq(nvdaB.balanceOf(agent), 0);
    }
}
