// SPDX-License-Identifier: MIT
pragma solidity >=0.6.2 <0.9.0;

import {Actor} from "./Actor.sol";
import {Clamp} from "./utils/Clamp.sol";
import {DecimalPrinter} from "./utils/DecimalPrinter.sol";
import {Deployer} from "./utils/Deployer.sol";
import {vm} from "./utils/Hevm.sol";
import {Logger} from "./utils/Logger.sol";
import {Math} from "./utils/Math.sol";
import {StringUtils} from "./utils/StringUtils.sol";
import {EnumerableSet} from "./utils/EnumerableSet.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockRegistry} from "../../src/StockRegistry.sol";
import {ShareRouter} from "../../src/ShareRouter.sol";
import {BasketVault} from "../../src/BasketVault.sol";
import {BasketFactory} from "../../src/BasketFactory.sol";
import {AgentMandate} from "../../src/AgentMandate.sol";
import {IStockRegistry} from "../../src/interfaces/IStockRegistry.sol";
import {IBasketVault} from "../../src/interfaces/IBasketVault.sol";
import {LegExecutor} from "../../src/libraries/LegExecutor.sol";
import {MockUSDT} from "../../src/mocks/MockUSDT.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockSwapTarget} from "../../src/mocks/MockSwapTarget.sol";

