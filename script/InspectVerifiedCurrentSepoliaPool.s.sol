// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

contract InspectVerifiedCurrentSepoliaPool is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant HOOK = 0x15D8C5eb1b839A4Fd86989348c1371c10168c080;
    bytes32 private constant EXPECTED_POOL_ID = 0xba95e58e09df6620bcf06cf124eb902eba371655696b14ba8b43ec1b9fc22235;

    function run() external view {
        require(block.chainid == SEPOLIA_CHAIN_ID, "wrong chain");
        IPoolManager manager = IPoolManager(POOL_MANAGER);
        require(POOL_MANAGER.code.length != 0, "PoolManager has no code");
        require(HOOK.code.length != 0, "hook has no code");

        require(address(IProtectedHookInspector(HOOK).poolManager()) == POOL_MANAGER, "hook PoolManager mismatch");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        PoolId poolId = key.toId();
        require(PoolId.unwrap(poolId) == EXPECTED_POOL_ID, "pool ID mismatch");

        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(poolId);
        uint128 activeLiquidity = manager.getLiquidity(poolId);

        console2.log("READ-ONLY CURRENT SEPOLIA POOL INSPECTION");
        console2.log("Block:", block.number);
        console2.log("PoolManager:", POOL_MANAGER);
        console2.log("Hook:", HOOK);
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("sqrtPriceX96:", uint256(sqrtPriceX96));
        console2.log("Current tick:", int256(tick));
        console2.log("Protocol fee:", uint256(protocolFee));
        console2.log("LP fee:", uint256(lpFee));
        console2.log("Active liquidity:", uint256(activeLiquidity));
        console2.log("Initialized:", sqrtPriceX96 != 0);
        console2.log("Has active liquidity:", activeLiquidity != 0);
    }
}

interface IProtectedHookInspector {
    function poolManager() external view returns (IPoolManager);
}
