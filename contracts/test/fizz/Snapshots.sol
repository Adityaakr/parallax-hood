// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Base} from "./Base.sol";

/// @notice Used to take snapshots of the state before and after a function call
abstract contract Snapshots is Base {
    struct State {
        uint256 supply; // basket totalSupply
        uint256[3] heldShares; // heldShares per constituent index (0 NVDA, 1 AAPL) — slot 2 unused
        uint256 vaultUsdt;
        uint256 routerUsdt;
        uint256 mandateUsdt;
        uint256 feeRecipientUsdt;
        uint256 agentUsdt;
        uint256 agentUnits;
        bool backingOk;
        uint256 platformBstockShares; // bstock's share of heldShares(NVDA) — used by GL-37 / SP-11
    }

    State internal stateBefore;
    State internal stateAfter;

    function _takeSnapshot(State storage state) private {
        state.supply = basket.totalSupply();
        state.heldShares[0] = basket.heldShares(0);
        state.heldShares[1] = basket.heldShares(1);
        state.vaultUsdt = usdt.balanceOf(address(basket));
        state.routerUsdt = usdt.balanceOf(address(router));
        state.mandateUsdt = usdt.balanceOf(address(mandate));
        state.feeRecipientUsdt = usdt.balanceOf(feeRecipient);
        state.agentUsdt = usdt.balanceOf(agent);
        state.agentUnits = basket.balanceOf(agent);
        state.backingOk = basket.backingOk();
        state.platformBstockShares = _sharesHeld(address(nvdaB), address(basket));
    }

    function snapshotBefore() internal {
        _takeSnapshot(stateBefore);
    }

    function snapshotAfter() internal {
        _takeSnapshot(stateAfter);
    }
}
