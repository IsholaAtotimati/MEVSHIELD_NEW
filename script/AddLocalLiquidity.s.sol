// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

/// One-shot for the running local anvil. The setup position only covered
/// ticks -120 to 120; a swap moved the price to tick 499 and active liquidity
/// became zero, which disables signing.
contract AddLocalLiquidity is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        IPoolManager manager = IPoolManager(vm.envAddress("POOL_MANAGER"));
        PoolModifyLiquidityTest router = new PoolModifyLiquidityTest(manager);

        MockERC20 token0 = MockERC20(vm.envAddress("TOKEN0"));
        MockERC20 token1 = MockERC20(vm.envAddress("TOKEN1"));
        token0.approve(address(router), type(uint256).max);
        token1.approve(address(router), type(uint256).max);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(token0)),
            currency1: Currency.wrap(address(token1)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(vm.envAddress("MEVSHIELD_HOOK"))
        });

        router.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({
                tickLower: -887220,
                tickUpper: 887220,
                liquidityDelta: int256(1e21),
                salt: bytes32(uint256(1))
            }),
            ""
        );

        vm.stopBroadcast();
    }
}
