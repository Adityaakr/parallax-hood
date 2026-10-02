// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {AgentMandateHandler} from "./AgentMandateHandler.sol";
import {BasketVaultHandler} from "./BasketVaultHandler.sol";
import {ShareRouterHandler} from "./ShareRouterHandler.sol";
import {StockRegistryHandler} from "./StockRegistryHandler.sol";

/// @notice Inherits from all the handlers to expose all entry points in a single contract.
///         Manages environment changes (e.g. current actor, current token, mocks setup, etc.).
abstract contract Handlers is
    AgentMandateHandler,
    BasketVaultHandler,
    ShareRouterHandler,
    StockRegistryHandler
{
    function setCurrentActor(uint256 entropy) public {
        actor = actors[entropy % actors.length];
    }
}
