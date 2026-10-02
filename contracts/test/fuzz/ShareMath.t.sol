// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ShareMath} from "../../src/libraries/ShareMath.sol";

contract ShareMathFuzz is Test {
    uint256 constant WAD = 1e18;

    /// tokensForShares(sharesForTokens(t)) <= t + 1 and >= ... : converting down then up never over-credits.
    function testFuzz_roundTrip_tokensSharesTokens(uint256 tokens, uint256 ratio) public pure {
        tokens = bound(tokens, 0, 1e30);
        ratio = bound(ratio, 1e9, 1e27); // bStock multiplier bounds
        uint256 shares = ShareMath.sharesForTokens(tokens, ratio);
        uint256 back = ShareMath.tokensForShares(shares, ratio);
        assertLe(back, tokens, "round trip must not exceed original tokens");
        // and holding `back` tokens still covers `shares`
        assertGe(ShareMath.sharesForTokens(back, ratio) + 1, shares);
    }

    /// Holding tokensForShares(s) tokens always represents at least s shares (vault never under-holds).
    function testFuzz_tokensForShares_coversShares(uint256 shares, uint256 ratio) public pure {
        shares = bound(shares, 0, 1e30);
        ratio = bound(ratio, 1e9, 1e27);
        uint256 t = ShareMath.tokensForShares(shares, ratio);
        assertGe(ShareMath.sharesForTokens(t, ratio), shares);
    }

    function testFuzz_requiredShares_monotone(uint256 a, uint256 b, uint256 spu) public pure {
        a = bound(a, 0, 1e27);
        b = bound(b, a, 1e27);
        spu = bound(spu, 1, 1e24);
        assertLe(ShareMath.requiredShares(a, spu), ShareMath.requiredShares(b, spu));
    }

    function testFuzz_proRata_neverExceedsBalance(uint256 bal, uint256 units, uint256 supply) public pure {
        supply = bound(supply, 0, 1e30);
        units = bound(units, 0, supply);
        bal = bound(bal, 0, 1e30);
        uint256 slice = ShareMath.proRata(bal, units, supply);
        assertLe(slice, bal);
        if (units == supply && supply > 0) assertEq(slice, bal);
    }

    function testFuzz_proRata_additive(uint256 bal, uint256 u1, uint256 u2, uint256 supply) public pure {
        supply = bound(supply, 1, 1e30);
        u1 = bound(u1, 0, supply);
        u2 = bound(u2, 0, supply - u1);
        bal = bound(bal, 0, 1e30);
        // rounding down means two slices never exceed the combined slice
        assertLe(
            ShareMath.proRata(bal, u1, supply) + ShareMath.proRata(bal, u2, supply),
            ShareMath.proRata(bal, u1 + u2, supply)
        );
    }

    function testFuzz_stepBps_symmetricBounded(uint256 a, uint256 b) public pure {
        a = bound(a, 1, 1e27);
        b = bound(b, 1, 1e27);
        uint256 s = ShareMath.stepBps(a, b);
        if (b >= a) assertEq(s, (b - a) * 10_000 / a);
        else assertEq(s, (a - b) * 10_000 / a);
        assertEq(ShareMath.stepBps(a, a), 0);
        assertEq(ShareMath.stepBps(0, b), 0);
    }
}
