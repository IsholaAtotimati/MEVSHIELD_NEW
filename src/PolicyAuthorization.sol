// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PolicyRegistry} from "./PolicyRegistry.sol";
import {PolicyVerifier} from "./PolicyVerifier.sol";

contract PolicyAuthorization {
    PolicyRegistry public immutable registry;
    PolicyVerifier public immutable verifier;
    address public immutable owner;
    address public authorizedHook;

    error PolicyMismatch();
    error Unauthorized();
    error HookAlreadyConfigured();
    error InvalidHook();
    error InvalidDependency();

    constructor(address registry_, address verifier_) {
        if (registry_ == address(0) || verifier_ == address(0)) {
            revert InvalidDependency();
        }
        owner = msg.sender;
        registry = PolicyRegistry(registry_);
        verifier = PolicyVerifier(verifier_);
    }

    /// @notice Configure the single hook allowed to consume policies.
    /// @dev The deployer can configure this once, after hook deployment.
    function setAuthorizedHook(address hook) external {
        if (msg.sender != owner) revert Unauthorized();
        if (hook == address(0)) revert InvalidHook();
        if (authorizedHook != address(0)) revert HookAlreadyConfigured();
        authorizedHook = hook;
    }

    function registerPolicy(PolicyVerifier.Policy calldata policy, bytes calldata signature)
        external
        returns (bytes32 policyId)
    {
        verifier.verifyPolicy(policy, signature);

        return registry.registerPolicy(
            policy.poolId,
            policy.trader,
            policy.nonce,
            policy.expiry,
            policy.maxLoss,
            policy.maxFee,
            policy.minAmountOut
        );
    }

    function authorize(PolicyVerifier.Policy calldata policy, bytes calldata signature)
        external
        returns (bytes32 policyId)
    {
        if (authorizedHook == address(0) || msg.sender != authorizedHook) {
            revert Unauthorized();
        }

        // 1. Cryptographic authorization.
        verifier.verifyPolicy(policy, signature);

        // 2. Derive the registered policy identity.
        policyId = keccak256(abi.encode(policy.poolId, policy.trader, policy.nonce));

        // 3. Load the policy registered on-chain.
        PolicyRegistry.Policy memory registered = registry.getPolicy(policyId);

        // 4. The signed policy MUST exactly equal
        //    the registered policy.
        if (
            registered.poolId != policy.poolId || registered.trader != policy.trader || registered.nonce != policy.nonce
                || registered.expiry != policy.expiry || registered.maxLoss != policy.maxLoss
                || registered.maxFee != policy.maxFee || registered.minAmountOut != policy.minAmountOut
        ) {
            revert PolicyMismatch();
        }

        // 5. Consume only after every authorization
        //    condition has passed.
        registry.consumePolicy(policyId);
    }
}
