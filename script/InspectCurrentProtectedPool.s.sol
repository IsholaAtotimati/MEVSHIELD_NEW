// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

contract InspectCurrentProtectedPool is Script {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    function run() external view {
        IPoolManager manager =
            IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(
                0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
            ),
            currency1: Currency.wrap(
                0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14
            ),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(
                0x5446D8C7568fC9bb9e699Ae94CFD47533118C080
            )
        });

        PoolId poolId = key.toId();

        console2.log("===== CURRENT PROTECTED POOL =====");
        console2.logBytes32(PoolId.unwrap(poolId));

        require(
            PoolId.unwrap(poolId) ==
                0xac5918607a0235904ea5157e2e63254350401fb21881136c3c7069db7c0a65f7,
            "Computed pool ID does not match configured pool"
        );

        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) =
            manager.getSlot0(poolId);

        uint128 liquidity = manager.getLiquidity(poolId);

        console2.log("sqrtPriceX96", uint256(sqrtPriceX96));
        console2.log("current tick", int256(tick));
        console2.log("protocol fee", uint256(protocolFee));
        console2.log("LP fee", uint256(lpFee));
        console2.log("active liquidity", uint256(liquidity));

        console2.log(
            "INITIALIZED:",
            sqrtPriceX96 != 0
        );
        console2.log(
            "HAS ACTIVE LIQUIDITY:",
            liquidity != 0
        );
    }
}