/// @notice Base contract with state variables and setup functions
abstract contract Base is StringUtils, Clamp, Deployer, Math {
    using DecimalPrinter for uint256;
    using EnumerableSet for EnumerableSet.UintSet;

    string[] internal ACTOR_LABELS = ["Alice", "Bob", "Charlie"];
    uint256 internal constant BLOCK_INTERVAL = 12 seconds;
    uint256 internal constant INITIAL_ETH_BALANCE = 1_000 ether;
    uint256 internal constant INITIAL_TOKEN_BALANCE = 10_000;
    uint256 internal constant INITIAL_USDT = 1_000_000e18;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    // Fixture values mirrored from test/Base.t.sol: NVDA has two representations (keeper-ratio NVDAon at
    // 1.0037, ERC-8056 NVDAB at 1.000778), AAPL one (AAPLB at 1.0006). The venue prices tokens at share
    // price x ratio (fair market) and charges no fee unless a handler sets one.
    bytes32 internal constant NVDA = bytes32("NVDA");
    bytes32 internal constant AAPL = bytes32("AAPL");
    bytes32 internal constant ONDO = bytes32("ondo");
    bytes32 internal constant BSTOCK = bytes32("bstock");
    uint256 internal constant NVDA_ON_RATIO = 1.0037e18;
    uint256 internal constant NVDA_B_MULT = 1.000778e18;
    uint256 internal constant AAPL_B_MULT = 1.0006e18;
    uint256 internal constant NVDA_PX = 219e18;
    uint256 internal constant AAPL_PX = 332e18;
    uint256 internal constant NVDA_PER_UNIT = 0.1e18;
    uint256 internal constant AAPL_PER_UNIT = 0.05e18;
    uint16 internal constant NVDA_ISSUER_CAP = 8_000;

    // ―――――――――――――――――――――――――― Ghosts ――――――――――――――――――――――――――

    struct Ghosts {
        mapping(address => uint256) routerDonated; // tokens pushed straight to the router, per token
        mapping(address => uint256) vaultDonated; // tokens pushed straight to the vault, per token
        bool freeMintSucceeded; // a mint without full delivery went through (must never)
        uint256 feePaid; // protocol fee observed leaving callers, cumulative
        uint256 feeRecipientHigh; // high-water mark of the fee recipient's USDT balance
        uint256 vaultWindfalls; // events that leave value in the vault for later holders: migrations, forfeited slices, donations (GL-05)
        mapping(address => uint256) mandateDonated; // tokens pushed straight to the mandate, per token (GL-04)

        // ---- AgentMandate bookkeeping (GL-06, GL-07, GL-21, GL-31) ----
        uint256[] allMandateIds; // every id ever created, in creation order
        mapping(uint256 => address) ownerAtCreation;
        mapping(uint256 => address) agentAtCreation;
        mapping(uint256 => uint64) mandateWindowStart; // last observed windowStart per id
        mapping(uint256 => uint256) mandateWindowSpend; // last observed spentInWindow per id
        EnumerableSet.UintSet everRevokedMandateIds;

        // ---- StockRegistry bookkeeping ----
        mapping(address => bytes32) repUnderlyingAtRegistration; // GL-20
        mapping(address => bytes32) repPlatformAtRegistration; // GL-20
        mapping(address => uint8) repSourceAtRegistration; // GL-20 (RatioSource)
        bool lastBuysPaused; // GL-23, written only by _stockRegistry_setBuysPaused
        uint256 lastMandateNextId; // GL-24
        mapping(bytes32 => uint64) lastAttestedAt; // GL-25
        mapping(bytes32 => uint256) lastRepCount; // GL-26
        uint256 lastUnderlyingCount; // GL-27
        mapping(address => uint256) ratioWindowAnchor; // GL-19, independent step-window oracle
        mapping(address => uint256) ratioLastObserved; // GL-19
        mapping(address => uint64) ratioWindowStart; // GL-19

        // ---- BasketVault issuer-cap ratchet (GL-37) ----
        uint256 lastNvdaBstockShares;
        uint256 lastNvdaHeldShares;
    }

    Ghosts internal ghosts;

    // ―――――――――――――――――――――――――― Actors ――――――――――――――――――――――――――

    address[] internal actors;
    address internal actor;
    address internal admin;
    address internal keeper = address(0xC0DE1);
    address internal guardian = address(0xC0DE2);
    address internal agent = address(0xC0DE3);
    address internal feeRecipient = address(0xC0DE4);

    modifier asKeeper() virtual {
        vm.startPrank(keeper);
        _;
        vm.stopPrank();
    }

    modifier asGuardian() virtual {
        vm.startPrank(guardian);
        _;
        vm.stopPrank();
    }

    modifier asAgent() virtual {
        vm.startPrank(agent);
        _;
        vm.stopPrank();
    }

    modifier asActor() virtual {
        vm.startPrank(actor);
        _;
        vm.stopPrank();
    }

    modifier asAdmin() virtual {
        vm.startPrank(admin);
        _;
        vm.stopPrank();
    }

    // ―――――――――――――――――――――――― Contracts ―――――――――――――――――――――――――

    MockUSDT public usdt;
    MockStockToken public nvdaOn; // plain ERC-20, keeper ratio
    MockStockToken public nvdaB; // ERC-8056
    MockStockToken public aaplB; // ERC-8056
    MockSwapTarget public venue;
    StockRegistry public registry;
    ShareRouter public router;
    BasketFactory public factory;
    BasketVault public basket;
    AgentMandate public mandate;
    address[] internal reps; // every registered representation, in registration order

    // ―――――――――――――――――――――――――― Setup ―――――――――――――――――――――――――――

    function setup() internal {
        admin = address(this);
        vm.label(admin, "Admin");
        vm.label(keeper, "Keeper");
        vm.label(guardian, "Guardian");
        vm.label(agent, "Agent");

        usdt = new MockUSDT();
        nvdaOn = new MockStockToken("NVIDIA (Ondo Tokenized)", "NVDAon", false);
        nvdaB = new MockStockToken("NVIDIA Corp", "NVDAB", true);
        aaplB = new MockStockToken("Apple", "AAPLB", true);
        nvdaB.setMultiplier(NVDA_B_MULT);
        aaplB.setMultiplier(AAPL_B_MULT);

        venue = new MockSwapTarget();
        venue.setPrice(address(usdt), 1e18);
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

        registry.grantRole(registry.KEEPER_ROLE(), keeper);
        registry.grantRole(registry.GUARDIAN_ROLE(), guardian);
        registry.setUnderlying(NVDA, "NVDA", true);
        registry.setUnderlying(AAPL, "AAPL", true);
        registry.addRepresentation(address(nvdaOn), NVDA, ONDO, IStockRegistry.RatioSource.KEEPER, NVDA_ON_RATIO);
        registry.addRepresentation(address(nvdaB), NVDA, BSTOCK, IStockRegistry.RatioSource.ERC8056, NVDA_B_MULT);
        registry.addRepresentation(address(aaplB), AAPL, BSTOCK, IStockRegistry.RatioSource.ERC8056, AAPL_B_MULT);
        reps.push(address(nvdaOn));
        reps.push(address(nvdaB));
        reps.push(address(aaplB));
        // GL-20: snapshot each representation's identity as registered, so the property can catch any later
        // mutation of fields the contract intends to be write-once.
        for (uint256 i = 0; i < reps.length; i++) {
            IStockRegistry.Representation memory r = registry.getRepresentation(reps[i]);
            ghosts.repUnderlyingAtRegistration[reps[i]] = r.underlyingId;
            ghosts.repPlatformAtRegistration[reps[i]] = r.platformId;
            ghosts.repSourceAtRegistration[reps[i]] = uint8(r.ratioSource);
        }
        registry.setAllowedTarget(address(venue), true);
        registry.setFee(50, feeRecipient); // the production fee: 0.5 %

        IBasketVault.Constituent[] memory cs = new IBasketVault.Constituent[](2);
        cs[0] = IBasketVault.Constituent({underlyingId: NVDA, sharesPerUnit: NVDA_PER_UNIT, maxIssuerBps: NVDA_ISSUER_CAP});
        cs[1] = IBasketVault.Constituent({underlyingId: AAPL, sharesPerUnit: AAPL_PER_UNIT, maxIssuerBps: 10_000});
        basket = BasketVault(factory.createBasket("Parallax Fuzz Basket", "pxFUZZ", cs));

        vm.startPrank(keeper);
        registry.postAttestation(ONDO, uint64(block.timestamp));
        registry.postAttestation(BSTOCK, uint64(block.timestamp));
        registry.postMarketState(NVDA, true);
        registry.postMarketState(AAPL, true);
        registry.postReferencePrice(NVDA, NVDA_PX);
        registry.postReferencePrice(AAPL, AAPL_PX);
        vm.stopPrank();

        // the mocks' owner-only knobs (pause, blocklist, multiplier) and the venue's keeper knobs are driven
        // by handlers from the harness itself
        venue.setKeeper(admin);

        setupActors();
    }

    function setupActors() internal {
        admin = address(this);
        vm.label(admin, "Admin");

		for (uint256 i; i < ACTOR_LABELS.length; i++) {
			address _actor = address(new Actor{value: INITIAL_ETH_BALANCE}());
            actors.push(_actor);
            if (ACTOR_LABELS.length > i) {
                vm.label(_actor, ACTOR_LABELS[i]);
            }
            usdt.mint(_actor, INITIAL_USDT);
            vm.startPrank(_actor);
            usdt.approve(address(router), type(uint256).max);
            usdt.approve(address(basket), type(uint256).max);
            usdt.approve(address(mandate), type(uint256).max);
            nvdaOn.approve(address(router), type(uint256).max);
            nvdaB.approve(address(router), type(uint256).max);
            aaplB.approve(address(router), type(uint256).max);
            vm.stopPrank();
		}
        actor = actors[0];
    }

    // ――――――――――――――――――――――― Leg helpers ――――――――――――――――――――――――

    /// @dev One venue swap leg; `recipient` is the contract that executes it (router, basket) unless a handler
    ///      deliberately misdirects it.
    function _leg(address tokenIn, address tokenOut, uint256 amountIn, address recipient)
        internal
        view
        returns (LegExecutor.Leg memory)
    {
        return LegExecutor.Leg({
            target: address(venue),
            data: abi.encodeWithSelector(MockSwapTarget.swap.selector, tokenIn, tokenOut, amountIn, 0, recipient),
            tokenIn: tokenIn,
            maxIn: amountIn,
            tokenOut: tokenOut
        });
    }

    function _legs1(LegExecutor.Leg memory a) internal pure returns (LegExecutor.Leg[] memory l) {
        l = new LegExecutor.Leg[](1);
        l[0] = a;
    }

    /// @dev USDT that buys `shares` of `token` at the venue's current price, with headroom for the venue fee.
    function _usdtForShares(address token, uint256 shares) internal view returns (uint256) {
        (uint256 ratio,) = registry.ratioOf(token);
        if (ratio == 0) return 0;
        uint256 tokens = shares * WAD / ratio + 1;
        uint256 usd = tokens * venue.price(token) / WAD;
        return usd * (BPS + venue.feeBps() + 5) / BPS + 1;
    }

    /// @dev Legs that fully back `units` of the basket: NVDA split `bstockBps` NVDAB / rest NVDAon, AAPL all AAPLB.
    function _mintLegs(uint256 units, uint256 bstockBps)
        internal
        view
        returns (LegExecutor.Leg[] memory legs, uint256 maxUsdt)
    {
        uint256 nvdaShares = units * NVDA_PER_UNIT / WAD + 1;
        uint256 aaplShares = units * AAPL_PER_UNIT / WAD + 1;
        uint256 uB = bstockBps == 0 ? 0 : _usdtForShares(address(nvdaB), nvdaShares * bstockBps / BPS + 1);
        uint256 uO = bstockBps == BPS ? 0 : _usdtForShares(address(nvdaOn), nvdaShares * (BPS - bstockBps) / BPS + 1);
        uint256 uA = _usdtForShares(address(aaplB), aaplShares);
        uint256 n = (uB > 0 ? 1 : 0) + (uO > 0 ? 1 : 0) + 1;
        legs = new LegExecutor.Leg[](n);
        uint256 k;
        if (uB > 0) legs[k++] = _leg(address(usdt), address(nvdaB), uB, address(basket));
        if (uO > 0) legs[k++] = _leg(address(usdt), address(nvdaOn), uO, address(basket));
        legs[k] = _leg(address(usdt), address(aaplB), uA, address(basket));
        maxUsdt = uB + uO + uA;
        // the protocol fee is paid from the unspent remainder: size the budget to cover it
        maxUsdt = maxUsdt + maxUsdt * 60 / BPS + 1;
    }

    /// @dev The part of `usdtIn` the legs may spend so the protocol fee on it fits in the remainder.
    function _notional(uint256 usdtIn) internal view returns (uint256) {
        (uint16 feeBps,) = registry.fee();
        return usdtIn * BPS / (BPS + feeBps) - (usdtIn > 1 ? 1 : 0);
    }

    /// @dev Shares of `token` an actor holds, by the registry's live ratio.
    function _sharesHeld(address token, address who) internal view returns (uint256) {
        uint256 bal = IERC20(token).balanceOf(who);
        return bal == 0 ? 0 : registry.sharesForTokens(token, bal);
    }

    // ――――――――――――――――――――――――― Helpers ――――――――――――――――――――――――――

    // Maps an arbitrary address to an actor address
    function toActor(address addy) internal view returns (address) {
        return actors[uint256(uint160(addy)) % actors.length];
    }

    // Maps an arbitrary address to an actor address that is different from the current actor
    function toActorNotCurrent(address addy) internal view returns (address) {
        address _actor = actors[uint256(uint160(addy)) % actors.length];
        if (_actor == actor) {
            _actor = actors[(uint256(uint160(addy)) + 1) % actors.length];
        }
        return _actor;
    }

    // Sums the native token balances of all actors
    function sumActorsBalances() internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            sumOfBalances += actors[i].balance;
        }
    }

    // Sums the ERC-20 token balances of all actors for a given token
    function sumActorsERC20Balances(address _token) internal view returns (uint256 sumOfBalances) {
        for (uint256 i; i < actors.length; i++) {
            bytes memory data = abi.encodeWithSignature("balanceOf(address)", actors[i]);
            (bool success, bytes memory result) = _token.staticcall(data);
            require(success, "sumActorsERC20Balances: failed to get balance");
            sumOfBalances += abi.decode(result, (uint256));
        }
    }

    function skipBlocks(uint256 blocks) internal {
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + blocks * BLOCK_INTERVAL);
    }

    function skipTime(uint256 time) internal {
        uint256 blocks = (time + BLOCK_INTERVAL - 1) / BLOCK_INTERVAL;
        vm.roll(block.number + blocks);
        vm.warp(block.timestamp + time);
    }
}
