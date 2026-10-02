// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {StockRegistry} from "../src/StockRegistry.sol";
import {ShareRouter} from "../src/ShareRouter.sol";
import {BasketFactory} from "../src/BasketFactory.sol";
import {BasketVault} from "../src/BasketVault.sol";
import {AgentMandate} from "../src/AgentMandate.sol";
import {IStockRegistry} from "../src/interfaces/IStockRegistry.sol";
import {IBasketVault} from "../src/interfaces/IBasketVault.sol";
import {IERC8056} from "../src/interfaces/IERC8056.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockSwapTarget} from "../src/mocks/MockSwapTarget.sol";

/// @notice Shared helpers: read config, write deployments/<chainId>.json (consumed by packages/sdk).
abstract contract DeployBase is Script {
    using stdJson for string;

    function _deploymentsPath() internal view returns (string memory) {
        return string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
    }

    function _readDeployments() internal view returns (string memory json) {
        string memory p = _deploymentsPath();
        if (!vm.exists(p)) return "{}";
        return vm.readFile(p);
    }

    function _addr(string memory json, string memory key) internal view returns (address) {
        return json.readAddress(string.concat(".", key));
    }

    function _has(string memory json, string memory key) internal view returns (bool) {
        return json.keyExists(string.concat(".", key));
    }

    function _ticker(string memory t) internal pure returns (bytes32) {
        return bytes32(bytes(t));
    }

    /// @dev The protocol fee: bps of USDG notional (FEE_BPS, default 50, capped at 1 % in the contract), paid to
    ///      FEE_RECIPIENT (default: the admin). Kept out of run() to stay under the stack limit.
    function _setFee(StockRegistry registry, address admin) internal {
        registry.setFee(uint16(vm.envOr("FEE_BPS", uint256(50))), vm.envOr("FEE_RECIPIENT", admin));
    }

    /// @dev Number of elements in a JSON array at `path` (stdJson has no length helper for object arrays).
    function _arrayLen(string memory json, string memory path) internal view returns (uint256 n) {
        while (json.keyExists(string.concat(path, "[", vm.toString(n), "]"))) {
            n++;
        }
    }

    /// @dev The registry config for this deployment: mocks.json where a mock venue was deployed, else
    ///      robinhood.json (or the file named by MAINNET_CONFIG, relative to script/config). Both are generated
    ///      by scripts/gen-universe.mts from the official token and feed lists.
    function _config(string memory dep) internal view returns (string memory) {
        string memory file = _has(dep, "venue") ? "mocks.json" : vm.envOr("MAINNET_CONFIG", string("robinhood.json"));
        return vm.readFile(string.concat(vm.projectRoot(), "/script/config/", file));
    }
}

/// @notice Step 1: core protocol. `USDG` from env or config; ADMIN = broadcaster (documented hackathon assumption).
///   Run with `--rpc-url robinhood` (or robinhood_testnet, or a local anvil).
contract DeployCore is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address usdg = vm.envOr("USDG_ADDRESS", address(0));
        string memory existing = _readDeployments();
        if (usdg == address(0) && _has(existing, "usdg")) usdg = _addr(existing, "usdg");
        require(usdg != address(0), "USDG_ADDRESS not set and no mock USDG deployed");

        vm.startBroadcast(pk);
        StockRegistry registry = new StockRegistry(admin, usdg);
        ShareRouter router = new ShareRouter(registry);
        BasketFactory factory = new BasketFactory(registry, admin);
        AgentMandate mandate = new AgentMandate(router, registry, IERC20(usdg));
        // Nothing here needs a keeper in steady state: ratios come from each token's own multiplier and prices
        // from Chainlink. The role is held by the admin so a corporate-action checkpoint can still be posted.
        address keeper = vm.envOr("KEEPER_ADDRESS", admin);
        registry.grantRole(registry.KEEPER_ROLE(), keeper);
        registry.grantRole(registry.GUARDIAN_ROLE(), admin);
        _setFee(registry, admin);
        vm.stopBroadcast();

        string memory out = "deploy";
        out.serialize("chainId", block.chainid);
        out.serialize("deployBlock", block.number);
        out.serialize("admin", admin);
        out.serialize("keeper", keeper);
        out.serialize("feeRecipient", registry.feeRecipient());
        out.serialize("usdg", usdg);
        out.serialize("registry", address(registry));
        out.serialize("router", address(router));
        out.serialize("factory", address(factory));
        // carry over mock addresses if present
        if (_has(existing, "venue")) out.serialize("venue", _addr(existing, "venue"));
        string memory json = out.serialize("mandate", address(mandate));
        if (_has(existing, "mocks")) {
            // re-serialize the nested mocks object from the previous file
            string memory mocks = "mocks";
            string memory mocksJson;
            string[] memory keys = vm.parseJsonKeys(existing, ".mocks");
            for (uint256 i = 0; i < keys.length; i++) {
                mocksJson = mocks.serialize(keys[i], existing.readAddress(string.concat(".mocks.", keys[i])));
            }
            json = out.serialize("mocks", mocksJson);
        }
        vm.writeJson(json, _deploymentsPath());
        console2.log("registry", address(registry));
        console2.log("router", address(router));
        console2.log("factory", address(factory));
        console2.log("mandate", address(mandate));
    }
}

