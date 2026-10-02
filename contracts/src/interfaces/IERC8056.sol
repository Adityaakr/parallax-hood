// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC8056
/// @notice Minimal view surface of ERC-8056 "Scaled UI Amount" tokens (used by Binance bStocks).
///         ERC-20 balances are raw units; `uiMultiplier()` (1e18 scale) converts raw -> UI/share amount.
interface IERC8056 {
    function uiMultiplier() external view returns (uint256);
    function pendingMultiplier() external view returns (uint256 multiplier, uint256 effectiveAtTimestamp);
    function hasPendingMultiplier() external view returns (bool);
    function toUIAmount(uint256 rawAmount) external view returns (uint256);
    function fromUIAmount(uint256 uiAmount) external view returns (uint256);
}
