// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Run against a local, pinned Sepolia fork:
// RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION=true \
// SEPOLIA_FORK_BLOCK_NUMBER=<pinned-block> \
// forge test --match-path test/SepoliaForkDeploymentVerification.t.sol \
//   --fork-url <approved-sepolia-rpc-url> --fork-block-number <pinned-block> -vv
// This test only reads the fork state; it does not mutate or broadcast transactions.

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";

import {MEVShieldHook} from "../src/MEVShieldHook.sol";
import {MEVShieldRouter} from "../src/MEVShieldRouter.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";

contract SepoliaForkDeploymentVerificationTest is Test {
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant HOOK = 0xd15E4fDD391a68C2F1C385d1a819117a3aD40080;
    address private constant ROUTER = 0x633282608B2fc66cD7572f5eF58e804063aa150D;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    uint24 private constant POOL_FEE = 3000;
    int24 private constant TICK_SPACING = 60;
    bytes32 private constant EXPECTED_POOL_ID = 0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602;

    function test_currentDeploymentAndProtectedPoolMatchExpectedConfiguration() public {
        if (!vm.envOr("RUN_SEPOLIA_FORK_DEPLOYMENT_VERIFICATION", false)) {
            vm.skip(true);
        }

        uint256 pinnedBlockNumber = vm.envOr("SEPOLIA_FORK_BLOCK_NUMBER", uint256(0));
        assertGt(pinnedBlockNumber, 0, "SEPOLIA_FORK_BLOCK_NUMBER must pin the fork");
        assertEq(block.number, pinnedBlockNumber, "fork is not at the expected pinned block");
        assertEq(block.chainid, SEPOLIA_CHAIN_ID, "fork is not Ethereum Sepolia");

        assertGt(POOL_MANAGER.code.length, 0, "PoolManager code missing");
        assertGt(HOOK.code.length, 0, "hook code missing");
        assertGt(ROUTER.code.length, 0, "router code missing");
        assertGt(USDC.code.length, 0, "USDC code missing");
        assertGt(WETH.code.length, 0, "WETH code missing");

        PoolKey memory poolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: POOL_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(HOOK)
        });
        PoolId poolId = poolKey.toId();
        assertEq(PoolId.unwrap(poolId), EXPECTED_POOL_ID, "pool key does not derive expected pool ID");

        IPoolManager manager = IPoolManager(POOL_MANAGER);
        MEVShieldHook hook = MEVShieldHook(HOOK);
        assertEq(address(hook.poolManager()), POOL_MANAGER, "hook PoolManager mismatch");

        MEVShieldRouter router = MEVShieldRouter(payable(ROUTER));
        assertEq(address(router.poolManager()), POOL_MANAGER, "router PoolManager mismatch");

        PolicyAuthorization authorization = hook.authorization();
        assertGt(address(authorization).code.length, 0, "hook authorization code missing");
        assertEq(authorization.authorizedHook(), HOOK, "authorization does not recognize deployed hook");

        (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee) = manager.getSlot0(poolId);
        uint128 liquidity = manager.getLiquidity(poolId);

        console2.log("Verified pool ID:");
        console2.logBytes32(PoolId.unwrap(poolId));
        console2.log("Pinned block:", block.number);
        console2.log("sqrtPriceX96:", uint256(sqrtPriceX96));
        console2.log("tick:", int256(tick));
        console2.log("protocol fee:", uint256(protocolFee));
        console2.log("LP fee:", uint256(lpFee));
        console2.log("initialized:", sqrtPriceX96 != 0);
        console2.log("active liquidity:", uint256(liquidity));

        assertGt(uint256(sqrtPriceX96), 0, "protected pool is uninitialized (sqrtPriceX96 is zero)");
        assertGt(uint256(liquidity), 0, "protected pool is initialized but has no active liquidity");
    }
}
