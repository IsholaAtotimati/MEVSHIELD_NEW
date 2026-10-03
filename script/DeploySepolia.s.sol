// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";

import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";
import {MEVShieldHook} from "../src/MEVShieldHook.sol";
import {MEVShieldRouter} from "../src/MEVShieldRouter.sol";

contract DeploySepolia is Script {
    // DEPLOYER_PRIVATE_KEY and SIGNER_PRIVATE_KEY must be provided through the environment.

    struct DeploymentInfo {
        address manager;
        address registry;
        address verifier;
        address authorization;
        address hook;
        address router;
        address signer;
        address deployer;
        bytes32 salt;
    }

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 signerKey = vm.envUint("SIGNER_PRIVATE_KEY");

        address deployer = vm.addr(deployerKey);
        address signer = vm.addr(signerKey);

        console2.log("Deployer:", deployer);
        console2.log("Signer:", signer);

        DeploymentInfo memory info;

        vm.startBroadcast(deployerKey);

        info.deployer = deployer;
        info.signer = signer;

        info.manager = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
        info.registry = address(new PolicyRegistry());
        info.verifier = address(new PolicyVerifier());

        info.authorization = address(new PolicyAuthorization(info.registry, info.verifier));

        PolicyVerifier(info.verifier).setAuthorizedSigner(signer);
        PolicyRegistry(info.registry).setAuthorizedRegistrar(deployer);
        PolicyRegistry(info.registry).setAuthorizedConsumer(info.authorization);

        (info.hook, info.salt) = _deployHook(info.manager, info.authorization);

        info.router = address(new MEVShieldRouter(IPoolManager(info.manager)));

        vm.stopBroadcast();

        _validateHookPermissions(info.hook);

        _logDeployment(info);
    }

    function _deployHook(address manager, address authorization) internal returns (address hook, bytes32 salt) {
        bytes memory constructorArgs = abi.encode(IPoolManager(manager), PolicyAuthorization(authorization));

        bytes memory initCode = abi.encodePacked(type(MEVShieldHook).creationCode, constructorArgs);

        bytes32 initCodeHash = keccak256(initCode);

        address create2Deployer = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

        address predictedHook;
        bool found;

        // Fast CREATE2 salt mining.
        // Only BEFORE_SWAP is enabled, so the low 14 bits must equal 0x80.
        for (uint256 i = 0; i < 100_000; i++) {
            bytes32 candidateSalt = bytes32(i);

            address candidate = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), create2Deployer, candidateSalt, initCodeHash)))
                )
            );

            if ((uint160(candidate) & uint160((1 << 14) - 1)) == Hooks.BEFORE_SWAP_FLAG) {
                salt = candidateSalt;
                predictedHook = candidate;
                found = true;

                console2.log("Found valid hook salt:", i);
                console2.log("Predicted hook:", predictedHook);
                break;
            }
        }

        require(found, "Could not find valid hook salt");
        require(
            predictedHook == vm.computeCreate2Address(salt, initCodeHash, create2Deployer),
            "CREATE2 address calculation mismatch"
        );

        (bool success, bytes memory result) = create2Deployer.call(abi.encodePacked(salt, initCode));

        require(success, "CREATE2 deployment failed");

        hook = address(bytes20(result));

        require(hook == predictedHook, "CREATE2 address mismatch");
    }

    function _validateHookPermissions(address hook) internal pure {
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

        Hooks.validateHookPermissions(MEVShieldHook(hook), permissions);
    }

    function _logDeployment(DeploymentInfo memory info) internal view {
        console2.log("");
        console2.log("=== MEVShield Sepolia Deployment ===");
        console2.log("PoolManager:", info.manager);
        console2.log("PolicyRegistry:", info.registry);
        console2.log("PolicyVerifier:", info.verifier);
        console2.log("PolicyAuthorization:", info.authorization);
        console2.log("MEVShieldHook:", info.hook);
        console2.log("MEVShieldRouter:", info.router);
        console2.log("AuthorizedSigner:", info.signer);
        console2.log("AuthorizedRegistrar:", info.deployer);
        console2.log("AuthorizedConsumer:", info.authorization);
        console2.log("CREATE2 Salt:");
        console2.logBytes32(info.salt);
        console2.log("Chain ID:", block.chainid);
    }
}
