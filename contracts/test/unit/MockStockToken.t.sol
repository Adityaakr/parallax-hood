// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";

/// @dev The mock has to behave like a Robinhood Chain stock token where the registry and the resolver read it,
///      or tests against it prove nothing about the real ones. Each expectation below is what the real NVDA
///      token returned on chain 4663 (docs/addresses.md), restated on the mock.
contract MockStockTokenTest is Test {
    MockStockToken token;
    address holder = makeAddr("holder");

    function setUp() public {
        token = new MockStockToken("NVIDIA", "NVDA", true);
        token.mint(holder, 10e18);
    }

    function test_decimalsAndRawBalancesNeverRebase() public {
        assertEq(token.decimals(), 18);
        token.setMultiplier(1.000775e18);
        assertEq(token.balanceOf(holder), 10e18);
        assertEq(token.totalSupply(), 10e18);
    }

    function test_uiViewsScaleByTheMultiplier() public {
        token.setMultiplier(1.000775e18);
        assertEq(token.balanceOfUI(holder), 10.00775e18);
        assertEq(token.totalSupplyUI(), 10.00775e18);
    }

    function test_newMultiplierTracksCurrentUntilOneIsScheduled() public {
        token.setMultiplier(1.000775e18);
        assertEq(token.newUIMultiplier(), 1.000775e18);
        assertEq(token.effectiveAt(), 0);
    }

    function test_scheduledMultiplierTakesEffectAtItsTimestamp() public {
        token.setMultiplier(1e18);
        uint256 at = block.timestamp + 1 days;
        token.scheduleMultiplier(2e18, at);
        assertEq(token.uiMultiplier(), 1e18);
        assertEq(token.newUIMultiplier(), 2e18);
        assertEq(token.effectiveAt(), at);
        vm.warp(at);
        assertEq(token.uiMultiplier(), 2e18);
        assertEq(token.balanceOfUI(holder), 20e18);
    }
}
