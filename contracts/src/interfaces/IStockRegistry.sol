// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IStockRegistry
/// @notice Canonical map of underlyings -> representations, with share ratios, attestation freshness,
///         market state and the swap-target allowlist shared by ShareRouter and BasketVault.
interface IStockRegistry {
    enum RatioSource {
        KEEPER, // ratio posted by KEEPER_ROLE (e.g. Ondo GM tokens)
        ERC8056 // ratio read live from token.uiMultiplier() (e.g. bStocks)
    }

    struct Underlying {
        bytes32 id;
        string ticker;
        bool active;
    }

    struct Representation {
        address token;
        bytes32 underlyingId;
        bytes32 platformId;
        uint8 decimals;
        RatioSource ratioSource;
        bool active; // buyable (subject to freshness)
        bool exists; // registered at all (sellable / countable)
    }

    struct PostedRatio {
        uint256 ratio; // 1e18-scaled underlying shares per token
        uint64 updatedAt;
    }

    struct MarketState {
        bool open;
        uint64 updatedAt;
    }

    struct ReferencePrice {
        uint256 priceUsd; // 1e18-scaled USD per underlying share
        uint64 updatedAt;
    }

    // ---- views used by router / vaults ----
    function usdg() external view returns (address);
    function isAllowedTarget(address target) external view returns (bool);
    function representationsOf(bytes32 underlyingId) external view returns (address[] memory);
    function getRepresentation(address token) external view returns (Representation memory);
    function underlyingOf(address token) external view returns (bytes32);
    function platformOf(address token) external view returns (bytes32);
    function ratioOf(address token) external view returns (uint256 ratio, uint64 updatedAt);
    function sharesForTokens(address token, uint256 amount) external view returns (uint256);
    function tokensForShares(address token, uint256 shares) external view returns (uint256);
    function isBuyEligible(address token) external view returns (bool);
    function isSellEligible(address token) external view returns (bool);
    function attestedAt(bytes32 platformId) external view returns (uint64);
    function marketState(bytes32 underlyingId) external view returns (MarketState memory);
    function buysPaused() external view returns (bool);
    function maxAttestationAge() external view returns (uint64);
    function maxRatioAge() external view returns (uint64);
    function maxRatioStepBps() external view returns (uint16);
    /// @notice USD per share of an underlying, from its Chainlink feed when one is set, else the keeper's post.
    ///         (0, 0) when neither exists. Used by AgentMandate for its execution floor; never for backing.
    function referencePrice(bytes32 underlyingId) external view returns (uint256 priceUsd, uint64 updatedAt);
    function maxPriceAge() external view returns (uint64);
    /// @notice Protocol fee on USDG notional (bps, hard-capped at MAX_FEE_BPS) and where it is paid.
    function fee() external view returns (uint16 bps, address recipient);
    /// @notice Most units a basket may have outstanding; 0 means no cap. Read by BasketVault.mint only: a cap
    ///         can stop new units being minted, never a holder redeeming.
    function supplyCapOf(address basket) external view returns (uint256);
}
