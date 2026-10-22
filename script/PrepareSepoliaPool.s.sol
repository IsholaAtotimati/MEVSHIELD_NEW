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

interface IERC20PoolSetup {
    function allowance(address owner, address spender) external view returns (uint256);
    function balanceOf(address owner) external view returns (uint256);
    function decimals() external view returns (uint8);
}

interface IPermit2PoolSetup {
    function allowance(address owner, address token, address spender)
        external
        view
        returns (uint160 amount, uint48 expiration, uint48 nonce);
}

interface IProtectedHookPoolSetup {
    function poolManager() external view returns (IPoolManager);
}

interface IPositionManagerPoolSetup {
    function poolManager() external view returns (IPoolManager);
    function permit2() external view returns (address);
    function modifyLiquidities(bytes calldata unlockData, uint256 deadline) external payable;
}

interface IMulticallPoolSetup {
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);
}

contract PrepareSepoliaPool is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant PROTECTED_HOOK = 0xd8aE178f4C5a17daF7f32b3648e0Ac42f50DC080;
    address private constant POSITION_MANAGER = 0x429ba70129df741B2Ca2a85BC3A2a3328e5c09b4;
    address private constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    bytes32 private constant POSITION_MANAGER_CODE_HASH =
        0xcffd746f78c2b50aafd19076bbe9c48f14446e5248fc5d76b9b4896610e51aab;
    bytes32 private constant PERMIT2_CODE_HASH = 0x96d9f5c3f0fb0423426b7f970186235b7347027f4e5c19c40c412b7d97fc3751;
    bytes32 private constant EXPECTED_POOL_ID = 0x37d213cbaee2010a7fa4c5fd122001a301ea0364bf63bfee0116913f14477c78;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    uint8 private constant MINT_POSITION = 0x02;
    uint8 private constant SETTLE_PAIR = 0x0d;

    IPoolManager private constant manager = IPoolManager(POOL_MANAGER);

    function run() external view {
        require(block.chainid == SEPOLIA_CHAIN_ID, "wrong chain: expected Sepolia");
        require(address(manager).code.length != 0, "PoolManager has no code");
        require(PROTECTED_HOOK.code.length != 0, "protected hook has no code");
        require(
            address(IProtectedHookPoolSetup(PROTECTED_HOOK).poolManager()) == POOL_MANAGER, "hook PoolManager mismatch"
        );

        PoolKey memory key = _poolKey();
        PoolId poolId = key.toId();
        require(PoolId.unwrap(poolId) == EXPECTED_POOL_ID, "candidate pool ID mismatch");

        string memory stage = vm.envString("POOL_SETUP_STAGE");
        uint256 sqrtPriceValue = vm.envUint("POOL_INITIAL_SQRT_PRICE_X96");
        require(sqrtPriceValue <= type(uint160).max, "initial sqrt price exceeds uint160");
        uint160 initialSqrtPriceX96 = uint160(sqrtPriceValue);
        require(
            initialSqrtPriceX96 > TickMath.MIN_SQRT_PRICE && initialSqrtPriceX96 < TickMath.MAX_SQRT_PRICE,
            "initial sqrt price outside TickMath bounds"
        );

        if (keccak256(bytes(stage)) == keccak256("initialize")) {
            _printInitializationPlan(key, poolId, initialSqrtPriceX96);
            return;
        }

        require(keccak256(bytes(stage)) == keccak256("liquidity"), "stage must be initialize or liquidity");
        _printLiquidityPlan(key, poolId, initialSqrtPriceX96);
    }

    function _poolKey() private pure returns (PoolKey memory) {
        return PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(PROTECTED_HOOK)
        });
    }

    function _printInitializationPlan(PoolKey memory key, PoolId poolId, uint160 sqrtPriceX96) private view {
        (uint160 currentSqrtPriceX96,,,) = manager.getSlot0(poolId);
        require(currentSqrtPriceX96 == 0, "pool is already initialized; refusing init calldata");
        require(manager.getLiquidity(poolId) == 0, "uninitialized pool reports nonzero liquidity");

        bytes memory callData = abi.encodeCall(IPoolManager.initialize, (key, sqrtPriceX96));

        console2.log("Read-only plan; no transaction sent.");
        console2.log("Stage: initialize");
        console2.log("Observed block:", block.number);
        console2.log("Target PoolManager:", POOL_MANAGER);
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Requested sqrtPriceX96:", uint256(sqrtPriceX96));
        console2.log("Transaction value: 0");
        console2.log("Calldata:");
        console2.logBytes(callData);
    }

    function _printLiquidityPlan(PoolKey memory key, PoolId poolId, uint160 expectedSqrtPriceX96) private view {
        (uint160 currentSqrtPriceX96, int24 currentTick,,) = manager.getSlot0(poolId);
        require(currentSqrtPriceX96 == expectedSqrtPriceX96, "pool price differs from requested initial price");
        require(manager.getLiquidity(poolId) == 0, "pool already has active liquidity; inspect before proceeding");

        address owner = vm.envAddress("POOL_LP_OWNER");
        address recipient = vm.envAddress("POOL_POSITION_RECIPIENT");
        require(owner != address(0) && recipient != address(0), "LP owner and recipient are required");

        int256 lowerValue = vm.envInt("POOL_TICK_LOWER");
        int256 upperValue = vm.envInt("POOL_TICK_UPPER");
        require(
            lowerValue >= TickMath.MIN_TICK && lowerValue <= TickMath.MAX_TICK && upperValue >= TickMath.MIN_TICK
                && upperValue <= TickMath.MAX_TICK,
            "tick range outside TickMath bounds"
        );
        int24 tickLower = int24(lowerValue);
        int24 tickUpper = int24(upperValue);
        require(tickLower < tickUpper, "tick lower must be below tick upper");
        require(tickLower % TICK_SPACING == 0 && tickUpper % TICK_SPACING == 0, "ticks must align to spacing");
        require(tickLower <= currentTick && currentTick < tickUpper, "range must contain current pool tick");

        uint256 liquidity = vm.envUint("POOL_LIQUIDITY");
        uint256 amount0MaxValue = vm.envUint("POOL_AMOUNT0_MAX");
        uint256 amount1MaxValue = vm.envUint("POOL_AMOUNT1_MAX");
        require(liquidity != 0, "liquidity must be nonzero");
        require(
            amount0MaxValue != 0 && amount0MaxValue <= type(uint128).max && amount1MaxValue != 0
                && amount1MaxValue <= type(uint128).max,
            "amount maxima must fit uint128 and be nonzero"
        );
        uint128 amount0Max = uint128(amount0MaxValue);
        uint128 amount1Max = uint128(amount1MaxValue);

        uint256 deadline = vm.envUint("POOL_POSITION_DEADLINE");
        require(
            deadline > block.timestamp && deadline <= block.timestamp + 30 minutes, "deadline must be within 30 minutes"
        );

        require(IERC20PoolSetup(USDC).decimals() == 6, "unexpected USDC decimals");
        require(IERC20PoolSetup(WETH).decimals() == 18, "unexpected WETH decimals");

        address positionManager = POSITION_MANAGER;
        require(positionManager.code.length != 0, "PositionManager has no code");
        require(positionManager.codehash == POSITION_MANAGER_CODE_HASH, "PositionManager code hash mismatch");
        require(
            address(IPositionManagerPoolSetup(positionManager).poolManager()) == POOL_MANAGER,
            "PositionManager PoolManager mismatch"
        );

        address permit2 = IPositionManagerPoolSetup(positionManager).permit2();
        require(permit2 == PERMIT2, "PositionManager Permit2 address mismatch");
        require(permit2.code.length != 0, "PositionManager Permit2 has no code");
        require(permit2.codehash == PERMIT2_CODE_HASH, "Permit2 code hash mismatch");
        _requireTokenAndPermit2Allowances(owner, positionManager, permit2, amount0Max, amount1Max, deadline);

        bytes memory actions = abi.encodePacked(MINT_POSITION, SETTLE_PAIR);
        bytes[] memory actionParams = new bytes[](2);
        actionParams[0] = abi.encode(key, tickLower, tickUpper, liquidity, amount0Max, amount1Max, recipient, bytes(""));
        actionParams[1] = abi.encode(key.currency0, key.currency1);
        bytes memory unlockData = abi.encode(actions, actionParams);
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeCall(IPositionManagerPoolSetup.modifyLiquidities, (unlockData, deadline));
        bytes memory callData = abi.encodeCall(IMulticallPoolSetup.multicall, (calls));

        console2.log("Read-only plan; no transaction sent.");
        console2.log("Stage: add first liquidity position");
        console2.log("Observed block:", block.number);
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Current tick:", int256(currentTick));
        console2.log("PoolManager:", POOL_MANAGER);
        console2.log("PositionManager:", positionManager);
        console2.log("Position owner/sender:", owner);
        console2.log("Position recipient:", recipient);
        console2.log("Tick lower:", int256(tickLower));
        console2.log("Tick upper:", int256(tickUpper));
        console2.log("Liquidity:", liquidity);
        console2.log("USDC amount0 max (raw 6-decimal units):", uint256(amount0Max));
        console2.log("WETH amount1 max (raw 18-decimal units):", uint256(amount1Max));
        console2.log("Deadline:", deadline);
        console2.log("Transaction value: 0");
        console2.log("Calldata:");
        console2.logBytes(callData);
    }

    function _requireTokenAndPermit2Allowances(
        address owner,
        address positionManager,
        address permit2,
        uint128 amount0Max,
        uint128 amount1Max,
        uint256 deadline
    ) private view {
        require(IERC20PoolSetup(USDC).balanceOf(owner) >= amount0Max, "LP owner USDC balance below amount0 max");
        require(IERC20PoolSetup(WETH).balanceOf(owner) >= amount1Max, "LP owner WETH balance below amount1 max");
        require(IERC20PoolSetup(USDC).allowance(owner, permit2) >= amount0Max, "USDC Permit2 approval is insufficient");
        require(IERC20PoolSetup(WETH).allowance(owner, permit2) >= amount1Max, "WETH Permit2 approval is insufficient");

        (uint160 usdcAmount, uint48 usdcExpiration,) =
            IPermit2PoolSetup(permit2).allowance(owner, USDC, positionManager);
        (uint160 wethAmount, uint48 wethExpiration,) =
            IPermit2PoolSetup(permit2).allowance(owner, WETH, positionManager);
        require(
            usdcAmount >= amount0Max && usdcExpiration >= deadline, "Permit2 USDC allowance is insufficient or expired"
        );
        require(
            wethAmount >= amount1Max && wethExpiration >= deadline, "Permit2 WETH allowance is insufficient or expired"
        );
    }
}
