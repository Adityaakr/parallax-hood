// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

/// The testnet venue mirrors mainnet prices, so only the owner or the keeper may move them.
contract MockSwapTargetTest is Test {
    MockSwapTarget venue;
    address keeper = address(0xBEEF);
    address stranger = address(0xBAD);

    function setUp() public {
        venue = new MockSwapTarget();
    }

    function test_operatorGate() public {
        venue.setPrice(address(1), 5e18); // owner
        venue.setKeeper(keeper);
        vm.prank(keeper);
        venue.setPrice(address(1), 6e18);
        assertEq(venue.price(address(1)), 6e18);

        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(MockSwapTarget.NotAuthorized.selector, stranger));
        venue.setPrice(address(1), 1);
        vm.expectRevert(abi.encodeWithSelector(MockSwapTarget.NotAuthorized.selector, stranger));
        venue.setFeeBps(1);
        vm.expectRevert(abi.encodeWithSelector(MockSwapTarget.NotAuthorized.selector, stranger));
        venue.setMode(MockSwapTarget.Mode.REVERT, "");
        vm.expectRevert(abi.encodeWithSelector(MockSwapTarget.NotAuthorized.selector, stranger));
        venue.setKeeper(stranger);
        vm.stopPrank();

        vm.prank(keeper); // the keeper cannot hand itself on
        vm.expectRevert(abi.encodeWithSelector(MockSwapTarget.NotAuthorized.selector, keeper));
        venue.setKeeper(stranger);
    }
}
