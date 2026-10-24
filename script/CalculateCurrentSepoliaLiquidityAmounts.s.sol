// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {SqrtPriceMath} from "v4-core/libraries/SqrtPriceMath.sol";

contract CalculateCurrentSepoliaLiquidityAmounts is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 constant SEPOLIA_CHAIN_ID = 11155111;
    address constant MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant HOOK = 0xd15E4fDD391a68C2F1C385d1a819117a3aD40080;
    address constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    uint24 constant FEE = 3000;
    int24 constant SPACING = 60;
    bytes32 constant EXPECTED_POOL_ID =
        0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602;

    function run() external view {
        require(block.chainid == SEPOLIA_CHAIN_ID, "wrong chain");
        require(MANAGER.code.length != 0 && HOOK.code.length != 0, "missing contract code");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: FEE,
            tickSpacing: SPACING,
            hooks: IHooks(HOOK)
        });

        PoolId poolId = key.toId();
        require(PoolId.unwrap(poolId) == EXPECTED_POOL_ID, "pool ID mismatch");

        IPoolManager manager = IPoolManager(MANAGER);
        (uint160 livePrice,,,) = manager.getSlot0(poolId);
        require(livePrice == 0, "pool state changed: inspect before proceeding");

        uint256 requestedPrice =
            vm.envUint("POOL_INITIAL_SQRT_PRICE_X96");
        require(requestedPrice <= type(uint160).max, "price exceeds uint160");
        uint160 sqrtPriceX96 = uint160(requestedPrice);
        require(
            sqrtPriceX96 > TickMath.MIN_SQRT_PRICE &&
            sqrtPriceX96 < TickMath.MAX_SQRT_PRICE,
            "price outside TickMath bounds"
        );

        int24 initialTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        int24 lower = int24(vm.envInt("POOL_TICK_LOWER"));
        int24 upper = int24(vm.envInt("POOL_TICK_UPPER"));
        uint256 liquidityValue = vm.envUint("POOL_LIQUIDITY");
        uint256 cap0 = vm.envUint("POOL_AMOUNT0_MAX");
        uint256 cap1 = vm.envUint("POOL_AMOUNT1_MAX");

        require(lower < upper, "invalid tick range");
        require(lower % SPACING == 0 && upper % SPACING == 0, "ticks not aligned");
        require(lower <= initialTick && initialTick < upper, "price outside range");
        require(
            liquidityValue > 0 &&
            liquidityValue <= uint256(uint128(type(int128).max)),
            "invalid liquidity"
        );

        int128 liquidity = int128(uint128(liquidityValue));
        uint160 sqrtLower = TickMath.getSqrtPriceAtTick(lower);
        uint160 sqrtUpper = TickMath.getSqrtPriceAtTick(upper);

        int256 delta0 = SqrtPriceMath.getAmount0Delta(
            sqrtPriceX96, sqrtUpper, liquidity
        );
        int256 delta1 = SqrtPriceMath.getAmount1Delta(
            sqrtLower, sqrtPriceX96, liquidity
        );

        require(delta0 <= 0 && delta1 <= 0, "unexpected delta signs");

        uint256 amount0 = uint256(-delta0);
        uint256 amount1 = uint256(-delta1);

        console2.log("READ-ONLY CALCULATION; NO TRANSACTION SENT");
        console2.log("Observed block:", block.number);
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Proposed price sqrtPriceX96:", requestedPrice);
        console2.log("Implied tick:", int256(initialTick));
        console2.log("Lower tick:", int256(lower));
        console2.log("Upper tick:", int256(upper));
        console2.log("Liquidity:", liquidityValue);
        console2.log("USDC required, raw 6-decimal units:", amount0);
        console2.log("USDC whole-token part:", amount0 / 1e6);
        console2.log("USDC fractional raw remainder:", amount0 % 1e6);
        console2.log("WETH required, wei:", amount1);
        console2.log("WETH whole-token part:", amount1 / 1e18);
        console2.log("WETH fractional wei remainder:", amount1 % 1e18);
        console2.log("USDC cap:", cap0);
        console2.log("WETH cap:", cap1);
        console2.log("USDC cap sufficient:", amount0 <= cap0);
        console2.log("WETH cap sufficient:", amount1 <= cap1);
    }
}
