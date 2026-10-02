// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BaseTest} from "../Base.t.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

/// @dev A quote token the mandate cannot lift to 1e18-scaled USD: more decimals than the reference prices.
contract Dec19Token is ERC20 {
    constructor() ERC20("Nineteen", "D19") {}

    function decimals() public pure override returns (uint8) {
        return 19;
    }
}

/// The quote asset is 6-decimal USDG while shares, ratios, basket units and reference prices stay 1e18-scaled.
/// These tests pin the places where the two scales meet: the router's share output, the mandate's floors and
/// the vault's USDG payout.
contract UsdgQuoteTest is BaseTest {
    address treasury = makeAddr("treasury");
    bytes32 constant QH = keccak256("usdg-quote");
    uint256 constant BPS = 10_000;
    uint16 constant SLIPPAGE_BPS = 300;
    uint256 constant FEE = 50;
    uint256 id;

    function setUp() public override {
        super.setUp();
        bytes32[] memory u = new bytes32[](1);
        u[0] = NVDA;
        address[] memory b = new address[](1);
        b[0] = address(basket);
        vm.startPrank(alice);
        usdg.approve(address(mandate), type(uint256).max);
        id = mandate.createMandate(agent, 500e6, 1000e6, uint64(block.timestamp + 7 days), SLIPPAGE_BPS, u, b);
        vm.stopPrank();
    }

    function _buyLegs(uint256 usdgIn) internal view returns (LegExecutor.Leg[] memory) {
        return _legs1(_leg(address(usdg), address(nvdaB), usdgIn, address(router)));
    }

    function test_quoteToken_hasSixDecimals() public view {
        assertEq(usdg.decimals(), 6);
        assertEq(USDG_UNIT, 10 ** uint256(usdg.decimals()));
        assertEq(mandate.quoteScale(), 1e12);
        assertEq(mandate.quoteScale(), USDG_SCALE);
    }

    function test_buyShares_hundredUsdgAtReferencePrice() public {
        // 100 USDG at $219 per share = 0.456621... shares
        uint256 fair = 100e6 * USDG_SCALE * WAD / NVDA_PX;
        uint256 minShares = fair * 9_990 / BPS; // 10 bps below fair
        uint256 before = usdg.balanceOf(alice);
        vm.startPrank(alice);
        usdg.approve(address(router), 100e6);
        uint256 shares = router.buyShares(NVDA, 100e6, minShares, _buyLegs(100e6), alice, QH);
        vm.stopPrank();
        assertGe(shares, minShares);
        // two floors on the way (the venue's token quote, then tokens -> shares): at most 2 wei below fair
        assertApproxEqAbs(shares, fair, 2);
        assertApproxEqAbs(shares, 0.4566e18, 0.0001e18);
        assertEq(usdg.balanceOf(alice), before - 100e6);
        assertEq(registry.sharesForTokens(address(nvdaB), nvdaB.balanceOf(alice)), shares);
    }

    function test_sharesFloor_liftsUsdgToUsd() public view {
        uint256 expected = 100e6 * 1e12 * (BPS - SLIPPAGE_BPS) / BPS * 1e18 / 219e18;
        assertEq(mandate.sharesFloor(id, NVDA, 100e6), expected);
        // 97 USD of NVDA at $219: the floor is in shares, not off by the 1e12 between the two scales
        assertApproxEqAbs(expected, 0.4429e18, 0.0001e18);
    }

    function test_unitsFloor_liftsUsdgToUsd() public view {
        // one unit = 0.1 NVDA + 0.05 AAPL = 21.9 + 16.6 = 38.5 USD at the reference prices
        uint256 unitUsd = 0.1e18 * NVDA_PX / WAD + 0.05e18 * AAPL_PX / WAD;
        assertEq(unitUsd, 38.5e18);
        uint256 expected = 100e6 * 1e12 * (BPS - SLIPPAGE_BPS) / BPS * 1e18 / unitUsd;
        assertEq(mandate.unitsFloor(id, address(basket), 100e6), expected);
        assertApproxEqAbs(expected, 2.5194e18, 0.0001e18); // 97 / 38.5 units
    }

    function test_agentBuy_halfTheFairShares_revertsBelowFloor() public {
        // the venue keeps half the output: the router reports half the fair shares, far under the 3 % allowance
        venue.setMode(MockSwapTarget.Mode.SKIM_HALF, "");
        uint256 skimmed =
            registry.sharesForTokens(address(nvdaB), venue.quote(address(usdg), address(nvdaB), 100e6) / 2);
        uint256 floor = mandate.sharesFloor(id, NVDA, 100e6);
        assertLt(skimmed, floor);
        uint256 ownerUsdg = usdg.balanceOf(alice);
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.SharesBelowFloor.selector, skimmed, floor));
        mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
        assertEq(usdg.balanceOf(alice), ownerUsdg);
        assertEq(mandate.getMandate(id).spentInWindow, 0);

        // the same buy at fair execution clears the floor
        venue.setMode(MockSwapTarget.Mode.NORMAL, "");
        vm.prank(agent);
        uint256 shares = mandate.agentBuyShares(id, NVDA, 100e6, 0, _buyLegs(100e6), QH);
        assertGe(shares, floor);
        assertEq(mandate.getMandate(id).spentInWindow, 100e6);
    }

    function test_mintThenRedeem_paysSixDecimalUsdg() public {
        uint256 spent = _mintBasket(alice, 10e18);
        vm.prank(admin);
        registry.setFee(uint16(FEE), treasury);

        // alice is the only holder: redeeming everything sells every token the vault holds
        uint256 nB = nvdaB.balanceOf(address(basket));
        uint256 nO = nvdaOn.balanceOf(address(basket));
        uint256 aB = aaplB.balanceOf(address(basket));
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](3);
        legs[0] = _leg(address(nvdaB), address(usdg), nB, address(basket));
        legs[1] = _leg(address(nvdaOn), address(usdg), nO, address(basket));
        legs[2] = _leg(address(aaplB), address(usdg), aB, address(basket));
        uint256 gross = venue.quote(address(nvdaB), address(usdg), nB) + venue.quote(address(nvdaOn), address(usdg), nO)
            + venue.quote(address(aaplB), address(usdg), aB);
        uint256 fee = gross * FEE / BPS;

        uint256 before = usdg.balanceOf(alice);
        vm.prank(alice);
        uint256 out = basket.redeem(10e18, 380e6, legs, alice, QH);
        assertEq(out, gross - fee);
        assertEq(usdg.balanceOf(alice), before + out);
        assertEq(usdg.balanceOf(treasury), fee);
        assertEq(basket.totalSupply(), 0);
        assertEq(usdg.balanceOf(address(basket)), 0);

        // 10 units x 38.5 USD = 385 USDG, less the 50 bps fee. The mint legs carry 5 bps of headroom and each
        // sell floors to 1e-6 USDG, so the payout sits within 0.1 % of that figure, in 6-decimal units.
        uint256 unitUsd = 0.1e18 * NVDA_PX / WAD + 0.05e18 * AAPL_PX / WAD;
        uint256 fairNet = 10 * unitUsd / USDG_SCALE * (BPS - FEE) / BPS;
        assertEq(fairNet, 383.075e6);
        assertApproxEqRel(out, fairNet, 0.001e18);
        // selling what the mint bought returns what was spent, short of one raw unit per sell leg
        assertLe(gross, spent);
        assertApproxEqAbs(gross, spent, 3);
    }

    function test_mandate_rejectsQuoteTokenAboveEighteenDecimals() public {
        Dec19Token bad = new Dec19Token();
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.BadQuoteDecimals.selector, uint8(19)));
        new AgentMandate(router, registry, IERC20(address(bad)));
    }
}
