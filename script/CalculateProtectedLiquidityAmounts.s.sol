// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolId} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

contract CalculateProtectedLiquidityAmounts is Script {
    using StateLibrary for IPoolManager;

    IPoolManager constant manager =
        IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);

    function run() external view {
        PoolId poolId = PoolId.wrap(
            0xac5918607a0235904ea5157e2e63254350401fb21881136c3c7069db7c0a65f7
        );

        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(poolId);

        int24 tickLower = int24(vm.envInt("POOL_TICK_LOWER"));
        int24 tickUpper = int24(vm.envInt("POOL_TICK_UPPER"));
        uint256 liquidityValue = vm.envUint("POOL_LIQUIDITY");

        require(sqrtPriceX96 != 0, "Pool is not initialized");
        require(tickLower <= tick && tick < tickUpper, "Current tick outside range");
        require(tickLower < tickUpper, "Invalid tick range");
        require(
            liquidityValue > 0 &&
            liquidityValue <= uint256(uint128(type(int128).max)),
            "Invalid liquidity"
        );

        uint128 liquidity = uint128(liquidityValue);
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(tickLower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(tickUpper);

        int256 delta0 = SqrtPriceMath.getAmount0Delta(
            sqrtPriceX96, sqrtUpper, int128(liquidity)
        );

        int256 delta1 = SqrtPriceMath.getAmount1Delta(
            sqrtLower, sqrtPriceX96, int128(liquidity)
        );

        require(delta0 <= 0 && delta1 <= 0, "Unexpected delta signs");

        uint256 amount0Required = uint256(-delta0);
        uint256 amount1Required = uint256(-delta1);

        console2.log("=== EXACT LIQUIDITY REQUIREMENTS ===");
        console2.log("Pool tick:", int256(tick));
        console2.log("sqrtPriceX96:", uint256(sqrtPriceX96));
        console2.log("Liquidity:", liquidityValue);
        console2.log("USDC required (raw units):", amount0Required);
        console2.log("USDC required:", amount0Required / 1e6);
        console2.log("WETH required (wei):", amount1Required);
        console2.log("WETH required (ether):", amount1Required / 1e18);
        console2.log(
            "USDC maximum sufficient:",
            amount0Required <= vm.envUint("POOL_AMOUNT0_MAX")
        );
        console2.log(
            "WETH maximum sufficient:",
            amount1Required <= vm.envUint("POOL_AMOUNT1_MAX")
        );
    }
}
