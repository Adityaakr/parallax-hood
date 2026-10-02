// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

/// @dev Thin harness so the library runs in the context of a contract that holds balances.
contract LegHarness {
    function run(LegExecutor.Leg memory leg) external returns (uint256, uint256) {
        return LegExecutor.execute(leg);
    }
}

contract LegExecutorFuzz is Test {
    MockUSDT usdt;
    MockStockToken tok;
    MockSwapTarget venue;
    LegHarness h;

    function setUp() public {
        usdt = new MockUSDT();
        tok = new MockStockToken("T", "T", true);
        venue = new MockSwapTarget();
        h = new LegHarness();
        venue.setPrice(address(usdt), 1e18);
        venue.setPrice(address(tok), 200e18);
        tok.mint(address(venue), 1e30);
        usdt.mint(address(venue), 1e30);
    }

    function _leg(uint256 amountIn, uint256 maxIn) internal view returns (LegExecutor.Leg memory) {
        return LegExecutor.Leg({
            target: address(venue),
            data: abi.encodeCall(MockSwapTarget.swap, (address(usdt), address(tok), amountIn, 0, address(h))),
            tokenIn: address(usdt),
            maxIn: maxIn,
            tokenOut: address(tok)
        });
    }

    function testFuzz_normal_deltasMatch(uint256 amountIn, uint16 fee) public {
        amountIn = bound(amountIn, 1e6, 1e27);
        fee = uint16(bound(fee, 0, 5000));
        venue.setFeeBps(fee);
        usdt.mint(address(h), amountIn);
        (uint256 spent, uint256 received) = h.run(_leg(amountIn, amountIn));
        assertEq(spent, amountIn);
        assertEq(received, venue.quote(address(usdt), address(tok), amountIn));
        assertEq(usdt.allowance(address(h), address(venue)), 0, "approval reset");
        assertEq(tok.balanceOf(address(h)), received);
    }

    function testFuzz_maxIn_capsSpend(uint256 amountIn, uint256 maxIn) public {
        amountIn = bound(amountIn, 1e6, 1e27);
        maxIn = bound(maxIn, 0, amountIn - 1);
        usdt.mint(address(h), amountIn);
        vm.expectRevert(); // venue's transferFrom exceeds approval -> LegCallFailed
        h.run(_leg(amountIn, maxIn));
        assertEq(usdt.balanceOf(address(h)), amountIn, "nothing spent on failure");
    }

    function testFuzz_adversarial_modes(uint256 amountIn, uint8 modeRaw) public {
        amountIn = bound(amountIn, 1e6, 1e27);
        MockSwapTarget.Mode mode = MockSwapTarget.Mode(bound(modeRaw, 1, 5));
        usdt.mint(address(h), amountIn);
        venue.setMode(mode, abi.encodeCall(LegHarness.run, (_leg(1, 1))));
        if (mode == MockSwapTarget.Mode.SKIM_HALF) {
            (uint256 spent, uint256 received) = h.run(_leg(amountIn, amountIn));
            assertEq(spent, amountIn);
            assertEq(received, venue.quote(address(usdt), address(tok), amountIn) / 2);
        } else if (mode == MockSwapTarget.Mode.REENTER) {
            // reentrancy into the harness itself is allowed (no guard here) but the inner leg fails on approval,
            // which bubbles up as a revert
            vm.expectRevert();
            h.run(_leg(amountIn, amountIn));
        } else {
            vm.expectRevert();
            h.run(_leg(amountIn, amountIn));
        }
    }

    function test_sameTokenRejected() public {
        LegExecutor.Leg memory leg = _leg(1, 1);
        leg.tokenOut = address(usdt);
        vm.expectRevert(LegExecutor.LegSameToken.selector);
        h.run(leg);
    }
}