/// @notice Step 0 (testnet / local without fork): mocks. Writes usdg/venue/mocks into deployments.
///   Run with `--rpc-url robinhood_testnet` or a local anvil; never against mainnet.
contract DeployMocks is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/script/config/mocks.json"));
        uint256 n = _arrayLen(cfg, ".representations");

        vm.startBroadcast(pk);
        MockUSDG usdg = new MockUSDG();
        MockSwapTarget venue = new MockSwapTarget();
        venue.setKeeper(vm.envOr("KEEPER_ADDRESS", vm.addr(pk))); // may re-price the mock venue from mainnet
        venue.setPrice(address(usdg), 1e30); // 6-decimal USDG at $1: 1e18 USD per 1e18 raw units
        venue.setFeeBps(10);
        usdg.mint(address(venue), 1_000_000_000e6);
        usdg.mint(vm.addr(pk), 1_000_000e6);

        string memory mocks = "mocks";
        string memory mocksJson;
        for (uint256 i = 0; i < n; i++) {
            string memory base = string.concat(".representations[", vm.toString(i), "]");
            string memory symbol = cfg.readString(string.concat(base, ".symbol"));
            bool erc8056 = cfg.readBool(string.concat(base, ".erc8056"));
            uint256 ratio = vm.parseUint(cfg.readString(string.concat(base, ".ratio")));
            // USD per token (1e18): the Chainlink answer its mainnet token had when mocks.json was generated
            uint256 tokenPrice = vm.parseUint(cfg.readString(string.concat(base, ".tokenPriceUsd")));
            MockStockToken t = new MockStockToken(string.concat(symbol, " (mock)"), symbol, erc8056);
            if (erc8056) t.setMultiplier(ratio);
            venue.setPrice(address(t), tokenPrice);
            t.mint(address(venue), 1e24);
            mocksJson = mocks.serialize(symbol, address(t));
        }
        vm.stopBroadcast();

        string memory out = "deploy";
        out.serialize("chainId", block.chainid);
        out.serialize("usdg", address(usdg));
        out.serialize("venue", address(venue));
        string memory json = out.serialize("mocks", mocksJson);
        vm.writeJson(json, _deploymentsPath());
        console2.log("mock usdg", address(usdg));
        console2.log("venue", address(venue));
    }
}

