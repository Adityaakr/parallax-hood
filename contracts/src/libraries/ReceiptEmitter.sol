// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRouteReceipt} from "../interfaces/IRouteReceipt.sol";
import {IStockRegistry} from "../interfaces/IStockRegistry.sol";
import {ShareMath} from "./ShareMath.sol";

/// @title ReceiptEmitter
/// @notice Emits RouteReceipt from a memory struct to keep callers' stacks shallow.
abstract contract ReceiptEmitter is IRouteReceipt {
    struct Receipt {
        bytes32 quoteHash;
        bytes32 underlyingId;
        address tokenIn;
        uint256 amountIn;
        address representation;
        uint256 tokensOut;
        uint8 action;
    }

    /// @dev The ratio and share figures are telemetry. They come from a live token call for ERC-8056
    ///      representations, so they are read in a try/catch: a representation whose ratio view reverts must
    ///      still be sellable and redeemable (invariant 7), the receipt just carries zeros for it.
    function _emitRouteReceipt(IStockRegistry registry, Receipt memory r) internal {
        uint256 ratio;
        uint256 shares;
        try registry.ratioOf(r.representation) returns (uint256 ratio_, uint64) {
            ratio = ratio_;
            shares = ShareMath.sharesForTokens(r.tokensOut, ratio_);
        } catch {}
        uint64 attested = registry.attestedAt(registry.platformOf(r.representation));
        emit RouteReceipt(
            r.quoteHash,
            msg.sender,
            r.underlyingId,
            r.tokenIn,
            r.amountIn,
            r.representation,
            r.tokensOut,
            shares,
            ratio,
            attested,
            r.action
        );
    }
}
