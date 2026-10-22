// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";
import {MEVShieldHook} from "../src/MEVShieldHook.sol";

contract DeployReplacementHook is Script {
    address constant MANAGER =
        0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address constant AUTHORIZATION =
        0x0Ebb15276f230130DD238fa1581d4379488111f5;
    address constant CREATE2_DEPLOYER =
        0x4e59b44847b379578588920cA78FbF26c0B4956C;

    uint160 constant HOOK_MASK = (1 << 14) - 1;
    uint160 constant REQUIRED_FLAGS = 1 << 7;

    function run() external {
        require(block.chainid == 11155111, "Not Sepolia");
        require(MANAGER.code.length > 0, "Manager has no code");
        require(AUTHORIZATION.code.length > 0, "Authorization has no code");
        require(CREATE2_DEPLOYER.code.length > 0, "CREATE2 deployer has no code");

        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        require(
            deployer == 0x016B78a30CE176EF0B90c122e8677e13aAB2A815,
            "Unexpected deployer"
        );

        bytes memory initCode = abi.encodePacked(
            type(MEVShieldHook).creationCode,
            abi.encode(
                IPoolManager(MANAGER),
                PolicyAuthorization(AUTHORIZATION)
            )
        );
        bytes32 initCodeHash = keccak256(initCode);

        address predictedHook;
        bytes32 salt;
        bool found;

        for (uint256 i; i < 100_000; ++i) {
            bytes32 candidateSalt = bytes32(i);
            address candidate = address(
                uint160(
                    uint256(
                        keccak256(
                            abi.encodePacked(
                                bytes1(0xff),
                                CREATE2_DEPLOYER,
                                candidateSalt,
                                initCodeHash
                            )
                        )
                    )
                )
            );

            if ((uint160(candidate) & HOOK_MASK) == REQUIRED_FLAGS) {
                predictedHook = candidate;
                salt = candidateSalt;
                found = true;
                break;
            }
        }

        require(found, "No valid salt found");
        require(
            predictedHook == vm.computeCreate2Address(salt, initCodeHash, CREATE2_DEPLOYER),
            "CREATE2 address calculation mismatch"
        );
        require(predictedHook.code.length == 0, "Predicted address occupied");

        Hooks.Permissions memory permissions = Hooks.Permissions({
            beforeInitialize: false,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: true,
            afterSwap: false,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: false,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });

        Hooks.validateHookPermissions(
            MEVShieldHook(payable(predictedHook)),
            permissions
        );

        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("Existing PoolManager:", MANAGER);
        console2.log("Existing Authorization:", AUTHORIZATION);
        console2.log("Predicted replacement hook:", predictedHook);
        console2.log("CREATE2 salt:"); console2.logBytes32(salt);
        console2.log("Permission bits:", uint256(uint160(predictedHook) & HOOK_MASK));

        vm.startBroadcast(deployerKey);
        (bool success, bytes memory result) =
            CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
        vm.stopBroadcast();

        require(success, "CREATE2 deployment call failed");
        require(result.length >= 20, "Missing deployed address");

        address deployedHook = address(bytes20(result));
        require(deployedHook == predictedHook, "Address mismatch");
        require(deployedHook.code.length > 0, "Hook code missing");

        MEVShieldHook hook = MEVShieldHook(payable(deployedHook));
        require(address(hook.poolManager()) == MANAGER, "Manager mismatch");
        require(address(hook.authorization()) == AUTHORIZATION, "Authorization mismatch");
        require(
            (uint160(deployedHook) & HOOK_MASK) == REQUIRED_FLAGS,
            "Permission flags mismatch"
        );

        console2.log("Verified replacement hook:", deployedHook);
        console2.log("Replacement hook checks passed.");
    }
}
