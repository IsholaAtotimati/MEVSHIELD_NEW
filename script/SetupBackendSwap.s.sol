// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

contract SetupBackendSwap is Script {
    using PoolIdLibrary for PoolKey;

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    uint256 internal constant LIQUIDITY = 1e18;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        address deployer = vm.addr(deployerKey);

        address managerAddress = vm.envAddress("POOL_MANAGER");
        address hookAddress = vm.envAddress("MEVSHIELD_HOOK");
        address routerAddress = vm.envAddress("MEVSHIELD_ROUTER");

        IPoolManager manager = IPoolManager(managerAddress);

        console2.log("");
        console2.log("========================================");
        console2.log("     MEVShield BACKEND SWAP SETUP");
        console2.log("========================================");
        console2.log("Deployer:", deployer);
        console2.log("PoolManager:", managerAddress);
        console2.log("MEVShieldHook:", hookAddress);
        console2.log("MEVShieldRouter:", routerAddress);

        vm.startBroadcast(deployerKey);

        // ------------------------------------------------------------
        // 1. Deploy fresh test tokens.
        // ------------------------------------------------------------

        MockERC20 tokenA =
            new MockERC20("MEVShield Backend Token A", "MBA", 18);

        MockERC20 tokenB =
            new MockERC20("MEVShield Backend Token B", "MBB", 18);

        // Give the backend deployer enough tokens to:
        // - provide liquidity
        // - pay for the protected swap
        tokenA.mint(deployer, 2 ** 120);
        tokenB.mint(deployer, 2 ** 120);

        Currency currencyA = Currency.wrap(address(tokenA));
        Currency currencyB = Currency.wrap(address(tokenB));

        Currency currency0;
        Currency currency1;

        if (address(tokenA) < address(tokenB)) {
            currency0 = currencyA;
            currency1 = currencyB;
        } else {
            currency0 = currencyB;
            currency1 = currencyA;
        }

        console2.log("");
        console2.log("Token0:", Currency.unwrap(currency0));
        console2.log("Token1:", Currency.unwrap(currency1));

        // ------------------------------------------------------------
        // 2. Build the pool using the LIVE MEVShieldHook.
        // ------------------------------------------------------------

        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(hookAddress)
        });

        bytes32 poolId = PoolId.unwrap(key.toId());

        console2.log("");
        console2.log("PoolId:");
        console2.logBytes32(poolId);

        // ------------------------------------------------------------
        // 3. Initialize the pool.
        // ------------------------------------------------------------

        manager.initialize(
            key,
            79228162514264337593543950336
        );

        console2.log("Pool initialized.");

        // ------------------------------------------------------------
        // 4. Add liquidity.
        // ------------------------------------------------------------

        PoolModifyLiquidityTest liquidityRouter =
            new PoolModifyLiquidityTest(manager);

        tokenA.approve(
            address(liquidityRouter),
            type(uint256).max
        );

        tokenB.approve(
            address(liquidityRouter),
            type(uint256).max
        );

        IPoolManager.ModifyLiquidityParams memory liquidityParams =
            IPoolManager.ModifyLiquidityParams({
                tickLower: -120,
                tickUpper: 120,
                liquidityDelta: int256(LIQUIDITY),
                salt: bytes32(0)
            });

        liquidityRouter.modifyLiquidity(
            key,
            liquidityParams,
            bytes("")
        );

        console2.log("Liquidity added.");

        // ------------------------------------------------------------
        // 5. Approve the LIVE MEVShieldRouter.
        //
        // The backend deployer will be payer during /execute-swap.
        // ------------------------------------------------------------

        tokenA.approve(
            routerAddress,
            type(uint256).max
        );

        tokenB.approve(
            routerAddress,
            type(uint256).max
        );

        console2.log("Router approvals set.");

        vm.stopBroadcast();

        // ------------------------------------------------------------
        // 6. Print everything needed by the backend test.
        // ------------------------------------------------------------

        console2.log("");
        console2.log("========================================");
        console2.log("       BACKEND SWAP SETUP COMPLETE");
        console2.log("========================================");

        console2.log("TokenA:", address(tokenA));
        console2.log("TokenB:", address(tokenB));
        console2.log("Token0:", Currency.unwrap(currency0));
        console2.log("Token1:", Currency.unwrap(currency1));

        console2.log("PoolId:");
        console2.logBytes32(poolId);

        console2.log("PoolManager:", managerAddress);
        console2.log("Hook:", hookAddress);
        console2.log("Router:", routerAddress);

        console2.log("");
        console2.log("Use these values for POST /policy and /execute-swap.");
        console2.log("");
    }
}
