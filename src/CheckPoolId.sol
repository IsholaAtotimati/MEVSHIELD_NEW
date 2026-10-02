// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";

contract CheckPoolId is Script {
    using PoolIdLibrary for PoolKey;

    function run() external view {
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(
                0x3722a74BD678c358c9cbE47F43400C97C9cDb1D0
            ),
            currency1: Currency.wrap(
                0x83029461d33A575A2AD852BE69a0BB0aDC68988e
            ),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(
                0xd8aE178f4C5a17daF7f32b3648e0Ac42f50DC080
            )
        });

        PoolId poolId = key.toId();

        console2.log("Calculated PoolId:");
        console2.logBytes32(PoolId.unwrap(poolId));

        console2.log("Expected PoolId:");
        console2.logBytes32(
            0x75eeb1ab079f55178bbe93102539d5d3cab08ab019b0bb1e05a8d6cc4d5002d8
        );

        require(
            PoolId.unwrap(poolId) ==
                0x75eeb1ab079f55178bbe93102539d5d3cab08ab019b0bb1e05a8d6cc4d5002d8,
            "POOL ID MISMATCH"
        );

        console2.log("POOL ID MATCHES");
    }
}
