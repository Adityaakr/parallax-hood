// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IStockRegistry} from "./interfaces/IStockRegistry.sol";
import {IBasketVault} from "./interfaces/IBasketVault.sol";
import {BasketVault} from "./BasketVault.sol";

/// @title BasketFactory
/// @notice Deploys BasketVaults bound to one StockRegistry and keeps the canonical list for UIs and indexers.
/// @dev Creation is gated by BASKET_CREATOR_ROLE for the MVP (roadmap: permissionless with a curation flag).
contract BasketFactory is AccessControl {
    bytes32 public constant BASKET_CREATOR_ROLE = keccak256("BASKET_CREATOR_ROLE");

    IStockRegistry public immutable registry;
    address[] private _baskets;
    mapping(address => bool) public isBasket;
    mapping(bytes32 => address) public basketBySymbol;

    event BasketCreated(address indexed basket, string name, string symbol, uint256 constituentCount);

    error UnknownUnderlying(bytes32 underlyingId);
    error SymbolTaken(string symbol);

    constructor(IStockRegistry registry_, address admin) {
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(BASKET_CREATOR_ROLE, admin);
    }

    function createBasket(
        string calldata name,
        string calldata symbol,
        IBasketVault.Constituent[] calldata constituents
    ) external onlyRole(BASKET_CREATOR_ROLE) returns (address basket) {
        bytes32 symKey = keccak256(bytes(symbol));
        if (basketBySymbol[symKey] != address(0)) revert SymbolTaken(symbol);
        for (uint256 i = 0; i < constituents.length; i++) {
            if (registry.representationsOf(constituents[i].underlyingId).length == 0) {
                revert UnknownUnderlying(constituents[i].underlyingId);
            }
        }
        basket = address(new BasketVault(name, symbol, registry, constituents));
        _baskets.push(basket);
        isBasket[basket] = true;
        basketBySymbol[symKey] = basket;
        emit BasketCreated(basket, name, symbol, constituents.length);
    }

    function baskets() external view returns (address[] memory) {
        return _baskets;
    }

    function basketCount() external view returns (uint256) {
        return _baskets.length;
    }
}
