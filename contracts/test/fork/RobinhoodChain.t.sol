// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {StockRegistry} from "../../src/StockRegistry.sol";
import {ShareRouter} from "../../src/ShareRouter.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {IStockRegistry} from "../../src/interfaces/IStockRegistry.sol";
import {IBasketVault} from "../../src/interfaces/IBasketVault.sol";
import {IERC8056} from "../../src/interfaces/IERC8056.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";

interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    struct QuoteExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amount;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160, uint32, uint256);
    function quoteExactOutputSingle(QuoteExactOutputSingleParams memory params)
        external
        returns (uint256 amountIn, uint160, uint32, uint256);
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (uint256 amountOut, uint160[] memory, uint32[] memory, uint256);
}

interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactOutputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountOut;
        uint256 amountInMaximum;
        uint160 sqrtPriceLimitX96;
    }

    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256);
    function exactOutputSingle(ExactOutputSingleParams calldata params) external payable returns (uint256);
    function exactInput(ExactInputParams calldata params) external payable returns (uint256);
}

interface IUniswapV3Factory {
    function getPool(address a, address b, uint24 fee) external view returns (address);
}

interface IUniswapV3Pool {
    function liquidity() external view returns (uint128);
}

/// @title Robinhood Chain fork tests
/// @notice The whole flow against real chain 4663 state: the real stock tokens, their Chainlink feeds, real
///         USDG and the real Uniswap v3 pools. Every token, feed and router address is read from the generated
///         universe file, the same one the deploy scripts use, so this test cannot pass against addresses the
///         deployment would not use.
///         Opt-in: `pnpm contracts:fork-test` (scripts/fork-test.sh), which pins a block just behind the head.
///         The public endpoint keeps about ten minutes of state and a pinned run takes about ninety seconds.
contract RobinhoodChainForkTest is Test {
    using stdJson for string;

    // Uniswap v3 periphery, from Uniswap's Robinhood Chain deployment page (docs/addresses.md)
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;

    bytes32 constant NVDA = bytes32("NVDA");
    bytes32 constant TSLA = bytes32("TSLA");
    bytes32 constant ROBINHOOD = bytes32("robinhood");
    uint256 constant WAD = 1e18;
    uint256 constant USDG_SCALE = 1e12; // 6-decimal USDG to 1e18 USD
    bytes32 constant QH = keccak256("fork-quote");

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address agent = makeAddr("agent");

    string cfg;
    address usdg;
    address weth;
    address swapRouter;
    string[] tickers;
    mapping(bytes32 => address) token;
    mapping(bytes32 => address) feed;

    StockRegistry registry;
    ShareRouter router;
    BasketFactory factory;
    BasketVault basket;
    AgentMandate mandate;

    function setUp() public {
        // Pin a block (ROBINHOOD_FORK_BLOCK) so every test forks the same state and shares one cache. Unpinned,
        // each test forks a different head and refetches everything, which the rate-limited endpoint punishes.
        string memory rpc = vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com"));
        uint256 pinned = vm.envOr("ROBINHOOD_FORK_BLOCK", uint256(0));
        if (pinned == 0) vm.createSelectFork(rpc);
        else vm.createSelectFork(rpc, pinned);
        assertEq(block.chainid, 4663, "not Robinhood Chain mainnet");

        cfg = vm.readFile(string.concat(vm.projectRoot(), "/script/config/robinhood.json"));
        usdg = cfg.readAddress(".usdg");
        weth = cfg.readAddress(".weth");
        swapRouter = cfg.readAddressArray(".allowedTargets")[0];
        tickers = cfg.readStringArray(".underlyings");

        registry = new StockRegistry(admin, usdg);
        router = new ShareRouter(registry);
        factory = new BasketFactory(registry, admin);
        mandate = new AgentMandate(router, registry, IERC20(usdg));

        // what ConfigureRegistry does, step for step
        vm.startPrank(admin);
        registry.grantRole(registry.KEEPER_ROLE(), admin);
        registry.setFee(50, treasury);
        registry.setAllowedTarget(swapRouter, true);
        registry.setLimits(type(uint64).max, registry.maxRatioAge(), registry.maxRatioStepBps());
        registry.setPriceLimits(5 days, registry.maxPriceStepBps());
        for (uint256 i = 0; i < tickers.length; i++) {
            bytes32 id = bytes32(bytes(tickers[i]));
            string memory base = string.concat(".representations[", vm.toString(i), "]");
            assertEq(cfg.readString(string.concat(base, ".ticker")), tickers[i], "config order");
            token[id] = cfg.readAddress(string.concat(base, ".token"));
            feed[id] = cfg.readAddress(string.concat(".priceFeeds.", tickers[i]));
            registry.setUnderlying(id, tickers[i], true);
            registry.addRepresentation(
                token[id], id, ROBINHOOD, IStockRegistry.RatioSource.ERC8056, IERC8056(token[id]).uiMultiplier()
            );
            registry.setTokenPriceFeed(id, feed[id], token[id]);
        }
        basket = BasketVault(factory.createBasket("Parallax Magnificent 7", "pxMAG7", _indexConstituents(0)));
        vm.stopPrank();

        // real USDG, moved out of the deepest pool: the one holder certain to have it on any fork
        address pool = IUniswapV3Factory(V3_FACTORY).getPool(usdg, weth, 100);
        vm.prank(pool);
        IERC20(usdg).transfer(alice, 10_000e6);
    }

    // ---- helpers ----

    function _indexConstituents(uint256 k) internal view returns (IBasketVault.Constituent[] memory cs) {
        string memory idx = string.concat(".indices[", vm.toString(k), "].constituents");
        uint256 n;
        while (cfg.keyExists(string.concat(idx, "[", vm.toString(n), "]"))) {
            n++;
        }
        cs = new IBasketVault.Constituent[](n);
        for (uint256 i = 0; i < n; i++) {
            string memory base = string.concat(idx, "[", vm.toString(i), "]");
            cs[i] = IBasketVault.Constituent({
                underlyingId: bytes32(bytes(cfg.readString(string.concat(base, ".ticker")))),
                sharesPerUnit: vm.parseUint(cfg.readString(string.concat(base, ".sharesPerUnit"))),
                maxIssuerBps: 10_000
            });
        }
    }

    function _fees() internal pure returns (uint24[4] memory) {
        return [uint24(100), 500, 3000, 10000];
    }

    /// @dev A pool worth quoting: it exists, has in-range liquidity and holds at least 1,000 USDG. Several
    ///      pairs have a tier that was created, seeded with dust and left; quoting one makes the quoter walk the
    ///      whole tick range. The resolver's quoting client applies the same filter.
    function _liquid(address a, address b, uint24 fee) internal view returns (bool) {
        address pool = IUniswapV3Factory(V3_FACTORY).getPool(a, b, fee);
        if (pool == address(0) || IUniswapV3Pool(pool).liquidity() == 0) return false;
        return IERC20(usdg).balanceOf(pool) >= 1_000e6;
    }

    /// @dev Best single-hop exact-input quote across the liquid fee tiers.
    function _bestIn(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256 best, uint24 fee) {
        uint24[4] memory fees = _fees();
        for (uint256 i = 0; i < fees.length; i++) {
            if (!_liquid(tokenIn, tokenOut, fees[i])) continue;
            try IQuoterV2(QUOTER_V2)
                .quoteExactInputSingle(IQuoterV2.QuoteExactInputSingleParams(tokenIn, tokenOut, amountIn, fees[i], 0)) returns (
                uint256 out, uint160, uint32, uint256
            ) {
                if (out > best) (best, fee) = (out, fees[i]);
            } catch {}
        }
        require(best > 0, "no pool can fill");
    }

    /// @dev Cheapest single-hop exact-output quote across the liquid fee tiers.
    function _bestOut(address tokenIn, address tokenOut, uint256 amountOut) internal returns (uint256 best, uint24 fee) {
        uint24[4] memory fees = _fees();
        best = type(uint256).max;
        for (uint256 i = 0; i < fees.length; i++) {
            if (!_liquid(tokenIn, tokenOut, fees[i])) continue;
            try IQuoterV2(QUOTER_V2)
                .quoteExactOutputSingle(IQuoterV2.QuoteExactOutputSingleParams(tokenIn, tokenOut, amountOut, fees[i], 0)) returns (
                uint256 inp, uint160, uint32, uint256
            ) {
                if (inp < best) (best, fee) = (inp, fees[i]);
            } catch {}
        }
        require(best != type(uint256).max, "no pool can fill");
    }

    function _buyLeg(bytes32 id, uint256 usdgIn, address recipient)
        internal
        returns (LegExecutor.Leg memory leg, uint256 tokensOut)
    {
        uint24 fee;
        (tokensOut, fee) = _bestIn(usdg, token[id], usdgIn);
        leg = LegExecutor.Leg({
            target: swapRouter,
            data: abi.encodeCall(
                ISwapRouter02.exactInputSingle,
                (ISwapRouter02.ExactInputSingleParams(
                        usdg, token[id], fee, recipient, usdgIn, tokensOut * 995 / 1000, 0
                    ))
            ),
            tokenIn: usdg,
            maxIn: usdgIn,
            tokenOut: token[id]
        });
    }

    function _one(LegExecutor.Leg memory leg) internal pure returns (LegExecutor.Leg[] memory legs) {
        legs = new LegExecutor.Leg[](1);
        legs[0] = leg;
    }

    /// @dev Exact-output legs that back `units` of the basket, and the USDG ceiling that covers them and the fee.
    function _mintLegs(uint256 units) internal returns (LegExecutor.Leg[] memory legs, uint256 maxUsdg) {
        IBasketVault.Constituent[] memory cs = basket.constituents();
        legs = new LegExecutor.Leg[](cs.length);
        for (uint256 i = 0; i < cs.length; i++) {
            address t = token[cs[i].underlyingId];
            uint256 shares = units * cs[i].sharesPerUnit / WAD + 1;
            uint256 tokens = registry.tokensForShares(t, shares + shares / 10_000 + 1);
            (uint256 inp, uint24 fee) = _bestOut(usdg, t, tokens);
            uint256 maxIn = inp + inp * 30 / 10_000 + 1;
            legs[i] = LegExecutor.Leg({
                target: swapRouter,
                data: abi.encodeCall(
                    ISwapRouter02.exactOutputSingle,
                    (ISwapRouter02.ExactOutputSingleParams(usdg, t, fee, address(basket), tokens, maxIn, 0))
                ),
                tokenIn: usdg,
                maxIn: maxIn,
                tokenOut: t
            });
            maxUsdg += maxIn;
        }
        maxUsdg += maxUsdg * 50 / 10_000 + 1; // the protocol fee, taken from the unspent remainder
    }

    function _mandate() internal returns (uint256 id) {
        bytes32[] memory u = new bytes32[](1);
        u[0] = NVDA;
        address[] memory b = new address[](1);
        b[0] = address(basket);
        vm.startPrank(alice);
        IERC20(usdg).approve(address(mandate), type(uint256).max);
        id = mandate.createMandate(agent, 100e6, 150e6, uint64(block.timestamp + 7 days), 300, u, b);
        vm.stopPrank();
    }

    // ---- the universe is what the config says it is ----

    function test_tokensFeedsAndUsdgMatchTheConfig() public view {
        assertEq(IERC20Metadata(usdg).decimals(), 6);
        assertEq(IERC20Metadata(usdg).symbol(), "USDG");
        assertEq(mandate.quoteScale(), USDG_SCALE);
        assertEq(tickers.length, 7);
        for (uint256 i = 0; i < tickers.length; i++) {
            bytes32 id = bytes32(bytes(tickers[i]));
            assertEq(IERC20Metadata(token[id]).symbol(), tickers[i]);
            assertEq(IERC20Metadata(token[id]).decimals(), 18);
            assertGe(IERC8056(token[id]).uiMultiplier(), 1e18);
            assertEq(IAggregatorV3(feed[id]).decimals(), 8);
            (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed[id]).latestRoundData();
            assertGt(answer, 0);
            assertLe(block.timestamp - updatedAt, registry.maxPriceAge(), "feed older than the price window");
            assertTrue(registry.isBuyEligible(token[id]));
        }
    }

    /// The feed prices the token with its multiplier in it; the registry hands back the price of a share.
    function test_referencePriceIsPerShare() public view {
        (, int256 answer,,,) = IAggregatorV3(feed[NVDA]).latestRoundData();
        uint256 perToken = uint256(answer) * 1e10;
        (uint256 perShare, uint64 at) = registry.referencePrice(NVDA);
        assertEq(perShare, perToken * WAD / IERC8056(token[NVDA]).uiMultiplier());
        assertLe(perShare, perToken);
        assertGt(at, 0);
        console2.log("NVDA USD per token (1e18)", perToken);
        console2.log("NVDA USD per share (1e18)", perShare);
    }

    // ---- route a buy, then sell it back ----

    function test_buySharesThroughUniswap_thenSell() public {
        uint256 usdgIn = 100e6;
        (LegExecutor.Leg memory leg, uint256 tokensOut) = _buyLeg(NVDA, usdgIn, address(router));
        uint256 expected = registry.sharesForTokens(token[NVDA], tokensOut);
        uint256 total = usdgIn + usdgIn * 50 / 10_000;

        vm.startPrank(alice);
        IERC20(usdg).approve(address(router), total);
        uint256 before = IERC20(usdg).balanceOf(alice);
        uint256 shares = router.buyShares(NVDA, total, expected * 995 / 1000, _one(leg), alice, QH);
        vm.stopPrank();

        assertEq(before - IERC20(usdg).balanceOf(alice), total, "notional plus the 50 bps fee");
        assertEq(IERC20(usdg).balanceOf(treasury), usdgIn * 50 / 10_000);
        assertEq(shares, registry.sharesForTokens(token[NVDA], IERC20(token[NVDA]).balanceOf(alice)));
        // 100 USDG buys what the Chainlink price says it should, within a percent of pool fee and spread
        (uint256 px,) = registry.referencePrice(NVDA);
        assertApproxEqRel(shares, usdgIn * USDG_SCALE * WAD / px, 0.01e18);
        assertEq(IERC20(token[NVDA]).balanceOf(address(router)), 0);
        assertEq(IERC20(usdg).balanceOf(address(router)), 0);
        assertEq(IERC20(usdg).allowance(address(router), swapRouter), 0, "approval reset after the leg");

        // sell the lot back
        uint256 held = IERC20(token[NVDA]).balanceOf(alice);
        (uint256 usdgOut, uint24 fee) = _bestIn(token[NVDA], usdg, held);
        LegExecutor.Leg memory sell = LegExecutor.Leg({
            target: swapRouter,
            data: abi.encodeCall(
                ISwapRouter02.exactInputSingle,
                (ISwapRouter02.ExactInputSingleParams(
                        token[NVDA], usdg, fee, address(router), held, usdgOut * 995 / 1000, 0
                    ))
            ),
            tokenIn: token[NVDA],
            maxIn: held,
            tokenOut: usdg
        });
        vm.startPrank(alice);
        IERC20(token[NVDA]).approve(address(router), held);
        before = IERC20(usdg).balanceOf(alice);
        uint256 got = router.sellShares(NVDA, token[NVDA], held, usdgOut * 990 / 1000, _one(sell), alice, QH);
        vm.stopPrank();
        assertEq(IERC20(usdg).balanceOf(alice) - before, got);
        assertGt(got, 97e6, "round trip costs two pool fees and two protocol fees, not more");
        assertLt(got, 100e6);
        assertEq(IERC20(token[NVDA]).balanceOf(alice), 0);
    }

    /// A leg may go through WETH where that is the deeper path; the router only looks at balance deltas.
    function test_buyThroughWeth_twoHops() public {
        uint256 usdgIn = 100e6;
        bytes memory path = abi.encodePacked(usdg, uint24(100), weth, uint24(500), token[NVDA]);
        (uint256 tokensOut,,,) = IQuoterV2(QUOTER_V2).quoteExactInput(path, usdgIn);
        LegExecutor.Leg memory leg = LegExecutor.Leg({
            target: swapRouter,
            data: abi.encodeCall(
                ISwapRouter02.exactInput,
                (ISwapRouter02.ExactInputParams(path, address(router), usdgIn, tokensOut * 995 / 1000))
            ),
            tokenIn: usdg,
            maxIn: usdgIn,
            tokenOut: token[NVDA]
        });
        uint256 total = usdgIn + usdgIn * 50 / 10_000;
        vm.startPrank(alice);
        IERC20(usdg).approve(address(router), total);
        uint256 shares = router.buyShares(NVDA, total, 1, _one(leg), alice, QH);
        vm.stopPrank();
        (uint256 px,) = registry.referencePrice(NVDA);
        assertApproxEqRel(shares, usdgIn * USDG_SCALE * WAD / px, 0.01e18);
        assertEq(IERC20(weth).balanceOf(address(router)), 0);
    }

    // ---- a USDG index vault: deposit, redeem to USDG, redeem in kind ----

    function test_mag7Vault_mintRedeemAndRedeemInKind() public {
        uint256 units = 2e18; // two units of about 100 dollars each
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(units);
        assertEq(legs.length, 7);
        vm.startPrank(alice);
        IERC20(usdg).approve(address(basket), maxUsdg);
        uint256 spent = basket.mint(units, maxUsdg, legs, alice, QH);
        vm.stopPrank();
        assertEq(basket.balanceOf(alice), units);
        assertTrue(basket.backingOk());
        for (uint256 i = 0; i < basket.constituentCount(); i++) {
            assertGe(basket.heldShares(i), basket.requiredShares(i));
        }
        // the index was sized to about 100 dollars a unit when the config was generated; prices have moved since
        assertGt(spent, 180e6);
        assertLt(spent, 230e6);
        assertEq(IERC20(usdg).balanceOf(address(basket)), 0, "unspent USDG refunded, none left in the vault");
        console2.log("USDG spent on two pxMAG7 units (6 decimals)", spent);

        uint256 out1 = _redeemOneUnitToUsdg();
        assertApproxEqRel(out1, spent / 2, 0.03e18); // back within pool fees and two protocol fees
        assertTrue(basket.backingOk());

        // redeem the other unit in kind: no venue, no oracle, no fee, just the tokens
        vm.prank(alice);
        basket.redeemInKind(1e18, alice);
        assertEq(basket.totalSupply(), 0);
        IBasketVault.Constituent[] memory cs = basket.constituents();
        for (uint256 i = 0; i < cs.length; i++) {
            address t = token[cs[i].underlyingId];
            assertGe(registry.sharesForTokens(t, IERC20(t).balanceOf(alice)), cs[i].sharesPerUnit, "a unit's shares");
            assertEq(IERC20(t).balanceOf(address(basket)), 0);
        }
    }

    /// @dev Redeem one unit to USDG: the vault sells exactly that unit's slice of every holding.
    function _redeemOneUnitToUsdg() internal returns (uint256 out) {
        IBasketVault.Constituent[] memory cs = basket.constituents();
        LegExecutor.Leg[] memory sells = new LegExecutor.Leg[](cs.length);
        uint256 expectedOut;
        for (uint256 i = 0; i < cs.length; i++) {
            address t = token[cs[i].underlyingId];
            uint256 slice = IERC20(t).balanceOf(address(basket)) * 1e18 / basket.totalSupply();
            (uint256 q, uint24 fee) = _bestIn(t, usdg, slice);
            expectedOut += q;
            sells[i] = LegExecutor.Leg({
                target: swapRouter,
                data: abi.encodeCall(
                    ISwapRouter02.exactInputSingle,
                    (ISwapRouter02.ExactInputSingleParams(t, usdg, fee, address(basket), slice, q * 995 / 1000, 0))
                ),
                tokenIn: t,
                maxIn: slice,
                tokenOut: usdg
            });
        }
        uint256 before = IERC20(usdg).balanceOf(alice);
        vm.prank(alice);
        out = basket.redeem(1e18, expectedOut * 985 / 1000, sells, alice, QH);
        assertEq(IERC20(usdg).balanceOf(alice) - before, out);
    }

    // ---- an agent under a mandate ----

    function test_agentBuysWithinTheMandate_ownerReceives() public {
        uint256 id = _mandate();
        (LegExecutor.Leg memory leg,) = _buyLeg(NVDA, 50e6, address(router));
        uint256 total = 50e6 + 50e6 * 50 / 10_000;
        uint256 before = IERC20(usdg).balanceOf(alice);
        vm.prank(agent);
        uint256 shares = mandate.agentBuyShares(id, NVDA, total, 1, _one(leg), QH);
        assertGe(shares, mandate.sharesFloor(id, NVDA, total));
        assertEq(before - IERC20(usdg).balanceOf(alice), total);
        assertGt(IERC20(token[NVDA]).balanceOf(alice), 0, "the owner holds the stock");
        assertEq(IERC20(token[NVDA]).balanceOf(agent), 0, "the agent holds nothing");
        assertEq(IERC20(usdg).balanceOf(agent), 0);
        assertEq(mandate.remainingDaily(id), 150e6 - total);
    }

    function test_agentMintsTheVaultWithinTheMandate() public {
        uint256 id = _mandate();
        (LegExecutor.Leg[] memory legs, uint256 maxUsdg) = _mintLegs(0.5e18);
        assertLt(maxUsdg, 100e6);
        vm.prank(agent);
        uint256 spent = mandate.agentMintBasket(id, address(basket), 0.5e18, maxUsdg, legs, QH);
        assertEq(basket.balanceOf(alice), 0.5e18);
        assertEq(basket.balanceOf(agent), 0);
        assertLe(spent, maxUsdg);
        assertTrue(basket.backingOk());
    }

    function test_mandateBlocksEveryOutOfBoundsTrade() public {
        uint256 id = _mandate();

        // over the per-transaction cap
        (LegExecutor.Leg memory big,) = _buyLeg(NVDA, 101e6, address(router));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.PerTxCapExceeded.selector, 101e6, 100e6));
        mandate.agentBuyShares(id, NVDA, 101e6, 1, _one(big), QH);

        // a stock the owner did not allow
        (LegExecutor.Leg memory tsla,) = _buyLeg(TSLA, 50e6, address(router));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.UnderlyingNotAllowed.selector, TSLA));
        mandate.agentBuyShares(id, TSLA, 50e6, 1, _one(tsla), QH);

        // a real swap whose output the agent routes to itself: the router sees nothing arrive and the call fails
        (LegExecutor.Leg memory steal,) = _buyLeg(NVDA, 50e6, agent);
        vm.prank(agent);
        vm.expectRevert();
        mandate.agentBuyShares(id, NVDA, 50e6, 1, _one(steal), QH);
        assertEq(IERC20(token[NVDA]).balanceOf(agent), 0);

        // asking for 50 and spending 25: the unspent half goes back to the owner and only the spend counts
        (LegExecutor.Leg memory half,) = _buyLeg(NVDA, 25e6, address(router));
        vm.prank(agent);
        uint256 shares = mandate.agentBuyShares(id, NVDA, 50e6, 1, _one(half), QH);
        uint256 spent = 25e6 + 25e6 * 50 / 10_000;
        assertGe(shares, mandate.sharesFloor(id, NVDA, spent));
        assertEq(mandate.getMandate(id).spentInWindow, spent, "only what was spent counts");

        // the daily cap, then revocation
        (LegExecutor.Leg memory a,) = _buyLeg(NVDA, 99e6, address(router));
        vm.prank(agent);
        mandate.agentBuyShares(id, NVDA, 100e6, 1, _one(a), QH);
        uint256 left = mandate.remainingDaily(id);
        assertLt(left, 61e6);
        (LegExecutor.Leg memory b,) = _buyLeg(NVDA, 60e6, address(router));
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(AgentMandate.DailyCapExceeded.selector, 61e6, left));
        mandate.agentBuyShares(id, NVDA, 61e6, 1, _one(b), QH);

        vm.prank(alice);
        mandate.revoke(id);
        (LegExecutor.Leg memory c,) = _buyLeg(NVDA, 10e6, address(router));
        vm.prank(agent);
        vm.expectRevert(AgentMandate.MandateInactive.selector);
        mandate.agentBuyShares(id, NVDA, 11e6, 1, _one(c), QH);
    }
}
