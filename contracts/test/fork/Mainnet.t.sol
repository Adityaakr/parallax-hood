// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockRegistry} from "../../src/StockRegistry.sol";
import {ShareRouter} from "../../src/ShareRouter.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {IStockRegistry} from "../../src/interfaces/IStockRegistry.sol";
import {IBasketVault} from "../../src/interfaces/IBasketVault.sol";
import {IERC8056} from "../../src/interfaces/IERC8056.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

interface ISmartRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @title Mainnet fork tests
/// @notice Runs against real BSC state: real bStock / Ondo tokens, real PancakeSwap v3 pools, real USDT.
///         Opt-in: `forge test --match-path 'test/fork/*' --fork-url $BSC_RPC_URL`.
contract MainnetForkTest is Test {
    // --- real addresses (docs/recon.md) ---
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant NVDAB = 0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436;
    address constant AAPLB = 0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A;
    address constant NVDAON = 0xA9eE28C80f960B889dFbd1902055218cBa016F75;
    address constant SMART_ROUTER = 0x13f4EA83D0bd40E75C8222255bc855a974568Dd4;
    address constant QUOTER_V2 = 0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997;

    bytes32 constant NVDA = bytes32("NVDA");
    bytes32 constant AAPL = bytes32("AAPL");
    bytes32 constant ONDO = bytes32("ondo");
    bytes32 constant BSTOCK = bytes32("bstock");
    uint256 constant WAD = 1e18;
    // Ondo ratio is API-sourced; this value is a labeled fixture from recon (NVDAon ~1.0037 shares/token).
    uint256 constant NVDAON_RATIO_FIXTURE = 1.0037e18;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address alice = makeAddr("alice");
    address agent = makeAddr("agent");

    StockRegistry registry;
    ShareRouter router;
    BasketFactory factory;
    BasketVault basket;
    AgentMandate mandate;

    function setUp() public {
        string memory rpc = vm.envOr("BSC_RPC_URL", string("https://bsc-dataseed.binance.org"));
        vm.createSelectFork(rpc);

        registry = new StockRegistry(admin, USDT);
        router = new ShareRouter(registry);
        factory = new BasketFactory(registry, admin);
        mandate = new AgentMandate(router, registry, IERC20(USDT));

        vm.startPrank(admin);
        registry.grantRole(registry.KEEPER_ROLE(), keeper);
        registry.setUnderlying(NVDA, "NVDA", true);
        registry.setUnderlying(AAPL, "AAPL", true);
        registry.addRepresentation(
            NVDAB, NVDA, BSTOCK, IStockRegistry.RatioSource.ERC8056, IERC8056(NVDAB).uiMultiplier()
        );
        registry.addRepresentation(
            AAPLB, AAPL, BSTOCK, IStockRegistry.RatioSource.ERC8056, IERC8056(AAPLB).uiMultiplier()
        );
        registry.addRepresentation(NVDAON, NVDA, ONDO, IStockRegistry.RatioSource.KEEPER, NVDAON_RATIO_FIXTURE);
        registry.setAllowedTarget(SMART_ROUTER, true);
        IBasketVault.Constituent[] memory cs = new IBasketVault.Constituent[](2);
        cs[0] = IBasketVault.Constituent({underlyingId: NVDA, sharesPerUnit: 0.01e18, maxIssuerBps: 10_000});
        cs[1] = IBasketVault.Constituent({underlyingId: AAPL, sharesPerUnit: 0.01e18, maxIssuerBps: 10_000});
        basket = BasketVault(factory.createBasket("Parallax Fork Basket", "pxFORK", cs));
        vm.stopPrank();

        vm.startPrank(keeper);
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        registry.postAttestation(ONDO, uint64(block.timestamp));
        vm.stopPrank();

        deal(USDT, alice, 10_000e18);
    }

    // ---- helpers ----

    function _quote(address tokenIn, address tokenOut, uint256 amountIn, uint24 fee) internal returns (uint256 out) {
        (out,,,) = IQuoterV2(QUOTER_V2)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, fee: fee, sqrtPriceLimitX96: 0
            })
            );
    }

    function _leg(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint256 minOut, address recipient)
        internal
        pure
        returns (LegExecutor.Leg memory)
    {
        return LegExecutor.Leg({
            target: SMART_ROUTER,
            data: abi.encodeCall(
                ISmartRouter.exactInputSingle,
                (ISmartRouter.ExactInputSingleParams({
                        tokenIn: tokenIn,
                        tokenOut: tokenOut,
                        fee: fee,
                        recipient: recipient,
                        amountIn: amountIn,
                        amountOutMinimum: minOut,
                        sqrtPriceLimitX96: 0
                    }))
            ),
            tokenIn: tokenIn,
            maxIn: amountIn,
            tokenOut: tokenOut
        });
    }

    function _one(LegExecutor.Leg memory a) internal pure returns (LegExecutor.Leg[] memory l) {
        l = new LegExecutor.Leg[](1);
        l[0] = a;
    }

    // ---- tests ----

    function testFork_realTokensAreContractHoldable() public {
        // both representations accept a contract recipient (the vault) and a contract sender
        deal(NVDAB, address(this), 1e18);
        IERC20(NVDAB).transfer(address(basket), 1e18);
        assertEq(IERC20(NVDAB).balanceOf(address(basket)), 1e18);
        deal(NVDAON, address(this), 1e18);
        IERC20(NVDAON).transfer(address(basket), 1e18);
        assertEq(IERC20(NVDAON).balanceOf(address(basket)), 1e18);
    }

    function testFork_buyNVDA_viaBstockPool_shareDenominated() public {
        uint256 usdtIn = 100e18;
        uint256 quoted = _quote(USDT, NVDAB, usdtIn, 500);
        uint256 ratio = IERC8056(NVDAB).uiMultiplier();
        uint256 expectedShares = quoted * ratio / WAD;
        uint256 minShares = expectedShares * 9_950 / 10_000; // 50 bps

        vm.startPrank(alice);
        IERC20(USDT).approve(address(router), usdtIn);
        uint256 shares = router.buyShares(
            NVDA,
            usdtIn,
            minShares,
            _one(_leg(USDT, NVDAB, 500, usdtIn, 0, address(router))),
            alice,
            keccak256("fork-buy")
        );
        vm.stopPrank();

        assertGe(shares, minShares);
        assertEq(IERC20(NVDAB).balanceOf(alice), quoted);
        assertEq(IERC20(NVDAB).balanceOf(address(router)), 0);
        assertEq(IERC20(USDT).balanceOf(address(router)), 0);
        console2.log("NVDAB tokens", quoted, "shares", shares);
        console2.log("cost per share (1e18 USD)", usdtIn * WAD / shares);
    }

    function testFork_minShares_revertsWhenTooTight() public {
        uint256 usdtIn = 100e18;
        uint256 quoted = _quote(USDT, NVDAB, usdtIn, 500);
        uint256 shares = quoted * IERC8056(NVDAB).uiMultiplier() / WAD;
        vm.startPrank(alice);
        IERC20(USDT).approve(address(router), usdtIn);
        vm.expectRevert(abi.encodeWithSelector(ShareRouter.InsufficientShares.selector, shares, shares + 1));
        router.buyShares(
            NVDA, usdtIn, shares + 1, _one(_leg(USDT, NVDAB, 500, usdtIn, 0, address(router))), alice, keccak256("x")
        );
        vm.stopPrank();
    }

    function _mintLegs(uint256 units) internal returns (LegExecutor.Leg[] memory legs, uint256 maxUsdt) {
        // required shares per constituent, converted to tokens, priced with the quoter (+50 bps headroom)
        uint256 nvdaTokens = registry.tokensForShares(NVDAB, units * 0.01e18 / WAD + 1);
        uint256 aaplTokens = registry.tokensForShares(AAPLB, units * 0.01e18 / WAD + 1);
        // find USDT amounts by quoting a reference size and scaling (fine for small clips)
        uint256 refUsdt = 100e18;
        uint256 nvdaPerRef = _quote(USDT, NVDAB, refUsdt, 500);
        uint256 aaplPerRef = _quote(USDT, AAPLB, refUsdt, 2500);
        uint256 uN = refUsdt * nvdaTokens / nvdaPerRef * 10_050 / 10_000 + 1;
        uint256 uA = refUsdt * aaplTokens / aaplPerRef * 10_050 / 10_000 + 1;
        legs = new LegExecutor.Leg[](2);
        legs[0] = _leg(USDT, NVDAB, 500, uN, 0, address(basket));
        legs[1] = _leg(USDT, AAPLB, 2500, uA, 0, address(basket));
        maxUsdt = uN + uA;
    }

    function testFork_basketMintRedeemInKindAndRedeem() public {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(10e18);
        vm.startPrank(alice);
        IERC20(USDT).approve(address(basket), maxUsdt);
        uint256 spent = basket.mint(10e18, maxUsdt, legs, alice, keccak256("fork-mint"));
        vm.stopPrank();
        assertEq(basket.balanceOf(alice), 10e18);
        assertTrue(basket.backingOk());
        console2.log("mint 10 units spent USDT (1e18)", spent);
        IBasketVault.ConstituentView[] memory comp = basket.composition();
        assertGe(comp[0].heldShares, comp[0].requiredShares);
        assertGe(comp[1].heldShares, comp[1].requiredShares);

        // redeem in kind half
        vm.prank(alice);
        basket.redeemInKind(5e18, alice);
        assertGt(IERC20(NVDAB).balanceOf(alice), 0);
        assertGt(IERC20(AAPLB).balanceOf(alice), 0);
        assertTrue(basket.backingOk());

        // redeem remaining to USDT through the pools
        uint256 supply = basket.totalSupply();
        uint256 nB = IERC20(NVDAB).balanceOf(address(basket)) * 5e18 / supply;
        uint256 aB = IERC20(AAPLB).balanceOf(address(basket)) * 5e18 / supply;
        LegExecutor.Leg[] memory sells = new LegExecutor.Leg[](2);
        sells[0] = _leg(NVDAB, USDT, 500, nB, 0, address(basket));
        sells[1] = _leg(AAPLB, USDT, 2500, aB, 0, address(basket));
        uint256 before = IERC20(USDT).balanceOf(alice);
        vm.prank(alice);
        uint256 out = basket.redeem(5e18, 0, sells, alice, keccak256("fork-redeem"));
        assertGt(out, 0);
        assertEq(IERC20(USDT).balanceOf(alice), before + out);
        assertEq(basket.totalSupply(), 0);
        console2.log("redeem 5 units USDT out (1e18)", out);
    }

    function testFork_migrate_ondoToBstock_gainsShares() public {
        // Seed the vault with NVDAon (as if minted through the Ondo AMM pool earlier) plus AAPLB, then mint units
        // against it by donating and minting via legs for AAPL only... simpler: donate both and mint 0 supply state.
        deal(NVDAON, address(basket), 0.05e18);
        uint256 before = basket.heldShares(0);
        assertGt(before, 0);

        // sell NVDAon into its 1 % pool, buy NVDAB with the proceeds
        uint256 sell = 0.05e18;
        uint256 usdtOut = _quote(NVDAON, USDT, sell, 10_000);
        uint256 nvdabOut = _quote(USDT, NVDAB, usdtOut, 500);
        uint256 sharesAfter = nvdabOut * IERC8056(NVDAB).uiMultiplier() / WAD;
        LegExecutor.Leg[] memory legs = new LegExecutor.Leg[](2);
        legs[0] = _leg(NVDAON, USDT, 10_000, sell, 0, address(basket));
        legs[1] = _leg(USDT, NVDAB, 500, usdtOut, 0, address(basket));
        console2.log("shares before (ondo)", before, "shares after (bstock)", sharesAfter);

        if (sharesAfter > before) {
            uint256 gain = basket.migrate(NVDA, legs, 1, keccak256("fork-migrate"));
            assertEq(basket.heldShares(0), before + gain);
            assertEq(IERC20(NVDAON).balanceOf(address(basket)), 0);
            console2.log("migration gain (shares 1e18)", gain);
        } else {
            // Not share-accretive at this block: the invariant must reject it.
            vm.expectRevert();
            basket.migrate(NVDA, legs, 0, keccak256("fork-migrate"));
            console2.log("migration not accretive at this block; correctly rejected");
        }
    }

    function testFork_agentMandateBuy() public {
        bytes32[] memory us = new bytes32[](1);
        us[0] = NVDA;
        address[] memory bs = new address[](0);
        vm.startPrank(alice);
        IERC20(USDT).approve(address(mandate), type(uint256).max);
        uint256 id = mandate.createMandate(agent, 50e18, 100e18, uint64(block.timestamp + 1 days), 300, us, bs);
        vm.stopPrank();

        uint256 usdtIn = 50e18;
        uint256 quoted = _quote(USDT, NVDAB, usdtIn, 500);
        uint256 minShares = quoted * IERC8056(NVDAB).uiMultiplier() / WAD * 9_950 / 10_000;
        vm.prank(agent);
        uint256 shares = mandate.agentBuyShares(
            id,
            NVDA,
            usdtIn,
            minShares,
            _one(_leg(USDT, NVDAB, 500, usdtIn, 0, address(router))),
            keccak256("fork-agent")
        );
        assertGe(shares, minShares);
        assertEq(IERC20(NVDAB).balanceOf(alice), quoted);
        assertEq(IERC20(NVDAB).balanceOf(agent), 0);

        // second buy exceeds the daily cap (50 spent, 100 cap, per-tx 50 -> a 51 fails per-tx, a 50 then 1 more fails daily)
        vm.prank(agent);
        mandate.agentBuyShares(
            id, NVDA, 50e18, 0, _one(_leg(USDT, NVDAB, 500, 50e18, 0, address(router))), keccak256("fork-agent-2")
        );
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.DailyCapExceeded.selector, 1e18, 0));
        mandate.agentBuyShares(
            id, NVDA, 1e18, 0, _one(_leg(USDT, NVDAB, 500, 1e18, 0, address(router))), keccak256("fork-agent-3")
        );
    }
}
