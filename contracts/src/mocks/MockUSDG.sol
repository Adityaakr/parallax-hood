// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice USDG stand-in for tests and local chains: 6 decimals, like USDG on Robinhood Chain. Free mint.
contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar (mock)", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
