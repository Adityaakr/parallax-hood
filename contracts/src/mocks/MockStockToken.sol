// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC8056} from "../interfaces/IERC8056.sol";

/// @notice Tokenized-stock stand-in for tests and local chains.
///         - `erc8056 = true` mimics a Robinhood Chain stock token: raw ERC-20 balances plus `uiMultiplier()`,
///           with a scheduled change readable as `newUIMultiplier()` / `effectiveAt()`. `false` is a plain
///           ERC-20 whose ratio the registry takes from the keeper, kept so a second issuer stays testable.
///         - issuer pause and per-address blocklist applied on every transfer (from, to, operator)
///         Free mint for tests/testnet.
contract MockStockToken is ERC20, Ownable, IERC8056 {
    bool public immutable erc8056;
    uint256 private _multiplier = 1e18;
    uint256 private _pendingMultiplier;
    uint256 private _pendingEffectiveAt;
    bool public paused;
    mapping(address => bool) public blocked;

    error TokenPaused();
    error UserBlocked(address user);

    constructor(string memory name_, string memory symbol_, bool erc8056_) ERC20(name_, symbol_) Ownable(msg.sender) {
        erc8056 = erc8056_;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    // ---- issuer controls ----
    function setPaused(bool p) external onlyOwner {
        paused = p;
    }

    function setBlocked(address user, bool b) external onlyOwner {
        blocked[user] = b;
    }

    function setMultiplier(uint256 m) external onlyOwner {
        _multiplier = m;
    }

    function scheduleMultiplier(uint256 m, uint256 effectiveAt_) external onlyOwner {
        _pendingMultiplier = m;
        _pendingEffectiveAt = effectiveAt_;
    }

    // ---- ERC-8056 views ----
    function uiMultiplier() public view override returns (uint256) {
        if (_pendingEffectiveAt != 0 && block.timestamp >= _pendingEffectiveAt) return _pendingMultiplier;
        return _multiplier;
    }

    /// @dev Tracks the current multiplier until a change is scheduled, as the real tokens do.
    function newUIMultiplier() external view override returns (uint256) {
        return _pendingEffectiveAt == 0 ? _multiplier : _pendingMultiplier;
    }

    function effectiveAt() external view override returns (uint256) {
        return _pendingEffectiveAt;
    }

    function balanceOfUI(address account) external view override returns (uint256) {
        return Math.mulDiv(balanceOf(account), uiMultiplier(), 1e18);
    }

    function totalSupplyUI() external view override returns (uint256) {
        return Math.mulDiv(totalSupply(), uiMultiplier(), 1e18);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert TokenPaused();
        if (from != msg.sender && to != msg.sender && blocked[msg.sender]) revert UserBlocked(msg.sender);
        if (from != address(0) && blocked[from]) revert UserBlocked(from);
        if (to != address(0) && blocked[to]) revert UserBlocked(to);
        super._update(from, to, value);
    }
}
