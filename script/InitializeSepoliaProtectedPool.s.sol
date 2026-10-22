// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

interface IInitHook {
    function poolManager() external view returns (IPoolManager);
}

contract InitializeSepoliaProtectedPool is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 constant SEPOLIA_CHAIN_ID = 11155111;
    address constant EXPECTED_DEPLOYER =
        0x016B78a30CE176EF0B90c122e8677e13aAB2A815;
    address constant POOL_MANAGER =
        0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant WETH =
        0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address constant HOOK =
        0xd8aE178f4C5a17daF7f32b3648e0Ac42f50DC080;
    bytes32 constant EXPECTED_POOL_ID =
        0x37d213cbaee2010a7fa4c5fd122001a301ea0364bf63bfee0116913f14477c78;

    function run() external {
        require(block.chainid == SEPOLIA_CHAIN_ID, "Wrong chain");
        require(POOL_MANAGER.code.length != 0, "PoolManager has no code");
        require(HOOK.code.length != 0, "Hook has no code");
        require(
            address(IInitHook(HOOK).poolManager()) == POOL_MANAGER,
            "Hook PoolManager mismatch"
        );

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        require(deployer == EXPECTED_DEPLOYER, "Unexpected deployer");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        PoolId poolId = key.toId();
        require(
            PoolId.unwrap(poolId) == EXPECTED_POOL_ID,
            "Unexpected pool ID"
        );

        IPoolManager manager = IPoolManager(POOL_MANAGER);
        (uint160 currentPrice,,,) = manager.getSlot0(poolId);
        require(currentPrice == 0, "Pool already initialized");
        require(manager.getLiquidity(poolId) == 0, "Unexpected liquidity");

        uint256 priceValue = vm.envUint("POOL_INITIAL_SQRT_PRICE_X96");
        require(priceValue <= type(uint160).max, "Price exceeds uint160");
        uint160 sqrtPriceX96 = uint160(priceValue);

        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Initial sqrt price:", priceValue);
        console2.log("Simulation only unless --broadcast is supplied.");

        vm.startBroadcast(deployerKey);
        manager.initialize(key, sqrtPriceX96);
        vm.stopBroadcast();
    }
}
