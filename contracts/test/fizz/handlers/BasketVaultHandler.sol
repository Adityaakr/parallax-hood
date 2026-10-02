// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import "../Base.sol";
import {Properties} from "../Properties.sol";

/// @notice Handles the interaction with BasketVault (the pxFUZZ basket: 0.1 NVDA + 0.05 AAPL per unit).
abstract contract BasketVaultHandler is Properties {
    // ――――――――――――――――――――――――― Clamped ――――――――――――――――――――――――――

    /// @dev Mint with legs that fully back the units, NVDA split `bstockBps` bstock / rest ondo.
    function basketVault_mint_clamped(uint256 units, uint16 bstockBps, address recipient) public {
        units = clampBetween(units, 0.01e18, 50e18);
        bstockBps = uint16(clampBetween(bstockBps, 0, BPS));
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, bstockBps);
        if (usdt.balanceOf(actor) < maxUsdt) return;
        basketVault_mint(units, maxUsdt, legs, toActor(recipient));
    }

    /// @dev Sub-unit mints: rounding of requiredShares (ceil) vs delivered (floor) is the pressure point.
    function basketVault_mint_dust(uint256 units, uint16 bstockBps) public {
        units = clampBetween(units, 1, 1e12);
        bstockBps = uint16(clampBetween(bstockBps, 0, BPS));
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, bstockBps);
        if (usdt.balanceOf(actor) < maxUsdt) return;
        basketVault_mint(units, maxUsdt, legs, actor);
    }

    /// @dev Over-budget mint: legs sized for `units` but maxUsdtIn twice that; the surplus must come back.
    function basketVault_mint_overBudget(uint256 units, uint16 bstockBps) public {
        units = clampBetween(units, 0.01e18, 20e18);
        bstockBps = uint16(clampBetween(bstockBps, 0, BPS));
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, bstockBps);
        if (usdt.balanceOf(actor) < maxUsdt * 2) return;
        basketVault_mint(units, maxUsdt * 2, legs, actor);
    }

    /// @dev Legs that only buy NVDA, or none at all: must revert (UnderDelivered / NoLegs), never mint.
    function basketVault_mint_underDelivered(uint256 units, uint8 shape) public {
        units = clampBetween(units, 1, 20e18);
        LegExecutor.Leg[] memory legs;
        uint256 budget = 1;
        if (shape % 2 == 1) {
            uint256 u1 = _usdtForShares(address(nvdaB), units * NVDA_PER_UNIT / WAD + 1);
            budget = u1 + u1 / 100 + 1;
            legs = _legs1(_leg(address(usdt), address(nvdaB), u1, address(basket)));
        } else {
            legs = new LegExecutor.Leg[](0);
        }
        if (usdt.balanceOf(actor) < budget) return;
        uint256 unitsBefore = basket.balanceOf(actor);
        uint256 supplyBefore = basket.totalSupply();
        vm.prank(actor);
        try basket.mint(units, budget, legs, actor, bytes32(units)) {
            ghosts.freeMintSucceeded = true;
        } catch {}
        _prop_mintWithoutDelivery(unitsBefore, supplyBefore);
    }

    /// @dev Redeem to USDT, selling `sellBps` of each pro-rata slice; the rest goes out in kind.
    function basketVault_redeem_clamped(uint256 units, uint16 sellBps, address recipient) public {
        uint256 bal = basket.balanceOf(actor);
        if (bal == 0) return;
        units = clampBetween(units, 1, bal);
        sellBps = uint16(clampBetween(sellBps, 0, BPS));
        basketVault_redeem(units, sellBps, 0, toActor(recipient));
    }

    function basketVault_redeem_full(uint16 sellBps) public {
        uint256 bal = basket.balanceOf(actor);
        if (bal == 0) return;
        basketVault_redeem(bal, uint16(clampBetween(sellBps, 0, BPS)), 0, actor);
    }

    function basketVault_redeemInKind_clamped(uint256 units, address recipient) public {
        uint256 bal = basket.balanceOf(actor);
        if (bal == 0) return;
        units = clampBetween(units, 1, bal);
        basketVault_redeemInKind(units, toActor(recipient));
    }

    function basketVault_redeemInKind_full() public {
        uint256 bal = basket.balanceOf(actor);
        if (bal == 0) return;
        basketVault_redeemInKind(bal, actor);
    }

    /// @dev Migrate NVDA between its two representations: sell `sellBps` of the source, buy the target.
    function basketVault_migrate_clamped(uint16 sellBps, bool ondoToBstock, uint256 minShareGain) public {
        sellBps = uint16(clampBetween(sellBps, 1, BPS));
        address from = ondoToBstock ? address(nvdaOn) : address(nvdaB);
        address to = ondoToBstock ? address(nvdaB) : address(nvdaOn);
        uint256 held = IERC20(from).balanceOf(address(basket));
        if (held == 0) return;
        uint256 sell = held * sellBps / BPS;
        if (sell == 0) return;
        uint256 usdtOut = venue.quote(from, address(usdt), sell);
        if (usdtOut == 0) return;
        basketVault_migrate(sell, usdtOut, from, to, clampBetween(minShareGain, 0, 1e15));
    }

    /// @dev Migration legs that only sell (USDT stays in the vault): must revert, never reduce shares.
    function basketVault_migrate_sellOnly(uint16 sellBps, bool ondo) public {
        address from = ondo ? address(nvdaOn) : address(nvdaB);
        uint256 held = IERC20(from).balanceOf(address(basket));
        if (held == 0) return;
        uint256 sell = held * clampBetween(sellBps, 1, BPS) / BPS;
        if (sell == 0) return;
        basketVault_migrate(sell, 0, from, address(0), 0);
    }

    function basketVault_donateERC20(uint256 amount, uint8 tokenSeed) public {
        address token = tokenSeed % 4 == 3 ? address(usdt) : reps[tokenSeed % reps.length];
        uint256 bal = IERC20(token).balanceOf(actor);
        if (bal == 0) return;
        amount = clampBetween(amount, 1, bal);
        vm.prank(actor);
        IERC20(token).transfer(address(basket), amount);
        ghosts.vaultDonated[token] += amount;
        ghosts.vaultWindfalls++;
    }

    function basketVault_secondary(uint8 selector, uint256 units, address to, uint8 skipSeed) public {
        selector = uint8(selector % 2);
        uint256 bal = basket.balanceOf(actor);
        if (bal == 0) return;
        units = clampBetween(units, 1, bal);
        if (selector == 0) _basketVault_transfer(toActorNotCurrent(to), units);
        else _basketVault_redeemInKindSkipping(units, actor, skipSeed);
    }

    /// @notice SP-01: mint->redeemInKind round trip by the same actor, same units — must not leave them with
    ///         more USDT or more of any representation than before.
    function roundTrip_mintRedeemInKind(uint256 units, uint16 bstockBps) public {
        units = clampBetween(units, 0.01e18, 20e18);
        bstockBps = uint16(clampBetween(bstockBps, 0, BPS));
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, bstockBps);
        if (usdt.balanceOf(actor) < maxUsdt) return;

        uint256 usdtBefore = usdt.balanceOf(actor);
        bool cleanBefore = _vaultClean();
        uint256[] memory repBefore = new uint256[](reps.length);
        for (uint256 i = 0; i < reps.length; i++) repBefore[i] = IERC20(reps[i]).balanceOf(actor);

        vm.startPrank(actor);
        try basket.mint(units, maxUsdt, legs, actor, keccak256(abi.encode("SP01", units, block.timestamp, actor)))
            returns (uint256)
        {
            try basket.redeemInKind(units, actor) {
                _prop_mintRedeemInKindRoundTrip(usdtBefore, repBefore, cleanBefore);
            } catch {}
        } catch {}
        vm.stopPrank();
    }

    /// @notice SP-02: at zero protocol and venue fee, mint->redeem(sell 100% to USDT) must not return more
    ///         USDT than was spent.
    function roundTrip_mintRedeemFullSell_zeroFee(uint256 units, uint16 bstockBps) public {
        units = clampBetween(units, 0.01e18, 20e18);
        bstockBps = uint16(clampBetween(bstockBps, 0, BPS));

        (uint16 feeBefore, address recipientBefore) = registry.fee();
        uint16 venueFeeBefore = venue.feeBps();
        vm.prank(admin);
        registry.setFee(0, recipientBefore);
        vm.prank(admin);
        venue.setFeeBps(0);

        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, bstockBps);
        if (usdt.balanceOf(actor) >= maxUsdt) {
            uint256 usdtBefore = usdt.balanceOf(actor);
        bool cleanBefore = _vaultClean();
            vm.startPrank(actor);
            try basket.mint(units, maxUsdt, legs, actor, keccak256(abi.encode("SP02", units, block.timestamp, actor)))
                returns (uint256)
            {
                uint256 supply = basket.totalSupply();
                LegExecutor.Leg[] memory tmp = new LegExecutor.Leg[](reps.length);
                uint256 n;
                for (uint256 i = 0; i < reps.length; i++) {
                    uint256 slice = IERC20(reps[i]).balanceOf(address(basket)) * units / supply;
                    if (slice == 0) continue;
                    tmp[n++] = _leg(reps[i], address(usdt), slice, address(basket));
                }
                LegExecutor.Leg[] memory sellLegs = new LegExecutor.Leg[](n);
                for (uint256 i = 0; i < n; i++) sellLegs[i] = tmp[i];
                try basket.redeem(
                    units, 0, sellLegs, actor, keccak256(abi.encode("SP02r", units, block.timestamp, actor))
                ) returns (uint256) {
                    _prop_mintRedeemFullSellZeroFee(usdtBefore, cleanBefore);
                } catch {}
            } catch {}
            vm.stopPrank();
        }

        vm.prank(admin);
        registry.setFee(feeBefore, recipientBefore);
        vm.prank(admin);
        venue.setFeeBps(venueFeeBefore);
    }

    /// @notice SP-03: N repeated mint->redeemInKind cycles of the same size must not let the actor's aggregate
    ///         USDT balance grow (compounding-rounding detector, distinct from the single round trip SP-01).
    function roundTrip_mintRedeemInKind_Ncycles(uint256 units, uint8 cycles) public {
        units = clampBetween(units, 0.01e18, 5e18);
        cycles = uint8(clampBetween(cycles, 2, 6));
        uint256 usdtBefore = usdt.balanceOf(actor);
        bool cleanBefore = _vaultClean();

        for (uint256 c = 0; c < cycles; c++) {
            (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units, 5_000);
            if (usdt.balanceOf(actor) < maxUsdt) break;
            vm.startPrank(actor);
            try basket.mint(units, maxUsdt, legs, actor, keccak256(abi.encode("SP03", units, c, block.timestamp, actor)))
                returns (uint256)
            {
                try basket.redeemInKind(units, actor) {} catch {}
            } catch {}
            vm.stopPrank();
        }
        _prop_mintRedeemInKindNCycles(usdtBefore, cleanBefore);
    }

    /// @notice SP-17: a basket-unit self-transfer (actor sends to themselves) and a zero-amount transfer are
    ///         true no-ops.
    function basketVault_transferSelf_clamped(uint256 units, bool zeroAmount) public {
        uint256 bal = basket.balanceOf(actor);
        uint256 amount = zeroAmount ? 0 : (bal == 0 ? 0 : clampBetween(units, 1, bal));
        if (!zeroAmount && amount == 0) return;
        uint256 balBefore = basket.balanceOf(actor);
        uint256 supplyBefore = basket.totalSupply();
        vm.prank(actor);
        basket.transfer(actor, amount);
        _prop_selfAndZeroTransferAreNoOps(balBefore, supplyBefore);
    }

    // ―――――――――――――――――――――――― Unclamped ―――――――――――――――――――――――――

    function basketVault_mint(uint256 units, uint256 maxUsdtIn, LegExecutor.Leg[] memory legs, address recipient)
        public
        asActor
    {
        snapshotBefore();
        uint256 usdtBefore = usdt.balanceOf(actor);
        uint256 unitsBefore = basket.balanceOf(recipient);
        uint256 spent = basket.mint(units, maxUsdtIn, legs, recipient, keccak256(abi.encode(units, maxUsdtIn)));
        snapshotAfter();
        _recordFeePaid();
        _prop_feeExact(spent);
        _prop_mint(units, maxUsdtIn, spent, usdtBefore, unitsBefore, recipient);
    }

    /// @dev Sell legs for `sellBps` of every representation's pro-rata slice; tokenOut is always USDT.
    function basketVault_redeem(uint256 units, uint16 sellBps, uint256 minUsdtOut, address recipient) public asActor {
        uint256 supply = basket.totalSupply();
        uint256 n;
        LegExecutor.Leg[] memory tmp = new LegExecutor.Leg[](reps.length);
        for (uint256 i = 0; i < reps.length; i++) {
            uint256 slice = IERC20(reps[i]).balanceOf(address(basket)) * units / supply;
            uint256 sell = slice * sellBps / BPS;
            if (sell == 0) continue;
            tmp[n++] = _leg(reps[i], address(usdt), sell, address(basket));
        }
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](n);
        for (uint256 i = 0; i < n; i++) legs[i] = tmp[i];

        snapshotBefore();
        uint256 unitsBefore = basket.balanceOf(actor);
        uint256 usdtBefore = usdt.balanceOf(recipient);
        uint256 usdtOut = basket.redeem(units, minUsdtOut, legs, recipient, keccak256(abi.encode(units, sellBps)));
        snapshotAfter();
        _recordFeePaid();
        _prop_feeExact(usdtOut + (stateAfter.feeRecipientUsdt - stateBefore.feeRecipientUsdt)); // gross proceeds
        _prop_redeem(units, minUsdtOut, usdtOut, unitsBefore, usdtBefore, recipient);
    }

    function basketVault_redeemInKind(uint256 units, address recipient) public asActor {
        snapshotBefore();
        uint256 unitsBefore = basket.balanceOf(actor);
        uint256[] memory repBefore = new uint256[](reps.length);
        for (uint256 i = 0; i < reps.length; i++) repBefore[i] = IERC20(reps[i]).balanceOf(recipient);
        basket.redeemInKind(units, recipient);
        snapshotAfter();
        _prop_redeemInKind(units, unitsBefore, repBefore, recipient);
    }

    /// @dev `to == address(0)` builds a sell-only migration (no buy leg).
    function basketVault_migrate(uint256 sell, uint256 usdtOut, address from, address to, uint256 minShareGain)
        public
        asActor
    {
        LegExecutor.Leg[] memory legs;
        if (to == address(0)) {
            legs = _legs1(_leg(from, address(usdt), sell, address(basket)));
        } else {
            legs = new LegExecutor.Leg[](2);
            legs[0] = _leg(from, address(usdt), sell, address(basket));
            legs[1] = _leg(address(usdt), to, usdtOut, address(basket));
        }
        snapshotBefore();
        uint256 gain = basket.migrate(NVDA, legs, minShareGain, keccak256(abi.encode(sell, from, to)));
        snapshotAfter();
        ghosts.vaultWindfalls++;
        _prop_migrate(gain, minShareGain);
    }

    function _basketVault_transfer(address to, uint256 units) internal asActor {
        snapshotBefore();
        basket.transfer(to, units);
        snapshotAfter();
        _prop_transferKeepsBacking();
    }

    function _basketVault_redeemInKindSkipping(uint256 units, address recipient, uint8 skipSeed) internal asActor {
        address[] memory skip = new address[](1);
        skip[0] = skipSeed % 4 == 3 ? address(usdt) : reps[skipSeed % reps.length];
        snapshotBefore();
        uint256 unitsBefore = basket.balanceOf(actor);
        basket.redeemInKindSkipping(units, recipient, skip);
        snapshotAfter();
        ghosts.vaultWindfalls++;
        _prop_redeemInKindSkipping(units, unitsBefore, skip[0], recipient);
    }
}
