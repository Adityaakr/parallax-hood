// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LegExecutor} from "../libraries/LegExecutor.sol";

interface IBasketVault {
    struct Constituent {
        bytes32 underlyingId;
        uint256 sharesPerUnit; // 1e18-scaled shares per 1e18 basket units
        uint16 maxIssuerBps; // 10_000 = no cap
    }

    struct RepresentationView {
        address token;
        bytes32 platformId;
        uint256 tokens;
        uint256 shares;
        uint16 shareBps; // share of the constituent's held shares, in bps
        bool buyEligible;
    }

    struct ConstituentView {
        bytes32 underlyingId;
        uint256 sharesPerUnit;
        uint256 requiredShares;
        uint256 heldShares;
        uint16 maxIssuerBps;
        RepresentationView[] representations;
    }

    function mint(
        uint256 units,
        uint256 maxUsdgIn,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external returns (uint256 usdgSpent);
    function redeem(
        uint256 units,
        uint256 minUsdgOut,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external returns (uint256 usdgOut);
    function redeemInKind(uint256 units, address recipient) external;
    function migrate(bytes32 underlyingId, LegExecutor.Leg[] calldata legs, uint256 minShareGain, bytes32 quoteHash)
        external
        returns (uint256 shareGain);
    function composition() external view returns (ConstituentView[] memory);
    function constituents() external view returns (Constituent[] memory);
    function heldShares(uint256 i) external view returns (uint256);
    function constituentCount() external view returns (uint256);
    function backingOk() external view returns (bool);
}
