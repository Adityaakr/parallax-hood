// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {ShareMath} from "../src/libraries/ShareMath.sol";

/// @notice Writes deterministic ShareMath vectors for the TypeScript mirror's parity test.
///   forge script script/GenVectors.s.sol
contract GenVectors is Script {
    function run() external {
        string memory root = vm.projectRoot();
        string memory json = "[";
        uint256 seed = 0x5eed;
        for (uint256 i = 0; i < 200; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 tokens = seed % (10 ** (12 + (i % 15))); // 1e12 .. 1e26 range
            uint256 ratio = 1e9 + (uint256(keccak256(abi.encode(seed, "r"))) % (3e18)); // 1e9 .. ~3e18
            uint256 shares = uint256(keccak256(abi.encode(seed, "s"))) % 1e24;
            uint256 units = uint256(keccak256(abi.encode(seed, "u"))) % 1e22;
            uint256 spu = 1 + uint256(keccak256(abi.encode(seed, "p"))) % 1e18;
            uint256 supply = 1 + units + uint256(keccak256(abi.encode(seed, "t"))) % 1e22;
            uint256 bal = uint256(keccak256(abi.encode(seed, "b"))) % 1e24;
            uint256 newRatio = 1 + uint256(keccak256(abi.encode(seed, "n"))) % 3e18;
            string memory o = "v";
            vm.serializeUint(o, "tokens", tokens);
            vm.serializeUint(o, "ratio", ratio);
            vm.serializeUint(o, "shares", shares);
            vm.serializeUint(o, "units", units);
            vm.serializeUint(o, "sharesPerUnit", spu);
            vm.serializeUint(o, "supply", supply);
            vm.serializeUint(o, "balance", bal);
            vm.serializeUint(o, "newRatio", newRatio);
            vm.serializeUint(o, "sharesForTokens", ShareMath.sharesForTokens(tokens, ratio));
            vm.serializeUint(o, "tokensForShares", ShareMath.tokensForShares(shares, ratio));
            vm.serializeUint(o, "requiredShares", ShareMath.requiredShares(units, spu));
            vm.serializeUint(o, "proRata", ShareMath.proRata(bal, units, supply));
            string memory entry = vm.serializeUint(o, "stepBps", ShareMath.stepBps(ratio, newRatio));
            json = string.concat(json, i == 0 ? "" : ",", entry);
        }
        json = string.concat(json, "]");
        vm.writeFile(string.concat(root, "/test-vectors/sharemath.json"), json);
    }
}
