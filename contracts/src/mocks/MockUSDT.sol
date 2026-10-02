// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 18-decimal USDT stand-in (BSC USDT has 18 decimals). Free mint for tests/testnet.
contract MockUSDT is ERC20 {
    constructor() ERC20("Tether USD (mock)", "USDT") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
