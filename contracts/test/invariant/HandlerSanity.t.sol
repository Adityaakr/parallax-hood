// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {VaultHandler} from "./BasketVault.invariant.t.sol";
import {MandateHandler} from "./AgentMandate.invariant.t.sol";

/// @dev Makes sure the invariant handlers actually reach the success paths (so the invariants are not vacuous).
contract HandlerSanity is BaseTest {
    function test_vaultHandlerReachesAllPaths() public {
        VaultHandler h = new VaultHandler(basket, registry, usdt, nvdaOn, nvdaB, aaplB, venue, keeper, guardian);
        venue.setKeeper(address(h));
        nvdaB.transferOwnership(address(h));
        aaplB.transferOwnership(address(h));
        h.mint(1, 10e18, 2000);
        h.mint(2, 5e18, 0); // 100 % bstock would push NVDA above the 80 % cap -> correctly rejected
        assertEq(h.mints(), 1, "cap-bound mint rejected");
        h.mint(2, 5e18, 2500);
        assertEq(h.mints(), 2, "mint path");
        h.redeem(1, 2e18);
        assertEq(h.redeems(), 1, "redeem path");
        h.redeemInKind(1, 1e18);
        assertEq(h.inKinds(), 1, "in-kind path");
        h.movePrice(1, 9_500); // bstock cheaper -> ondo->bstock migration gains shares
        h.migrate(3, 500, true); // small slice keeps bstock under the 80 % cap
        assertEq(h.migrations(), 1, "migrate path");
        assertFalse(h.inKindFailed());
        assertFalse(h.migrateReducedShares());
        assertFalse(h.backingBrokenByVaultCall());
        assertTrue(basket.backingOk());
    }

    function test_mandateHandlerReachesAllPaths() public {
        vm.startPrank(admin);
        registry.setLimits(365 days, 365 days, 500);
        registry.setPriceLimits(365 days, 2_000);
        vm.stopPrank();
        MandateHandler h = new MandateHandler(mandate, router, basket, usdt, nvdaB, aaplB, nvdaOn, venue, alice, agent);
        h.agentBuy(100e18, false, false);
        assertEq(h.successfulSpends(), 1, "buy path");
        h.agentMint(1e18, 250);
        assertEq(h.successfulSpends(), 2, "mint path");
        h.agentBuy(100e18, true, false); // wrong underlying -> no spend
        h.agentBuy(100e18, false, true); // pay agent -> no spend
        assertEq(h.successfulSpends(), 2);
        h.ownerRevoke();
        h.agentBuy(100e18, false, false);
        assertEq(h.successfulSpends(), 2);
        assertFalse(h.spendAfterRevoke());
    }
}
