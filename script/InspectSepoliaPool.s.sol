// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

contract InspectSepoliaPool is Script {
    using StateLibrary for IPoolManager;
    using PoolIdLibrary for PoolKey;

    bytes32 private constant EXPECTED_POOL_ID = 0x37d213cbaee2010a7fa4c5fd122001a301ea0364bf63bfee0116913f14477c78;

    function run() external view {
        IPoolManager manager = IPoolManager(0xE03A1074c86CFeDd5C142C4F04F1a1536e203543);

        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238),
            currency1: Currency.wrap(0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(0xd8aE178f4C5a17daF7f32b3648e0Ac42f50DC080)
        });
        PoolId poolId = key.toId();
        require(PoolId.unwrap(poolId) == EXPECTED_POOL_ID, "candidate PoolId mismatch");

        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(poolId);

        uint128 liquidity = manager.getLiquidity(poolId);
        bool ready = sqrtPriceX96 != 0 && liquidity > 0;

        console2.log("PoolManager:", address(manager));
        console2.log("Currency0 (USDC):", Currency.unwrap(key.currency0));
        console2.log("Currency1 (WETH):", Currency.unwrap(key.currency1));
        console2.log("Fee:", uint256(key.fee));
        console2.log("Tick spacing:", int256(key.tickSpacing));
        console2.log("Hook:", address(key.hooks));
        console2.log("Pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("sqrtPriceX96:", uint256(sqrtPriceX96));
        console2.log("Current tick:", int256(tick));
        console2.log("Protocol fee:", uint256(protocolFee));
        console2.log("LP fee:", uint256(lpFee));
        console2.log("Active liquidity:", uint256(liquidity));
        console2.log("Protected pool ready:", ready ? "YES" : "NO");

        require(
            ready,
            "Protected WETH/USDC pool is not initialized or has zero active liquidity; protected quote/execution is blocked."
        );
    }
}
