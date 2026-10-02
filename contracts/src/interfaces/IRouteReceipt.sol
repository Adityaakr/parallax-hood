// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IRouteReceipt
/// @notice One receipt per representation filled. `quoteHash` links to the resolver's scoring record
///         (GET /quotes/:hash) so every onchain fill has a retrievable "why".
interface IRouteReceipt {
    /// @dev action: 0 buy, 1 sell, 2 mint, 3 redeem, 4 migrate
    event RouteReceipt(
        bytes32 indexed quoteHash,
        address indexed actor,
        bytes32 indexed underlyingId,
        address tokenIn,
        uint256 amountIn,
        address representation,
        uint256 tokensOut,
        uint256 sharesOut,
        uint256 ratio,
        uint64 attestedAt,
        uint8 action
    );
}
