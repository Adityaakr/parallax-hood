// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title ShareMath
/// @notice 1e18 fixed-point conversions between token units and underlying shares.
///         `ratio` = underlying shares per 1e18 token units (e.g. 1.003701e18).
///         Mirrored in packages/sdk/src/shareMath.ts — keep both in sync (parity tests exist on both sides).
library ShareMath {
    uint256 internal constant WAD = 1e18;

    /// @dev Shares represented by `tokens` (round down: never over-credit).
    function sharesForTokens(uint256 tokens, uint256 ratio) internal pure returns (uint256) {
        return Math.mulDiv(tokens, ratio, WAD);
    }

    /// @dev Tokens required to represent `shares` (round up: never under-hold).
    function tokensForShares(uint256 shares, uint256 ratio) internal pure returns (uint256) {
        return Math.mulDiv(shares, WAD, ratio, Math.Rounding.Ceil);
    }

    /// @dev Shares required to back `units` of a basket whose unit holds `sharesPerUnit` (round up).
    function requiredShares(uint256 units, uint256 sharesPerUnit) internal pure returns (uint256) {
        return Math.mulDiv(units, sharesPerUnit, WAD, Math.Rounding.Ceil);
    }

    /// @dev Pro-rata slice of `balance` for `units` out of `totalSupply` (round down: vault keeps dust).
    function proRata(uint256 balance, uint256 units, uint256 totalSupply) internal pure returns (uint256) {
        if (totalSupply == 0) return 0;
        return Math.mulDiv(balance, units, totalSupply);
    }

    /// @dev Absolute step between two ratios in bps of the old ratio.
    function stepBps(uint256 oldRatio, uint256 newRatio) internal pure returns (uint256) {
        if (oldRatio == 0) return 0;
        uint256 diff = newRatio > oldRatio ? newRatio - oldRatio : oldRatio - newRatio;
        return Math.mulDiv(diff, 10_000, oldRatio);
    }
}
