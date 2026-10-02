// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Deterministic swap venue for tests and BSC testnet. Prices are USD per raw token (1e18).
///         `mode` lets tests make it adversarial: return nothing, pull more than asked, reenter the caller, revert.
///         Prices, fee and mode can only be set by the owner or the keeper, so a public testnet venue whose
///         prices mirror mainnet cannot be re-priced by a stranger.
contract MockSwapTarget {
    using SafeERC20 for IERC20;

    enum Mode {
        NORMAL,
        NO_OUTPUT, // takes input, sends nothing
        TAKE_MORE, // tries to pull 2x the amount (approval should stop it)
        REENTER, // calls back into msg.sender with `reenterData`
        REVERT, // reverts with a reason
        SKIM_HALF // takes input, returns half the fair output (slippage attack)
    }

    mapping(address => uint256) public price; // 1e18 USD per token unit
    uint16 public feeBps;
    Mode public mode;
    bytes public reenterData;
    address public owner;
    address public keeper;

    event Swapped(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut, address recipient);
    event PriceSet(address indexed token, uint256 usdPerToken);
    event KeeperSet(address keeper);

    error NotAuthorized(address caller);

    modifier onlyOperator() {
        if (msg.sender != owner && msg.sender != keeper) revert NotAuthorized(msg.sender);
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setKeeper(address k) external {
        if (msg.sender != owner) revert NotAuthorized(msg.sender);
        keeper = k;
        emit KeeperSet(k);
    }

    function setPrice(address token, uint256 usdPerToken) external onlyOperator {
        price[token] = usdPerToken;
        emit PriceSet(token, usdPerToken);
    }

    function setFeeBps(uint16 bps) external onlyOperator {
        feeBps = bps;
    }

    function setMode(Mode m, bytes calldata data) external onlyOperator {
        mode = m;
        reenterData = data;
    }

    function quote(address tokenIn, address tokenOut, uint256 amountIn) public view returns (uint256) {
        uint256 gross = Math.mulDiv(amountIn, price[tokenIn], price[tokenOut]);
        return gross - Math.mulDiv(gross, feeBps, 10_000);
    }

    /// @dev Pulls `amountIn` of tokenIn from msg.sender, sends quote() of tokenOut to `recipient`.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address recipient)
        external
        returns (uint256 amountOut)
    {
        if (mode == Mode.REVERT) revert("MockSwapTarget: forced revert");
        uint256 pull = mode == Mode.TAKE_MORE ? amountIn * 2 : amountIn;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), pull);
        if (mode == Mode.REENTER) {
            (bool ok, bytes memory ret) = msg.sender.call(reenterData);
            require(ok, string(ret));
        }
        if (mode == Mode.NO_OUTPUT) return 0;
        amountOut = quote(tokenIn, tokenOut, amountIn);
        if (mode == Mode.SKIM_HALF) amountOut /= 2;
        require(amountOut >= minOut, "MockSwapTarget: slippage");
        IERC20(tokenOut).safeTransfer(recipient, amountOut);
        emit Swapped(tokenIn, tokenOut, amountIn, amountOut, recipient);
    }
}
