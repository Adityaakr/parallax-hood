// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with AgentMandate. Actors are owners; one shared `agent` key executes.
abstract contract AgentMandateHandler is Properties {
    uint256[] internal mandateIds;

    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    function agentMandate_createMandate_clamped(
        uint128 perTxCap,
        uint128 dailyCap,
        uint32 days_,
        uint16 slippageBps,
        bool allowNvda,
        bool allowAapl,
        bool allowBasket
    ) public {
        perTxCap = uint128(clampBetween(perTxCap, 1e18, 20_000e18));
        dailyCap = uint128(clampBetween(dailyCap, perTxCap, 100_000e18));
        days_ = uint32(clampBetween(days_, 1, 60));
        slippageBps = uint16(clampBetween(slippageBps, 1, 2_000));
        agentMandate_createMandate(perTxCap, dailyCap, uint64(block.timestamp + uint256(days_) * 1 days), slippageBps, allowNvda, allowAapl, allowBasket);
    }

    /// @dev Agent buys within the per-tx cap at fair execution.
    function agentMandate_agentBuyShares_clamped(uint256 idSeed, uint256 usdtIn, uint8 repSeed, uint8 shape) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        uint256 room = mandate.remainingDaily(id);
        if (room > m.perTxCapUsdt) room = m.perTxCapUsdt;
        if (room < 1e18) return;
        usdtIn = clampBetween(usdtIn, 1e18, room);
        agentMandate_agentBuyShares(id, usdtIn, 0, repSeed, shape % 4);
    }

    /// @dev Agent mints basket units with a budget close to fair value (the floor rejects overspends).
    function agentMandate_agentMintBasket_clamped(uint256 idSeed, uint256 units, uint16 bstockBps) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        units = clampBetween(units, 0.01e18, 20e18);
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, uint16(clampBetween(bstockBps, 0, BPS)));
        agentMandate_agentMintBasket(id, units, maxUsdt, legs);
    }

    /// @dev Adversarial agent: asks for far more units than the budget buys, or far fewer (value left in the
    ///      vault for other holders); both must be refused by the vault or the floor.
    function agentMandate_agentMintBasket_wrongUnits(uint256 idSeed, uint256 units, bool tooMany) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        units = clampBetween(units, 0.1e18, 10e18);
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, 7_000);
        agentMandate_agentMintBasket(id, tooMany ? units * 2 : units / 2, maxUsdt, legs);
    }

    function agentMandate_secondary(uint8 selector, uint256 idSeed, bool flag, bool nvda) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        selector = uint8(selector % 3);
        if (selector == 0) _agentMandate_revoke(id);
        else if (selector == 1) _agentMandate_setAllowedUnderlying(id, nvda ? NVDA : AAPL, flag);
        else _agentMandate_setAllowedBasket(id, address(basket), flag);
    }

    /// @notice SP-07: drive a mandate to its per-tx/daily cap, then confirm the owner's revoke still succeeds
    ///         instantly.
    function agentMandate_revoke_atMaxUtilization(uint256 idSeed) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        if (m.active) {
            uint256 room = mandate.remainingDaily(id);
            if (room > m.perTxCapUsdt) room = m.perTxCapUsdt;
            if (room >= 1e18) {
                address rep = reps[0];
                bytes32 uid = registry.underlyingOf(rep);
                if (mandate.allowedUnderlying(id, uid) && registry.isBuyEligible(rep) && usdt.balanceOf(m.owner) >= room) {
                    LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), rep, _notional(room), address(router)));
                    vm.prank(agent);
                    try mandate.agentBuyShares(id, uid, room, 0, legs, keccak256(abi.encode("SP07", id, room, block.timestamp)))
                    {} catch {}
                }
            }
        }
        address owner = mandate.getMandate(id).owner;
        vm.prank(owner);
        try mandate.revoke(id) {
            _recordMandateRevocation(id);
            _prop_revokeSucceedsAtMaxUtilization(id);
        } catch {
            t(false, "SP-07: owner revoke must never revert, even at cap/expiry/mid-window");
        }
    }

    /// @notice SP-08: no agentBuyShares call succeeds on a mandate id after it was revoked.
    function agentMandate_agentBuyShares_afterRevoke(uint256 idSeed, uint256 usdtIn, uint8 repSeed) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        if (m.active) {
            vm.prank(m.owner);
            mandate.revoke(id);
        }
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        usdtIn = clampBetween(usdtIn, 1e18, 1_000e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), rep, _notional(usdtIn), address(router)));
        uint256 ownerUsdtBefore = usdt.balanceOf(m.owner);
        bool succeeded;
        vm.prank(agent);
        try mandate.agentBuyShares(id, uid, usdtIn, 0, legs, keccak256(abi.encode("SP08", id, usdtIn, block.timestamp))) {
            succeeded = true;
        } catch {}
        _prop_agentCannotSpendAfterRevoke(succeeded, ownerUsdtBefore, m.owner);
    }

    /// @notice SP-14: only a mandate's designated agent can call agentBuyShares on it; a reverted impostor call
    ///         pulls no USDT from the owner.
    function agentMandate_agentBuyShares_wrongCaller(uint256 idSeed, uint256 usdtIn, uint8 repSeed, uint256 callerSeed)
        public
    {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        address impostor = toActorNotCurrent(address(uint160(callerSeed)));
        if (impostor == m.agent) return;
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        usdtIn = clampBetween(usdtIn, 1e18, 1_000e18);
        LegExecutor.Leg[] memory legs = _legs1(_leg(address(usdt), rep, _notional(usdtIn), address(router)));
        uint256 ownerUsdtBefore = usdt.balanceOf(m.owner);
        bool succeeded;
        vm.prank(impostor);
        try mandate.agentBuyShares(id, uid, usdtIn, 0, legs, keccak256(abi.encode("SP14", id, usdtIn, block.timestamp))) {
            succeeded = true;
        } catch {}
        _prop_nonAgentCannotSpendMandate(succeeded, ownerUsdtBefore, m.owner);
    }

    /// @notice SP-15: only a mandate's owner can call revoke/setAllowedUnderlying/setAllowedBasket on it
    ///         (including the mandate's own agent).
    function agentMandate_ownerFn_wrongCaller(uint256 idSeed, uint256 callerSeed, uint8 selector, bool flag) public {
        if (mandateIds.length == 0) return;
        uint256 id = mandateIds[idSeed % mandateIds.length];
        address owner = mandate.getMandate(id).owner;
        address impostor = toActorNotCurrent(address(uint160(callerSeed)));
        if (impostor == owner) impostor = agent; // agent is never a mandate's owner: guarantees a true impostor
        selector = uint8(selector % 3);
        bool activeBefore = mandate.getMandate(id).active;
        bool underlyingBefore = mandate.allowedUnderlying(id, NVDA);
        bool basketBefore = mandate.allowedBasket(id, address(basket));
        bool succeeded;
        vm.prank(impostor);
        if (selector == 0) {
            try mandate.revoke(id) {
                succeeded = true;
            } catch {}
            eq(mandate.getMandate(id).active ? 1 : 0, activeBefore ? 1 : 0, "SP-15: impostor changed the active flag");
        } else if (selector == 1) {
            try mandate.setAllowedUnderlying(id, NVDA, flag) {
                succeeded = true;
            } catch {}
            eq(
                mandate.allowedUnderlying(id, NVDA) ? 1 : 0,
                underlyingBefore ? 1 : 0,
                "SP-15: impostor changed the underlying allowlist"
            );
        } else {
            try mandate.setAllowedBasket(id, address(basket), flag) {
                succeeded = true;
            } catch {}
            eq(
                mandate.allowedBasket(id, address(basket)) ? 1 : 0,
                basketBefore ? 1 : 0,
                "SP-15: impostor changed the basket allowlist"
            );
        }
        _prop_nonOwnerCannotControlMandate(succeeded);
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function agentMandate_createMandate(
        uint128 perTxCap,
        uint128 dailyCap,
        uint64 expiry,
        uint16 slippageBps,
        bool allowNvda,
        bool allowAapl,
        bool allowBasket
    ) public asActor {
        uint256 n = (allowNvda ? 1 : 0) + (allowAapl ? 1 : 0);
        bytes32[] memory us = new bytes32[](n);
        uint256 k;
        if (allowNvda) us[k++] = NVDA;
        if (allowAapl) us[k] = AAPL;
        address[] memory bs = new address[](allowBasket ? 1 : 0);
        if (allowBasket) bs[0] = address(basket);
        uint256 id = mandate.createMandate(agent, perTxCap, dailyCap, expiry, slippageBps, us, bs);
        mandateIds.push(id);
        _recordMandateCreation(id);
        _prop_createMandate(id, perTxCap, dailyCap, expiry, slippageBps);
    }

    /// @param shape 0 single leg · 1 split · 2 leg pays the agent (misdirected) · 3 wrong underlying
    function agentMandate_agentBuyShares(uint256 id, uint256 usdtIn, uint256 minShares, uint8 repSeed, uint8 shape)
        public
        asAgent
    {
        address rep = reps[repSeed % reps.length];
        bytes32 uid = registry.underlyingOf(rep);
        LegExecutor.Leg[] memory legs;
        uint256 notional = _notional(usdtIn);
        if (shape == 1 && uid == NVDA) {
            legs = new LegExecutor.Leg[](2);
            legs[0] = _leg(address(usdt), address(nvdaB), notional / 2, address(router));
            legs[1] = _leg(address(usdt), address(nvdaOn), notional - notional / 2, address(router));
        } else if (shape == 2) {
            legs = _legs1(_leg(address(usdt), rep, notional, agent));
        } else if (shape == 3) {
            legs = _legs1(_leg(address(usdt), uid == NVDA ? address(aaplB) : address(nvdaB), notional, address(router)));
        } else {
            legs = _legs1(_leg(address(usdt), rep, notional, address(router)));
        }
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        snapshotBefore();
        uint256 ownerUsdtBefore = usdt.balanceOf(m.owner);
        uint256 ownerSharesBefore = _sharesHeld(rep, m.owner);
        uint256 spentBefore = mandate.getMandate(id).spentInWindow;
        uint256 sharesOut = mandate.agentBuyShares(id, uid, usdtIn, minShares, legs, keccak256(abi.encode(id, usdtIn)));
        snapshotAfter();
        _prop_agentBuy(id, uid, usdtIn, sharesOut, ownerUsdtBefore, ownerSharesBefore, spentBefore, rep);
        _prop_mandateAllowanceResetAfterAgentCall(address(router));
    }

    function agentMandate_agentMintBasket(uint256 id, uint256 units, uint256 maxUsdtIn, LegExecutor.Leg[] memory legs)
        public
        asAgent
    {
        AgentMandate.Mandate memory m = mandate.getMandate(id);
        snapshotBefore();
        uint256 ownerUsdtBefore = usdt.balanceOf(m.owner);
        uint256 ownerUnitsBefore = basket.balanceOf(m.owner);
        uint256 spentBefore = m.spentInWindow;
        uint256 spent = mandate.agentMintBasket(id, address(basket), units, maxUsdtIn, legs, keccak256(abi.encode(id, units)));
        snapshotAfter();
        _prop_agentMint(id, units, maxUsdtIn, spent, ownerUsdtBefore, ownerUnitsBefore, spentBefore);
        _prop_mandateAllowanceResetAfterAgentCall(address(basket));
    }

    function _agentMandate_revoke(uint256 id) internal {
        address owner = mandate.getMandate(id).owner;
        vm.prank(owner);
        mandate.revoke(id);
        _recordMandateRevocation(id);
        _prop_revoked(id);
    }

    function _agentMandate_setAllowedUnderlying(uint256 id, bytes32 underlyingId, bool allowed) internal {
        vm.prank(mandate.getMandate(id).owner);
        mandate.setAllowedUnderlying(id, underlyingId, allowed);
    }

    function _agentMandate_setAllowedBasket(uint256 id, address basket_, bool allowed) internal {
        vm.prank(mandate.getMandate(id).owner);
        mandate.setAllowedBasket(id, basket_, allowed);
    }
}
