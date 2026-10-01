// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PolicyRegistry} from "./PolicyRegistry.sol";
import {PolicyVerifier} from "./PolicyVerifier.sol";

contract PolicyAuthorization {
    PolicyRegistry public immutable registry;
    PolicyVerifier public immutable verifier;

    error PolicyMismatch();

    constructor(address registry_, address verifier_) {
        registry = PolicyRegistry(registry_);
        verifier = PolicyVerifier(verifier_);
    }

    function authorize(PolicyVerifier.Policy calldata policy, bytes calldata signature)
        external
        returns (bytes32 policyId)
    {
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
                || registered.maxFee != policy.maxFee
        ) {
            revert PolicyMismatch();
        }

        // 5. Consume only after every authorization
        //    condition has passed.
        registry.consumePolicy(policyId);
    }
}
