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
import {MockUSDT} from "../src/mocks/MockUSDT.sol";
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

    /// @dev The protocol fee: bps of USDT notional (FEE_BPS, default 50, capped at 1 % in the contract), paid to
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

    /// @dev The mainnet registry config: bsc.json, or the file named by MAINNET_CONFIG (relative to script/config).
    function _mainnetConfig() internal view returns (string memory) {
        return string.concat("/script/config/", vm.envOr("MAINNET_CONFIG", string("bsc.json")));
    }

}

/// @notice Step 1: core protocol. `USDT` from env or config; ADMIN = broadcaster (documented hackathon assumption).
///   forge script script/Deploy.s.sol:DeployCore --rpc-url bsc --broadcast --verify
contract DeployCore is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address admin = vm.addr(pk);
        address usdt = vm.envOr("USDT_ADDRESS", address(0));
        string memory existing = _readDeployments();
        if (usdt == address(0) && _has(existing, "usdt")) usdt = _addr(existing, "usdt");
        require(usdt != address(0), "USDT_ADDRESS not set and no mock USDT deployed");

        vm.startBroadcast(pk);
        StockRegistry registry = new StockRegistry(admin, usdt);
        ShareRouter router = new ShareRouter(registry);
        BasketFactory factory = new BasketFactory(registry, admin);
        AgentMandate mandate = new AgentMandate(router, registry, IERC20(usdt));
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
        out.serialize("usdt", usdt);
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

/// @notice Step 0 (testnet / local without fork): mocks. Writes usdt/venue/mocks into deployments.
///   forge script script/Deploy.s.sol:DeployMocks --rpc-url bsc_testnet --broadcast
contract DeployMocks is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory cfg = vm.readFile(string.concat(vm.projectRoot(), "/script/config/mocks.json"));
        uint256 n = _arrayLen(cfg, ".representations");

        vm.startBroadcast(pk);
        MockUSDT usdt = new MockUSDT();
        MockSwapTarget venue = new MockSwapTarget();
        venue.setKeeper(vm.envOr("KEEPER_ADDRESS", vm.addr(pk))); // the keeper mirrors mainnet prices onto it
        venue.setPrice(address(usdt), 1e18);
        venue.setFeeBps(10);
        usdt.mint(address(venue), 1e27);
        usdt.mint(vm.addr(pk), 1e24);

        string memory mocks = "mocks";
        string memory mocksJson;
        for (uint256 i = 0; i < n; i++) {
            string memory base = string.concat(".representations[", vm.toString(i), "]");
            string memory symbol = cfg.readString(string.concat(base, ".symbol"));
            bool erc8056 = cfg.readBool(string.concat(base, ".erc8056"));
            uint256 ratio = vm.parseUint(cfg.readString(string.concat(base, ".ratio")));
            // USD per raw token, as the catalogue quotes it and as the venue prices it
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
        out.serialize("usdt", address(usdt));
        out.serialize("venue", address(venue));
        string memory json = out.serialize("mocks", mocksJson);
        vm.writeJson(json, _deploymentsPath());
        console2.log("mock usdt", address(usdt));
        console2.log("venue", address(venue));
    }
}

/// @notice Step 2: register underlyings + representations, allowlist swap targets, post initial attestations.
///   Mainnet reads script/config/bsc.json (or $MAINNET_CONFIG, e.g. bsc-indices.json for the index universe
///   only); testnet/local-mocks read mocks.json + deployments mocks.
contract ConfigureRegistry is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory dep = _readDeployments();
        StockRegistry registry = StockRegistry(_addr(dep, "registry"));
        bool mocks = _has(dep, "venue");
        string memory cfg = vm.readFile(
            string.concat(vm.projectRoot(), mocks ? "/script/config/mocks.json" : _mainnetConfig())
        );

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
        uint256 n = _arrayLen(cfg, ".representations");
        for (uint256 i = 0; i < n; i++) {
            string memory base = string.concat(".representations[", vm.toString(i), "]");
            string memory symbol = cfg.readString(string.concat(base, ".symbol"));
            bytes32 uid = _ticker(cfg.readString(string.concat(base, ".ticker")));
            bytes32 pid = _ticker(cfg.readString(string.concat(base, ".platform")));
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
                registry.addRepresentation(token, uid, pid, src, ratio);
                console2.log("registered", symbol, token);
            }
        }
        // initial attestation + market state so the system is live; the keeper refreshes both.
        registry.postAttestation(_ticker("ondo"), uint64(block.timestamp));
        registry.postAttestation(_ticker("bstock"), uint64(block.timestamp));
        for (uint256 i = 0; i < tickers.length; i++) {
            registry.postMarketState(_ticker(tickers[i]), true);
        }
        // reference prices for the AgentMandate floor: Chainlink feeds where mainnet has them, otherwise the
        // keeper posts Binance reference prices. Mocks seed the share price the venue was priced at.
        if (mocks) {
            for (uint256 i = 0; i < n; i++) {
                string memory base = string.concat(".representations[", vm.toString(i), "]");
                bytes32 uid = _ticker(cfg.readString(string.concat(base, ".ticker")));
                (uint256 have,) = registry.referencePrice(uid);
                if (have != 0) continue;
                uint256 tokenPrice = vm.parseUint(cfg.readString(string.concat(base, ".tokenPriceUsd")));
                uint256 ratio = vm.parseUint(cfg.readString(string.concat(base, ".ratio")));
                registry.postReferencePrice(uid, tokenPrice * 1e18 / ratio);
            }
        } else {
            string[] memory feedKeys = vm.parseJsonKeys(cfg, ".priceFeeds");
            for (uint256 i = 0; i < feedKeys.length; i++) {
                if (bytes(feedKeys[i])[0] == "_") continue;
                address feed = cfg.readAddress(string.concat(".priceFeeds.", feedKeys[i]));
                if (registry.priceFeedOf(_ticker(feedKeys[i])) != feed) {
                    registry.setPriceFeed(_ticker(feedKeys[i]), feed);
                }
            }
        }
        vm.stopBroadcast();
    }
}

/// @notice Step 3: create the flagship basket from config and record its address.
contract CreateBasket is DeployBase {
    using stdJson for string;

    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        string memory dep = _readDeployments();
        BasketFactory factory = BasketFactory(_addr(dep, "factory"));
        bool mocks = _has(dep, "venue");
        string memory cfg = vm.readFile(
            string.concat(vm.projectRoot(), mocks ? "/script/config/mocks.json" : _mainnetConfig())
        );
        string memory name = cfg.readString(".basket.name");
        string memory symbol = cfg.readString(".basket.symbol");
        uint256 n = _arrayLen(cfg, ".basket.constituents");
        IBasketVault.Constituent[] memory cs = new IBasketVault.Constituent[](n);
        for (uint256 i = 0; i < n; i++) {
            string memory base = string.concat(".basket.constituents[", vm.toString(i), "]");
            cs[i] = IBasketVault.Constituent({
                underlyingId: _ticker(cfg.readString(string.concat(base, ".ticker"))),
                sharesPerUnit: vm.parseUint(cfg.readString(string.concat(base, ".sharesPerUnit"))),
                maxIssuerBps: uint16(cfg.readUint(string.concat(base, ".maxIssuerBps")))
            });
        }
        vm.startBroadcast(pk);
        address basket = factory.createBasket(name, symbol, cs);
        vm.stopBroadcast();
        vm.writeJson(vm.toString(basket), _deploymentsPath(), string.concat(".basket_", symbol));
        console2.log("basket", symbol, basket);
    }
}
