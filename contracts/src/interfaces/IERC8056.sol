// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC8056
/// @notice View surface of ERC-8056 "Scaled UI Amount" tokens as Robinhood Chain stock tokens expose it.
///         ERC-20 balances and supply are raw units and never rebase; `uiMultiplier()` (1e18 scale) converts a
///         raw amount to underlying shares. A corporate action scheduled ahead of time is readable as
///         `newUIMultiplier()` taking effect at `effectiveAt()`.
interface IERC8056 {
    function uiMultiplier() external view returns (uint256);
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function balanceOfUI(address account) external view returns (uint256);
    function totalSupplyUI() external view returns (uint256);
}
