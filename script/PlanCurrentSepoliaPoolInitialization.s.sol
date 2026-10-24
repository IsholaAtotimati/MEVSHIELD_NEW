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

interface ICurrentPoolHook {
    function poolManager() external view returns (IPoolManager);
}

interface IERC20Decimals {
    function decimals() external view returns (uint8);
}

contract PlanCurrentSepoliaPoolInitialization is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant HOOK = 0xd15E4fDD391a68C2F1C385d1a819117a3aD40080;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    bytes32 private constant EXPECTED_POOL_ID = 0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602;

    function run() external view {
        require(block.chainid == SEPOLIA_CHAIN_ID, "wrong chain: expected Sepolia");
        require(POOL_MANAGER.code.length != 0, "PoolManager has no code");
        require(HOOK.code.length != 0, "current hook has no code");
        require(USDC.code.length != 0 && WETH.code.length != 0, "pool currency has no code");
        require(address(ICurrentPoolHook(HOOK).poolManager()) == POOL_MANAGER, "current hook PoolManager mismatch");
        require(IERC20Decimals(USDC).decimals() == 6, "unexpected USDC decimals");
        require(IERC20Decimals(WETH).decimals() == 18, "unexpected WETH decimals");

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });
        PoolId poolId = key.toId();
        require(PoolId.unwrap(poolId) == EXPECTED_POOL_ID, "current pool key ID mismatch");

        IPoolManager manager = IPoolManager(POOL_MANAGER);
        (uint160 currentSqrtPriceX96, int24 currentTick, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(poolId);
        uint128 activeLiquidity = manager.getLiquidity(poolId);
        require(currentSqrtPriceX96 == 0, "current pool is already initialized");
        require(activeLiquidity == 0, "uninitialized pool reports nonzero liquidity");

        uint256 requestedPrice = vm.envOr("POOL_INITIAL_SQRT_PRICE_X96", uint256(0));
        require(requestedPrice != 0, "POOL_INITIAL_SQRT_PRICE_X96 must be explicitly set");
        require(requestedPrice <= type(uint160).max, "initial sqrt price exceeds uint160");
        uint160 sqrtPriceX96 = uint160(requestedPrice);
        require(
            sqrtPriceX96 > TickMath.MIN_SQRT_PRICE && sqrtPriceX96 < TickMath.MAX_SQRT_PRICE,
            "initial sqrt price outside TickMath bounds"
        );
        int24 initialTick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        bytes memory callData = abi.encodeCall(IPoolManager.initialize, (key, sqrtPriceX96));

        console2.log("Read-only initialization plan; no transaction sent.");
        console2.log("Chain ID:", block.chainid);
        console2.log("Observed block:", block.number);
        console2.log("PoolManager:", POOL_MANAGER);
        console2.log("Hook:", HOOK);
        console2.log("USDC currency0:", USDC);
        console2.log("WETH currency1:", WETH);
        console2.log("Fee:", uint256(POOL_FEE));
        console2.log("Tick spacing:", int256(TICK_SPACING));
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Current sqrtPriceX96:", uint256(currentSqrtPriceX96));
        console2.log("Current tick:", int256(currentTick));
        console2.log("Current protocol fee:", uint256(protocolFee));
        console2.log("Current LP fee:", uint256(lpFee));
        console2.log("Current active liquidity:", uint256(activeLiquidity));
        console2.log("Requested initial sqrtPriceX96:", uint256(sqrtPriceX96));
        console2.log("Implied initialization tick:", int256(initialTick));
        console2.log("Raw WETH per USDC = (sqrtPriceX96 / 2^96)^2");
        console2.log("Human WETH per USDC = raw ratio * 10^(6 - 18) = raw ratio / 1e12");
        console2.log("Human USDC per WETH = reciprocal of human WETH per USDC");
        console2.log("Initialization calldata:");
        console2.logBytes(callData);
    }
}
