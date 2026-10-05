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

contract EnableUserPaidRegistrationSepolia is Script {
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 signerKey = vm.envUint("SIGNER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address signer = vm.addr(signerKey);

        PolicyRegistry registry = PolicyRegistry(vm.envAddress("POLICY_REGISTRY"));
        PolicyVerifier verifier = PolicyVerifier(vm.envAddress("POLICY_VERIFIER"));

        require(registry.owner() == deployer, "Deployer is not registry owner");
        require(verifier.authorizedSigner() == signer, "Signer does not match verifier");

        vm.startBroadcast(deployerKey);

        PolicyAuthorization authorization = new PolicyAuthorization(address(registry), address(verifier));
        address hook = _deployHook(POOL_MANAGER, address(authorization));

        registry.setAuthorizedRegistrar(address(authorization));
        registry.setAuthorizedConsumer(address(authorization));

        vm.stopBroadcast();

        _validateHookPermissions(hook);

        console2.log("PolicyRegistry:", address(registry));
        console2.log("PolicyVerifier:", address(verifier));
        console2.log("PolicyAuthorization:", address(authorization));
        console2.log("MEVShieldHook:", hook);
        console2.log("MEVShieldRouter:", vm.envAddress("MEVSHIELD_ROUTER"));
        console2.log("AuthorizedRegistrar:", address(authorization));
        console2.log("AuthorizedConsumer:", address(authorization));
    }

    function _deployHook(address manager, address authorization) internal returns (address hook) {
        bytes memory constructorArgs = abi.encode(IPoolManager(manager), PolicyAuthorization(authorization));
        bytes memory initCode = abi.encodePacked(type(MEVShieldHook).creationCode, constructorArgs);
        bytes32 initCodeHash = keccak256(initCode);
        bytes32 salt;
        address predictedHook;
        bool found;

        for (uint256 i = 0; i < 100_000; i++) {
            bytes32 candidateSalt = bytes32(i);
            address candidate = address(
                uint160(
                    uint256(keccak256(abi.encodePacked(bytes1(0xff), CREATE2_DEPLOYER, candidateSalt, initCodeHash)))
                )
            );

            if ((uint160(candidate) & uint160((1 << 14) - 1)) == Hooks.BEFORE_SWAP_FLAG) {
                salt = candidateSalt;
                predictedHook = candidate;
                found = true;
                break;
            }
        }

        require(found, "Could not find valid hook salt");
        require(
            predictedHook == vm.computeCreate2Address(salt, initCodeHash, CREATE2_DEPLOYER),
            "CREATE2 address calculation mismatch"
        );

        (bool success, bytes memory result) = CREATE2_DEPLOYER.call(abi.encodePacked(salt, initCode));
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
}
