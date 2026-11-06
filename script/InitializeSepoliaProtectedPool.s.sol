// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

interface IInitRouter {
    function poolManager() external view returns (IPoolManager);
    function MAX_PRICE_LIMIT_TICK_DISTANCE() external view returns (uint24);
}

interface IInitHook {
    function poolManager() external view returns (IPoolManager);
    function authorization() external view returns (address);
    function trustedRouter() external view returns (address);
}

interface IInitAuthorization {
    function owner() external view returns (address);
    function registry() external view returns (address);
    function verifier() external view returns (address);
    function authorizedHook() external view returns (address);
}

interface IInitRegistry {
    function owner() external view returns (address);
    function authorizedRegistrar() external view returns (address);
    function authorizedConsumer() external view returns (address);
}

interface IInitVerifier {
    function owner() external view returns (address);
    function authorizedSigner() external view returns (address);
}

contract InitializeSepoliaProtectedPool is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 constant SEPOLIA_CHAIN_ID = 11155111;
    address constant EXPECTED_DEPLOYER = 0x016B78a30CE176EF0B90c122e8677e13aAB2A815;
    address constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant DEFAULT_AUTHORIZED_SIGNER = 0x016B78a30CE176EF0B90c122e8677e13aAB2A815;
    uint24 constant EXPECTED_PRICE_LIMIT_TICK_DISTANCE = 600;
    uint24 constant HOOK_PERMISSION_MASK = (1 << 14) - 1;
    uint24 constant REQUIRED_HOOK_PERMISSIONS = 1 << 7;

    function run() external {
        require(block.chainid == SEPOLIA_CHAIN_ID, "Wrong chain");
        require(POOL_MANAGER.code.length != 0, "PoolManager has no code");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(deployer == EXPECTED_DEPLOYER, "Unexpected deployer");

        address router = vm.envAddress("ROUTER_ADDRESS");
        address hook = vm.envAddress("HOOK_ADDRESS");
        address authorization = vm.envAddress("POLICY_AUTHORIZATION");
        address registry = vm.envAddress("POLICY_REGISTRY");
        address verifier = vm.envAddress("POLICY_VERIFIER");
        address signer = vm.envOr("EXPECTED_AUTHORIZED_SIGNER", DEFAULT_AUTHORIZED_SIGNER);
        bytes32 expectedPoolId = vm.envBytes32("EXPECTED_POOL_ID");

        require(router.code.length != 0, "Router has no code");
        require(hook.code.length != 0, "Hook has no code");
        require(authorization.code.length != 0, "Authorization has no code");
        require(registry.code.length != 0, "Registry has no code");
        require(verifier.code.length != 0, "Verifier has no code");
        require(USDC.code.length != 0 && WETH.code.length != 0, "Pool tokens have no code");

        require(address(IInitRouter(router).poolManager()) == POOL_MANAGER, "Router PoolManager mismatch");
        require(
            IInitRouter(router).MAX_PRICE_LIMIT_TICK_DISTANCE() == EXPECTED_PRICE_LIMIT_TICK_DISTANCE,
            "Router price limit mismatch"
        );
        require(address(IInitHook(hook).poolManager()) == POOL_MANAGER, "Hook PoolManager mismatch");
        require(IInitHook(hook).authorization() == authorization, "Hook authorization mismatch");
        require(IInitHook(hook).trustedRouter() == router, "Hook trusted router mismatch");
        require(IInitAuthorization(authorization).registry() == registry, "Authorization registry mismatch");
        require(IInitAuthorization(authorization).verifier() == verifier, "Authorization verifier mismatch");
        require(IInitAuthorization(authorization).authorizedHook() == hook, "Authorized hook mismatch");
        require(IInitRegistry(registry).authorizedRegistrar() == authorization, "Registry registrar mismatch");
        require(IInitRegistry(registry).authorizedConsumer() == authorization, "Registry consumer mismatch");
        require(IInitVerifier(verifier).authorizedSigner() == signer, "Authorized signer mismatch");
        require(
            IInitAuthorization(authorization).owner() == deployer && IInitRegistry(registry).owner() == deployer
                && IInitVerifier(verifier).owner() == deployer
                && IInitRegistry(registry).owner() == IInitAuthorization(authorization).owner()
                && IInitVerifier(verifier).owner() == IInitAuthorization(authorization).owner(),
            "Deployment owner does not match deployer"
        );
        require((uint160(hook) & HOOK_PERMISSION_MASK) == REQUIRED_HOOK_PERMISSIONS, "Hook permission bits mismatch");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(hook)
        });

        PoolId poolId = key.toId();
        require(expectedPoolId != bytes32(0), "EXPECTED_POOL_ID is required");
        require(PoolId.unwrap(poolId) == expectedPoolId, "Unexpected pool ID");

        IPoolManager manager = IPoolManager(POOL_MANAGER);
        (uint160 currentPrice,,,) = manager.getSlot0(poolId);
        require(currentPrice == 0, "Pool already initialized");
        require(manager.getLiquidity(poolId) == 0, "Unexpected liquidity");

        uint256 priceValue = vm.envUint("POOL_INITIAL_SQRT_PRICE_X96");
        require(priceValue <= type(uint160).max, "Price exceeds uint160");
        uint160 sqrtPriceX96 = uint160(priceValue);
        require(
            sqrtPriceX96 > TickMath.MIN_SQRT_PRICE && sqrtPriceX96 < TickMath.MAX_SQRT_PRICE,
            "Initial price outside TickMath bounds"
        );
        int24 initialTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("PoolManager:", POOL_MANAGER);
        console2.log("Router:", router);
        console2.log("Hook:", hook);
        console2.log("Authorization:", authorization);
        console2.log("Registry:", registry);
        console2.log("Verifier:", verifier);
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Initial sqrt price:", priceValue);
        console2.log("Initial tick:", int256(initialTick));
        console2.log("Simulation only unless --broadcast is supplied.");

        vm.startBroadcast(deployerKey);
        manager.initialize(key, sqrtPriceX96);
        vm.stopBroadcast();
    }
}
