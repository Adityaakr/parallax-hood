// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IStockRegistry} from "./interfaces/IStockRegistry.sol";
import {IShareRouter} from "./interfaces/IShareRouter.sol";
import {ReceiptEmitter} from "./libraries/ReceiptEmitter.sol";
import {LegExecutor} from "./libraries/LegExecutor.sol";

/// @title ShareRouter
/// @notice Executes single-stock buys and sells across representations with slippage protection denominated
///         in underlying shares. Stateless: holds tokens only transiently within a call.
contract ShareRouter is IShareRouter, ReceiptEmitter, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using LegExecutor for LegExecutor.Leg;

    uint8 public constant ACTION_BUY = 0;
    uint8 public constant ACTION_SELL = 1;

    IStockRegistry public immutable registry;
    IERC20 public immutable usdt;

    event BuyExecuted(
        bytes32 indexed quoteHash,
        address indexed actor,
        bytes32 indexed underlyingId,
        uint256 usdtSpent,
        uint256 sharesOut
    );
    event SellExecuted(
        bytes32 indexed quoteHash,
        address indexed actor,
        bytes32 indexed underlyingId,
        uint256 tokensSold,
        uint256 usdtOut
    );

    error TargetNotAllowed(address target);
    error LegTokenInMustBeUsdt(address tokenIn);
    error LegTokenOutMustBeUsdt(address tokenOut);
    error LegTokenInMismatch(address tokenIn);
    error NotBuyEligible(address token);
    error NotSellEligible(address token);
    error WrongUnderlying(address token, bytes32 expected);
    error InsufficientShares(uint256 sharesOut, uint256 minShares);
    error InsufficientUsdtOut(uint256 usdtOut, uint256 minUsdtOut);
    error ZeroAmount();
    error InsufficientForFee(uint256 leftover, uint256 fee);

    event FeeCharged(bytes32 indexed quoteHash, address indexed recipient, uint256 fee);
    error ZeroAddress();
    error NoLegs();
    error OverSpent(uint256 spent, uint256 usdtIn);
    error OverSold(uint256 sold, uint256 tokenAmount);

    constructor(IStockRegistry registry_) {
        registry = registry_;
        usdt = IERC20(registry_.usdt());
    }

    /// @inheritdoc IShareRouter
    function buyShares(
        bytes32 underlyingId,
        uint256 usdtIn,
        uint256 minShares,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external override nonReentrant returns (uint256 sharesOut) {
        if (usdtIn == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (legs.length == 0) revert NoLegs();

        usdt.safeTransferFrom(msg.sender, address(this), usdtIn);
        uint256 usdtBefore = usdt.balanceOf(address(this));

        for (uint256 i = 0; i < legs.length; i++) {
            sharesOut += _executeBuyLeg(legs[i], underlyingId, recipient, quoteHash);
        }

        if (sharesOut < minShares) revert InsufficientShares(sharesOut, minShares);

        uint256 spentTotal = usdtBefore - usdt.balanceOf(address(this));
        if (spentTotal > usdtIn) revert OverSpent(spentTotal, usdtIn);
        // The protocol fee is a share of the notional spent, paid from what the caller sent in; the quote
        // sizes usdtIn to cover it. Refund the rest of *this caller's* deposit only (audit F-5): the router
        // never keeps balances, and whatever else sits here is not the caller's to sweep.
        uint256 refund = usdtIn - spentTotal;
        refund -= _chargeFee(spentTotal, refund, quoteHash);
        if (refund > 0) usdt.safeTransfer(msg.sender, refund);

        emit BuyExecuted(quoteHash, msg.sender, underlyingId, spentTotal, sharesOut);
    }

    /// @inheritdoc IShareRouter
    function sellShares(
        bytes32 underlyingId,
        address representation,
        uint256 tokenAmount,
        uint256 minUsdtOut,
        LegExecutor.Leg[] calldata legs,
        address recipient,
        bytes32 quoteHash
    ) external override nonReentrant returns (uint256 usdtOut) {
        if (tokenAmount == 0) revert ZeroAmount();
        if (recipient == address(0)) revert ZeroAddress();
        if (legs.length == 0) revert NoLegs();
        if (!registry.isSellEligible(representation)) revert NotSellEligible(representation);
        if (registry.underlyingOf(representation) != underlyingId) {
            revert WrongUnderlying(representation, underlyingId);
        }

        IERC20 rep = IERC20(representation);
        rep.safeTransferFrom(msg.sender, address(this), tokenAmount);
        uint256 usdtBefore = usdt.balanceOf(address(this));

        uint256 soldTotal;
        for (uint256 i = 0; i < legs.length; i++) {
            soldTotal += _executeSellLeg(legs[i], underlyingId, representation, quoteHash);
        }

        usdtOut = usdt.balanceOf(address(this)) - usdtBefore;
        usdtOut -= _chargeFee(usdtOut, usdtOut, quoteHash); // minUsdtOut is net of the fee
        if (usdtOut < minUsdtOut) revert InsufficientUsdtOut(usdtOut, minUsdtOut);
        usdt.safeTransfer(recipient, usdtOut);

        // Return the seller's unsold representation tokens: what they deposited minus what the legs sold,
        // never the router's whole balance (audit F-6).
        if (soldTotal > tokenAmount) revert OverSold(soldTotal, tokenAmount);
        uint256 leftover = tokenAmount - soldTotal;
        if (leftover > 0) rep.safeTransfer(msg.sender, leftover);

        emit SellExecuted(quoteHash, msg.sender, underlyingId, soldTotal, usdtOut);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /// @dev Pay the registry's fee on `notional` out of `available`; returns the fee taken (0 when unset).
    function _chargeFee(uint256 notional, uint256 available, bytes32 quoteHash) internal returns (uint256 fee) {
        (uint16 bps, address to) = registry.fee();
        if (bps == 0) return 0;
        fee = (notional * bps) / 10_000;
        if (fee == 0) return 0;
        if (fee > available) revert InsufficientForFee(available, fee);
        usdt.safeTransfer(to, fee);
        emit FeeCharged(quoteHash, to, fee);
    }

    function _executeBuyLeg(LegExecutor.Leg memory leg, bytes32 underlyingId, address recipient, bytes32 quoteHash)
        internal
        returns (uint256 shares)
    {
        if (!registry.isAllowedTarget(leg.target)) revert TargetNotAllowed(leg.target);
        if (leg.tokenIn != address(usdt)) revert LegTokenInMustBeUsdt(leg.tokenIn);
        if (!registry.isBuyEligible(leg.tokenOut)) revert NotBuyEligible(leg.tokenOut);
        if (registry.underlyingOf(leg.tokenOut) != underlyingId) revert WrongUnderlying(leg.tokenOut, underlyingId);

        (uint256 spent, uint256 received) = leg.execute();
        shares = registry.sharesForTokens(leg.tokenOut, received);
        IERC20(leg.tokenOut).safeTransfer(recipient, received);
        _emitRouteReceipt(
            registry,
            Receipt({
                quoteHash: quoteHash,
                underlyingId: underlyingId,
                tokenIn: address(usdt),
                amountIn: spent,
                representation: leg.tokenOut,
                tokensOut: received,
                action: ACTION_BUY
            })
        );
    }

    function _executeSellLeg(
        LegExecutor.Leg memory leg,
        bytes32 underlyingId,
        address representation,
        bytes32 quoteHash
    ) internal returns (uint256 spent) {
        if (!registry.isAllowedTarget(leg.target)) revert TargetNotAllowed(leg.target);
        if (leg.tokenIn != representation) revert LegTokenInMismatch(leg.tokenIn);
        if (leg.tokenOut != address(usdt)) revert LegTokenOutMustBeUsdt(leg.tokenOut);

        (spent,) = leg.execute();
        _emitRouteReceipt(
            registry,
            Receipt({
                quoteHash: quoteHash,
                underlyingId: underlyingId,
                tokenIn: representation,
                amountIn: spent,
                representation: representation,
                tokensOut: spent,
                action: ACTION_SELL
            })
        );
    }
}