/// @notice Step 2: register underlyings and representations, allowlist the swap target, set the freshness
///         windows and point each underlying at its reference price.
contract ConfigureRegistry is DeployBase {
    using stdJson for string;

    /// @dev Chainlink's stock feeds heartbeat every 24h, pause from Friday 20:00 to Sunday 20:00 New York time
    ///      and pause a further 24h on a market holiday. Over every round since the feeds launched (June to
    ///      October 2026) the longest gap between two answers on any stock feed was 95.98 hours, across a
    ///      holiday weekend. Five days clears that; anything older is a feed that has stopped, not a weekend.
    uint64 internal constant MAX_PRICE_AGE = 5 days;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory dep = _readDeployments();
        StockRegistry registry = StockRegistry(_addr(dep, "registry"));
        bool mocks = _has(dep, "venue");
        string memory cfg = _config(dep);

        vm.startBroadcast(pk);
        string[] memory tickers = cfg.readStringArray(".underlyings");
        for (uint256 i = 0; i < tickers.length; i++) {
            if (registry.getUnderlying(_ticker(tickers[i])).id == bytes32(0)) {
                registry.setUnderlying(_ticker(tickers[i]), tickers[i], true);
            }
        }
        if (mocks) {
            registry.setAllowedTarget(_addr(dep, "venue"), true);
        } else {
            address[] memory targets = cfg.readAddressArray(".allowedTargets");
            for (uint256 i = 0; i < targets.length; i++) {
                registry.setAllowedTarget(targets[i], true);
            }
        }
        // Robinhood publishes no attestation a contract can read, so that gate is off (an unbounded window).
        // What stands in for it is on-chain: the token's own multiplier, checked against the last checkpoint
        // within maxRatioStepBps, and the Chainlink feed.
        registry.setLimits(type(uint64).max, registry.maxRatioAge(), registry.maxRatioStepBps());
        registry.setPriceLimits(MAX_PRICE_AGE, registry.maxPriceStepBps());

        uint256 n = _arrayLen(cfg, ".representations");
        for (uint256 i = 0; i < n; i++) {
            _register(registry, cfg, dep, mocks, i);
        }
        for (uint256 i = 0; i < tickers.length; i++) {
            registry.postMarketState(_ticker(tickers[i]), true);
        }
        vm.stopBroadcast();
    }

    /// @dev One representation and its underlying's reference price. Split out to keep `run` under the stack limit.
    function _register(StockRegistry registry, string memory cfg, string memory dep, bool mocks, uint256 i) internal {
        string memory base = string.concat(".representations[", vm.toString(i), "]");
        string memory ticker = cfg.readString(string.concat(base, ".ticker"));
        string memory symbol = cfg.readString(string.concat(base, ".symbol"));
        bytes32 uid = _ticker(ticker);
        address token;
        IStockRegistry.RatioSource src;
        uint256 ratio;
        if (mocks) {
            token = dep.readAddress(string.concat(".mocks.", symbol));
            bool erc8056 = cfg.readBool(string.concat(base, ".erc8056"));
            src = erc8056 ? IStockRegistry.RatioSource.ERC8056 : IStockRegistry.RatioSource.KEEPER;
            ratio = vm.parseUint(cfg.readString(string.concat(base, ".ratio")));
        } else {
            token = cfg.readAddress(string.concat(base, ".token"));
            bool erc8056 = keccak256(bytes(cfg.readString(string.concat(base, ".source")))) == keccak256("ERC8056");
            src = erc8056 ? IStockRegistry.RatioSource.ERC8056 : IStockRegistry.RatioSource.KEEPER;
            ratio = erc8056
                ? IERC8056(token).uiMultiplier()
                : vm.parseUint(cfg.readString(string.concat(base, ".initialRatio")));
        }
        if (!registry.getRepresentation(token).exists) {
            registry.addRepresentation(token, uid, _ticker(cfg.readString(string.concat(base, ".platform"))), src, ratio);
            console2.log("registered", symbol, token);
        }
        // The reference price behind the AgentMandate floor. Mainnet: the token's Chainlink feed, which prices
        // the token with its multiplier in it, so the registry divides by the ratio. Mocks: the share price the
        // mock venue was priced at, posted once and labelled a snapshot everywhere it is shown.
        if (mocks) {
            (uint256 have,) = registry.referencePrice(uid);
            if (have == 0) {
                uint256 tokenPrice = vm.parseUint(cfg.readString(string.concat(base, ".tokenPriceUsd")));
                registry.postReferencePrice(uid, tokenPrice * 1e18 / ratio);
            }
        } else if (cfg.keyExists(string.concat(".priceFeeds.", ticker)) && registry.priceFeedOf(uid) == address(0)) {
            registry.setTokenPriceFeed(uid, cfg.readAddress(string.concat(".priceFeeds.", ticker)), token);
        }
    }
}

/// @notice Step 3: create every index in the config, cap its supply and record its address.
///         SUPPLY_CAP_UNITS (whole units, default 0 = uncapped) bounds what a vault may have outstanding.
contract CreateBasket is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory dep = _readDeployments();
        BasketFactory factory = BasketFactory(_addr(dep, "factory"));
        StockRegistry registry = StockRegistry(_addr(dep, "registry"));
        string memory cfg = _config(dep);
        uint256 capUnits = vm.envOr("SUPPLY_CAP_UNITS", uint256(0)) * 1e18;
        uint256 count = _arrayLen(cfg, ".indices");
        for (uint256 k = 0; k < count; k++) {
            string memory idx = string.concat(".indices[", vm.toString(k), "]");
            string memory symbol = cfg.readString(string.concat(idx, ".symbol"));
            if (_has(_readDeployments(), string.concat("basket_", symbol))) continue;
            IBasketVault.Constituent[] memory cs = _constituents(cfg, idx);
            vm.startBroadcast(pk);
            address basket = factory.createBasket(cfg.readString(string.concat(idx, ".name")), symbol, cs);
            if (capUnits != 0) registry.setSupplyCap(basket, capUnits);
            vm.stopBroadcast();
            vm.writeJson(vm.toString(basket), _deploymentsPath(), string.concat(".basket_", symbol));
            console2.log("basket", symbol, basket);
        }
    }

    function _constituents(string memory cfg, string memory idx)
        internal
        view
        returns (IBasketVault.Constituent[] memory cs)
    {
        uint256 n = _arrayLen(cfg, string.concat(idx, ".constituents"));
        cs = new IBasketVault.Constituent[](n);
        for (uint256 i = 0; i < n; i++) {
            string memory base = string.concat(idx, ".constituents[", vm.toString(i), "]");
            cs[i] = IBasketVault.Constituent({
                underlyingId: _ticker(cfg.readString(string.concat(base, ".ticker"))),
                sharesPerUnit: vm.parseUint(cfg.readString(string.concat(base, ".sharesPerUnit"))),
                maxIssuerBps: uint16(cfg.readUint(string.concat(base, ".maxIssuerBps")))
            });
        }
    }
}
