// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LegExecutor} from "../libraries/LegExecutor.sol";

interface IShareRouter {
    function buyShares(
        bytes32 underlyingId,
        uint256 usdgIn,
        uint256 minShares,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external returns (uint256 sharesOut);

    function sellShares(
        bytes32 underlyingId,
        address representation,
        uint256 tokenAmount,
        uint256 minUsdgOut,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external returns (uint256 usdgOut);
}
