// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockRegistry} from "../src/StockRegistry.sol";
import {ShareRouter} from "../src/ShareRouter.sol";
import {BasketVault} from "../src/BasketVault.sol";
import {BasketFactory} from "../src/BasketFactory.sol";
import {AgentMandate} from "../src/AgentMandate.sol";
import {IStockRegistry} from "../src/interfaces/IStockRegistry.sol";
import {IBasketVault} from "../src/interfaces/IBasketVault.sol";
import {LegExecutor} from "../src/libraries/LegExecutor.sol";
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockSwapTarget} from "../src/mocks/MockSwapTarget.sol";

/// @dev Shared fixture: registry + router + factory + mandate, two underlyings, three representations, one basket.
///      NVDA: NVDAon (KEEPER ratio 1.0037) and NVDAB (ERC8056 multiplier 1.000778). AAPL: AAPLB only (ERC8056).
abstract contract BaseTest is Test {
    bytes32 constant NVDA = bytes32("NVDA");
    bytes32 constant AAPL = bytes32("AAPL");
    bytes32 constant ONDO = bytes32("ondo");
    bytes32 constant BSTOCK = bytes32("bstock");
    uint256 constant WAD = 1e18;

    address admin = makeAddr("admin");
    address keeper = makeAddr("keeper");
    address guardian = makeAddr("guardian");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address agent = makeAddr("agent");

    MockUSDT usdt;
    MockStockToken nvdaOn; // plain ERC-20, keeper ratio
    MockStockToken nvdaB; // ERC-8056
    MockStockToken aaplB; // ERC-8056
    MockSwapTarget venue;
    StockRegistry registry;
    ShareRouter router;
    BasketFactory factory;
    BasketVault basket;
    AgentMandate mandate;

    uint256 constant NVDA_ON_RATIO = 1.0037e18;
    uint256 constant NVDA_B_MULT = 1.000778e18;
    uint256 constant AAPL_B_MULT = 1.0006e18;
    uint256 constant NVDA_PX = 219e18; // USD per share
    uint256 constant AAPL_PX = 332e18;

    function setUp() public virtual {
        usdt = new MockUSDT();
        nvdaOn = new MockStockToken("NVIDIA (Ondo Tokenized)", "NVDAon", false);
        nvdaB = new MockStockToken("NVIDIA Corp", "NVDAB", true);
        aaplB = new MockStockToken("Apple", "AAPLB", true);
        nvdaB.setMultiplier(NVDA_B_MULT);
        aaplB.setMultiplier(AAPL_B_MULT);

        venue = new MockSwapTarget();
        venue.setPrice(address(usdt), 1e18);
        // token price = share price * ratio (fair market, no premium)
        venue.setPrice(address(nvdaOn), NVDA_PX * NVDA_ON_RATIO / WAD);
        venue.setPrice(address(nvdaB), NVDA_PX * NVDA_B_MULT / WAD);
        venue.setPrice(address(aaplB), AAPL_PX * AAPL_B_MULT / WAD);
        nvdaOn.mint(address(venue), 1_000_000e18);
        nvdaB.mint(address(venue), 1_000_000e18);
        aaplB.mint(address(venue), 1_000_000e18);
        usdt.mint(address(venue), 1_000_000_000e18);

        registry = new StockRegistry(admin, address(usdt));
        router = new ShareRouter(registry);
        factory = new BasketFactory(registry, admin);
        mandate = new AgentMandate(router, registry, IERC20(address(usdt)));

        vm.startPrank(admin);
        registry.grantRole(registry.KEEPER_ROLE(), keeper);
        registry.grantRole(registry.GUARDIAN_ROLE(), guardian);
        registry.setUnderlying(NVDA, "NVDA", true);
        registry.setUnderlying(AAPL, "AAPL", true);
        registry.addRepresentation(address(nvdaOn), NVDA, ONDO, IStockRegistry.RatioSource.KEEPER, NVDA_ON_RATIO);
        registry.addRepresentation(address(nvdaB), NVDA, BSTOCK, IStockRegistry.RatioSource.ERC8056, NVDA_B_MULT);
        registry.addRepresentation(address(aaplB), AAPL, BSTOCK, IStockRegistry.RatioSource.ERC8056, AAPL_B_MULT);
        registry.setAllowedTarget(address(venue), true);

        IBasketVault.Constituent[] memory cs = new IBasketVault.Constituent[](2);
        cs[0] = IBasketVault.Constituent({underlyingId: NVDA, sharesPerUnit: 0.1e18, maxIssuerBps: 8_000});
        cs[1] = IBasketVault.Constituent({underlyingId: AAPL, sharesPerUnit: 0.05e18, maxIssuerBps: 10_000});
        basket = BasketVault(factory.createBasket("Parallax Test Basket", "pxTEST", cs));
        vm.stopPrank();

        vm.startPrank(keeper);
        registry.postAttestation(ONDO, uint64(block.timestamp));
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        registry.postMarketState(NVDA, true);
        registry.postMarketState(AAPL, true);
        registry.postReferencePrice(NVDA, NVDA_PX);
        registry.postReferencePrice(AAPL, AAPL_PX);
        vm.stopPrank();

        usdt.mint(alice, 1_000_000e18);
        usdt.mint(bob, 1_000_000e18);
    }

    // ---- helpers ----

    function _leg(address tokenIn, address tokenOut, uint256 amountIn, address recipient)
        internal
        view
        returns (LegExecutor.Leg memory)
    {
        return LegExecutor.Leg({
            target: address(venue),
            data: abi.encodeCall(MockSwapTarget.swap, (tokenIn, tokenOut, amountIn, 0, recipient)),
            tokenIn: tokenIn,
            maxIn: amountIn,
            tokenOut: tokenOut
        });
    }

    function _legs1(LegExecutor.Leg memory a) internal pure returns (LegExecutor.Leg[] memory l) {
        l = new LegExecutor.Leg[](1);
        l[0] = a;
    }

    function _legs2(LegExecutor.Leg memory a, LegExecutor.Leg memory b)
        internal
        pure
        returns (LegExecutor.Leg[] memory l)
    {
        l = new LegExecutor.Leg[](2);
        l[0] = a;
        l[1] = b;
    }

    /// @dev USDT needed to buy `shares` of `token` at the venue (fair price, plus fee headroom).
    function _usdtForShares(address token, uint256 shares) internal view returns (uint256) {
        (uint256 ratio,) = registry.ratioOf(token);
        uint256 tokens = shares * WAD / ratio + 1;
        uint256 usd = tokens * venue.price(token) / WAD;
        return usd * (10_000 + venue.feeBps() + 5) / 10_000 + 1;
    }

    /// @dev Legs that fully back `units` of the test basket: NVDA 70 % NVDAB + 30 % NVDAon (cap is 80 %), AAPL 100 % AAPLB.
    function _mintLegs(uint256 units) internal view returns (LegExecutor.Leg[] memory legs, uint256 maxUsdt) {
        uint256 nvdaShares = units * 0.1e18 / WAD + 1;
        uint256 aaplShares = units * 0.05e18 / WAD + 1;
        uint256 uB = _usdtForShares(address(nvdaB), nvdaShares * 7 / 10 + 1);
        uint256 uO = _usdtForShares(address(nvdaOn), nvdaShares * 3 / 10 + 1);
        uint256 uA = _usdtForShares(address(aaplB), aaplShares);
        legs = new LegExecutor.Leg[](3);
        legs[0] = _leg(address(usdt), address(nvdaB), uB, address(basket));
        legs[1] = _leg(address(usdt), address(nvdaOn), uO, address(basket));
        legs[2] = _leg(address(usdt), address(aaplB), uA, address(basket));
        maxUsdt = uB + uO + uA;
    }

    /// @dev Legs using only NVDAB for NVDA (valid only when NVDAon is not buy-eligible or cap is 100 %).
    function _mintLegsBstockOnly(uint256 units) internal view returns (LegExecutor.Leg[] memory legs, uint256 maxUsdt) {
        uint256 u1 = _usdtForShares(address(nvdaB), units * 0.1e18 / WAD + 1);
        uint256 u2 = _usdtForShares(address(aaplB), units * 0.05e18 / WAD + 1);
        legs = _legs2(
            _leg(address(usdt), address(nvdaB), u1, address(basket)),
            _leg(address(usdt), address(aaplB), u2, address(basket))
        );
        maxUsdt = u1 + u2;
    }

    function _mintBasket(address who, uint256 units) internal returns (uint256 spent) {
        (LegExecutor.Leg[] memory legs, uint256 maxUsdt) = _mintLegs(units);
        vm.startPrank(who);
        usdt.approve(address(basket), maxUsdt);
        spent = basket.mint(units, maxUsdt, legs, who, keccak256("mint"));
        vm.stopPrank();
    }
}
