// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC8056} from "../interfaces/IERC8056.sol";

/// @notice Tokenized-stock stand-in that mimics what Phase 0 found on mainnet:
///         - ERC-8056 style `uiMultiplier()` (bStocks) when `erc8056 = true`, or a plain ERC-20 (Ondo) otherwise
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

    function pendingMultiplier() external view override returns (uint256, uint256) {
        if (!hasPendingMultiplier()) return (0, 0);
        return (_pendingMultiplier, _pendingEffectiveAt);
    }

    function hasPendingMultiplier() public view override returns (bool) {
        return _pendingEffectiveAt != 0 && block.timestamp < _pendingEffectiveAt;
    }

    function toUIAmount(uint256 rawAmount) external view override returns (uint256) {
        return Math.mulDiv(rawAmount, uiMultiplier(), 1e18);
    }

    function fromUIAmount(uint256 uiAmount) external view override returns (uint256) {
        return Math.mulDiv(uiAmount, 1e18, uiMultiplier());
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert TokenPaused();
        if (from != msg.sender && to != msg.sender && blocked[msg.sender]) revert UserBlocked(msg.sender);
        if (from != address(0) && blocked[from]) revert UserBlocked(from);
        if (to != address(0) && blocked[to]) revert UserBlocked(to);
        super._update(from, to, value);
    }
}
