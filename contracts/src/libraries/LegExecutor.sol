// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title LegExecutor
/// @notice Executes one swap "leg" against an allowlisted target and trusts only balance deltas.
///         Pattern: forceApprove(tokenIn, target, maxIn) -> snapshot -> call -> approve 0 -> deltas.
///         No delegatecall. Callers must check the allowlist and token semantics before calling.
library LegExecutor {
    using SafeERC20 for IERC20;

    struct Leg {
        address target; // allowlisted router (Uniswap v3 SwapRouter02)
        bytes data; // calldata for the router; recipient inside must be the executing contract
        address tokenIn;
        uint256 maxIn; // hard cap on tokenIn spent by this leg
        address tokenOut;
    }

    error LegOverspent(uint256 spent, uint256 maxIn);
    error LegNothingReceived();
    error LegCallFailed(bytes reason);
    error LegSameToken();

    /// @dev Execute a leg. Returns (spent, received) measured by balance deltas on `address(this)`.
    function execute(Leg memory leg) internal returns (uint256 spent, uint256 received) {
        if (leg.tokenIn == leg.tokenOut) revert LegSameToken();
        IERC20 tokenIn = IERC20(leg.tokenIn);
        IERC20 tokenOut = IERC20(leg.tokenOut);

        uint256 inBefore = tokenIn.balanceOf(address(this));
        uint256 outBefore = tokenOut.balanceOf(address(this));

        tokenIn.forceApprove(leg.target, leg.maxIn);
        (bool ok, bytes memory ret) = leg.target.call(leg.data);
        if (!ok) revert LegCallFailed(ret);
        tokenIn.forceApprove(leg.target, 0);

        uint256 inAfter = tokenIn.balanceOf(address(this));
        uint256 outAfter = tokenOut.balanceOf(address(this));

        // A router that *sends us* tokenIn (weird but possible) counts as zero spent.
        spent = inBefore > inAfter ? inBefore - inAfter : 0;
        if (spent > leg.maxIn) revert LegOverspent(spent, leg.maxIn);
        received = outAfter > outBefore ? outAfter - outBefore : 0;
        if (received == 0) revert LegNothingReceived();
    }
}
