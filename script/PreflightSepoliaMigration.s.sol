// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";

contract PreflightSepoliaMigration is Script {
    using PoolIdLibrary for PoolKey;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant DEFAULT_SIGNER = 0x016B78a30CE176EF0B90c122e8677e13aAB2A815;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    uint24 private constant EXPECTED_PRICE_LIMIT_TICK_DISTANCE = 600;

    function run() external view {
        address router = _envAddress("ROUTER_ADDRESS", "MEVSHIELD_ROUTER", "");
        address hook = _envAddress("HOOK_ADDRESS", "MEVSHIELD_HOOK_ADDRESS", "MEVSHIELD_HOOK");
        address authorization =
            _envAddress("POLICY_AUTHORIZATION_ADDRESS", "POLICY_AUTHORIZATION", "AUTHORIZATION_ADDRESS");
        address registry = _envAddress("POLICY_REGISTRY_ADDRESS", "POLICY_REGISTRY");
        address verifier = _envAddress("POLICY_VERIFIER_ADDRESS", "POLICY_VERIFIER", "VERIFIER_ADDRESS");
        address signer = vm.envOr("EXPECTED_AUTHORIZED_SIGNER", DEFAULT_SIGNER);
        bytes32 expectedPoolId = vm.envOr("EXPECTED_POOL_ID", bytes32(0));

        bool configurationOk = block.chainid == SEPOLIA_CHAIN_ID;
        console2.log("=== Read-only Sepolia migration preflight ===");
        console2.log("Chain ID:", block.chainid);
        console2.log("Chain is Sepolia:", block.chainid == SEPOLIA_CHAIN_ID);
        console2.log("PoolManager:", POOL_MANAGER);
        console2.log("PoolManager has code:", POOL_MANAGER.code.length != 0);
        console2.log("Expected signer:", signer);

        configurationOk = _checkContract("Router", router) && configurationOk;
        configurationOk = _checkContract("Hook", hook) && configurationOk;
        configurationOk = _checkContract("Authorization", authorization) && configurationOk;
        configurationOk = _checkContract("Registry", registry) && configurationOk;
        configurationOk = _checkContract("Verifier", verifier) && configurationOk;
        configurationOk = _checkNonzero("Expected signer", signer) && configurationOk;
        configurationOk = _checkContract("USDC", USDC) && configurationOk;
        configurationOk = _checkContract("WETH", WETH) && configurationOk;
        configurationOk = _checkContract("PoolManager", POOL_MANAGER) && configurationOk;

        bool linksOk = true;
        linksOk = _checkLink(router, "poolManager()", POOL_MANAGER) && linksOk;
        linksOk = _checkLink(hook, "poolManager()", POOL_MANAGER) && linksOk;
        linksOk = _checkLink(hook, "authorization()", authorization) && linksOk;
        linksOk = _checkLink(hook, "trustedRouter()", router) && linksOk;
        linksOk = _checkLink(authorization, "registry()", registry) && linksOk;
        linksOk = _checkLink(authorization, "verifier()", verifier) && linksOk;
        linksOk = _checkLink(authorization, "authorizedHook()", hook) && linksOk;
        linksOk = _checkSameAddress(registry, "owner()", authorization, "owner()") && linksOk;
        linksOk = _checkSameAddress(verifier, "owner()", authorization, "owner()") && linksOk;
        linksOk = _checkLink(registry, "authorizedRegistrar()", authorization) && linksOk;
        linksOk = _checkLink(registry, "authorizedConsumer()", authorization) && linksOk;
        linksOk = _checkLink(verifier, "authorizedSigner()", signer) && linksOk;

        bool hookPermissionsOk = _isAddress(hook) && (uint160(hook) & uint160(0x3fff)) == uint160(0x80);
        console2.log("Hook address has only BEFORE_SWAP permission bits:", hookPermissionsOk);

        (bool hasPriceLimit, uint256 priceLimit) = _readUint(router, "MAX_PRICE_LIMIT_TICK_DISTANCE()");
        bool priceLimitOk = hasPriceLimit && priceLimit == EXPECTED_PRICE_LIMIT_TICK_DISTANCE;
        console2.log("Router price-limit getter available:", hasPriceLimit);
        console2.log("Router max tick distance:", priceLimit);
        console2.log("Router max tick distance is expected:", priceLimitOk);

        bool poolOk;
        bytes32 poolId;
        if (_isAddress(hook)) {
            bool currencyOrderOk = USDC < WETH;
            PoolKey memory key = PoolKey({
                currency0: Currency.wrap(USDC),
                currency1: Currency.wrap(WETH),
                fee: POOL_FEE,
                tickSpacing: TICK_SPACING,
                hooks: IHooks(hook)
            });
            poolId = PoolId.unwrap(key.toId());

            console2.log("Pool currency0 (USDC):", USDC);
            console2.log("Pool currency1 (WETH):", WETH);
            console2.log("Pool currencies are in ascending address order:", currencyOrderOk);
            console2.log("Pool fee:", uint256(POOL_FEE));
            console2.log("Pool tick spacing:", int256(TICK_SPACING));
            console2.log("Pool hook:", hook);
            console2.log("Calculated Pool ID:");
            console2.logBytes32(poolId);

            bool expectedPoolMatches = expectedPoolId != bytes32(0) && expectedPoolId == poolId;
            console2.log("Expected Pool ID configured:", expectedPoolId != bytes32(0));
            if (expectedPoolId != bytes32(0)) {
                console2.log("Configured Pool ID:");
                console2.logBytes32(expectedPoolId);
            }
            console2.log("Pool ID matches configured expectation:", expectedPoolMatches);

            (bool stateRead, uint160 sqrtPriceX96, int24 tick, uint128 liquidity) = _readPoolState(poolId);
            console2.log("Pool state readable:", stateRead);
            console2.log("Pool initialized:", stateRead && sqrtPriceX96 != 0);
            console2.log("Pool sqrtPriceX96:", uint256(sqrtPriceX96));
            console2.log("Pool current tick:", int256(tick));
            console2.log("Pool active liquidity:", uint256(liquidity));
            console2.log("Pool has active liquidity:", stateRead && liquidity != 0);

            poolOk = currencyOrderOk && stateRead && expectedPoolMatches && sqrtPriceX96 != 0 && liquidity != 0;
        } else {
            console2.log("Pool ID unavailable: provide a valid hook address.");
        }

        bool ready = configurationOk && linksOk && hookPermissionsOk && priceLimitOk && poolOk;
        console2.log("Contract configuration consistent:", configurationOk);
        console2.log("Deployment links consistent:", linksOk);
        console2.log("Pool executable (initialized and active liquidity > 0):", poolOk);
        console2.log("MIGRATION PREFLIGHT:", ready ? "READY FOR SEPARATE REVIEW" : "BLOCKED");
        console2.log("This script is read-only and never opens a broadcast.");
    }

    function _envAddress(string memory primary, string memory aliasName) private view returns (address) {
        address value = vm.envOr(primary, address(0));
        if (value == address(0)) {
            value = vm.envOr(aliasName, address(0));
        }
        return value;
    }

    function _envAddress(string memory primary, string memory aliasName, string memory legacyAlias)
        private
        view
        returns (address)
    {
        address value = _envAddress(primary, aliasName);
        if (value == address(0) && bytes(legacyAlias).length != 0) {
            value = vm.envOr(legacyAlias, address(0));
        }
        return value;
    }

    function _isAddress(address account) private view returns (bool) {
        return account != address(0) && account.code.length != 0;
    }

    function _checkContract(string memory label, address account) private view returns (bool ok) {
        ok = _isAddress(account);
        console2.log(string.concat(label, ":"), account);
        console2.log(string.concat(label, " configured and has code:"), ok);
        if (account == address(0)) {
            console2.log(string.concat("Missing address for ", label));
        }
    }

    function _checkNonzero(string memory label, address account) private pure returns (bool ok) {
        ok = account != address(0);
        console2.log(string.concat(label, " configured:"), ok);
    }

    function _checkLink(address target, string memory getter, address expected) private view returns (bool ok) {
        if (target == address(0) || target.code.length == 0 || expected == address(0)) {
            console2.log(string.concat("Cannot verify ", getter, ": configuration missing or no code."));
            return false;
        }

        (bool success, bytes memory result) =
            target.staticcall(abi.encodeWithSelector(bytes4(keccak256(bytes(getter)))));
        if (!success || result.length < 32) {
            console2.log(string.concat("Getter unavailable: ", getter));
            return false;
        }

        address actual = abi.decode(result, (address));
        ok = actual == expected;
        console2.log(string.concat("Link ", getter, " matches:"), ok);
        if (!ok) {
            console2.log("  actual:", actual);
            console2.log("  expected:", expected);
        }
    }

    function _checkSameAddress(address first, string memory firstGetter, address second, string memory secondGetter)
        private
        view
        returns (bool ok)
    {
        (bool firstSuccess, bytes memory firstResult) =
            first.staticcall(abi.encodeWithSelector(bytes4(keccak256(bytes(firstGetter)))));
        (bool secondSuccess, bytes memory secondResult) =
            second.staticcall(abi.encodeWithSelector(bytes4(keccak256(bytes(secondGetter)))));
        if (!firstSuccess || firstResult.length < 32 || !secondSuccess || secondResult.length < 32) {
            console2.log("Cannot verify shared deployment owner.");
            return false;
        }

        address firstOwner = abi.decode(firstResult, (address));
        address secondOwner = abi.decode(secondResult, (address));
        ok = firstOwner == secondOwner;
        console2.log("Deployment owners match:", ok);
        if (!ok) {
            console2.log("  first owner:", firstOwner);
            console2.log("  second owner:", secondOwner);
        }
    }

    function _readUint(address target, string memory getter) private view returns (bool success, uint256 value) {
        if (target == address(0) || target.code.length == 0) return (false, 0);
        bytes memory result;
        (success, result) = target.staticcall(abi.encodeWithSelector(bytes4(keccak256(bytes(getter)))));
        if (!success || result.length < 32) return (false, 0);
        value = abi.decode(result, (uint256));
    }

    function _readPoolState(bytes32 poolId)
        private
        view
        returns (bool success, uint160 sqrtPriceX96, int24 tick, uint128 liquidity)
    {
        bytes32 poolStateSlot = keccak256(abi.encodePacked(poolId, uint256(6)));
        bytes memory slot0Data;
        (success, slot0Data) = POOL_MANAGER.staticcall(abi.encodeWithSignature("extsload(bytes32)", poolStateSlot));
        if (!success || slot0Data.length < 32) return (false, 0, 0, 0);

        bytes32 slot0 = abi.decode(slot0Data, (bytes32));
        sqrtPriceX96 = uint160(uint256(slot0));
        tick = int24(uint24(uint256(slot0) >> 160));

        bytes memory liquidityData;
        (success, liquidityData) =
            POOL_MANAGER.staticcall(abi.encodeWithSignature("extsload(bytes32)", bytes32(uint256(poolStateSlot) + 3)));
        if (!success || liquidityData.length < 32) return (false, 0, 0, 0);

        liquidity = uint128(uint256(abi.decode(liquidityData, (bytes32))));
    }
}
