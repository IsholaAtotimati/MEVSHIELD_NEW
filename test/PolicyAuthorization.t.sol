// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";

contract PolicyAuthorizationTest is Test {
    PolicyRegistry registry;
    PolicyVerifier verifier;
    PolicyAuthorization authorization;

    uint256 signerPrivateKey = 0xA11CE;
    address signer;

    address authorizedConsumer = address(0xCAFE);

    address trader = address(0x1234);
    address attacker = address(0x5678);

    bytes32 poolId = keccak256("ETH/USDC");
    bytes32 differentPoolId = keccak256("BTC/USDC");

    PolicyVerifier.Policy policy;

    function setUp() public {
        registry = new PolicyRegistry();
        registry.setAuthorizedRegistrar(address(this));
        verifier = new PolicyVerifier();

        authorization = new PolicyAuthorization(address(registry), address(verifier));

        signer = vm.addr(signerPrivateKey);

        verifier.setAuthorizedSigner(signer);

        registry.setAuthorizedConsumer(address(authorization));

        policy = PolicyVerifier.Policy({
            poolId: poolId,
            trader: trader,
            nonce: 1,
            expiry: block.timestamp + 1 hours,
            maxLoss: 100,
            maxFee: 5,
            zeroForOne: true,
            amountSpecified: -100e6,
            sqrtPriceLimitX96: 79228162514264337593543950336
        });
    }

    function _policyId(PolicyVerifier.Policy memory p) internal pure returns (bytes32) {
        return keccak256(abi.encode(p.poolId, p.trader, p.nonce));
    }

    function _signPolicy(PolicyVerifier.Policy memory p) internal view returns (bytes memory signature) {
        bytes32 digest = verifier.hashPolicy(p);

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        signature = abi.encodePacked(r, s, v);
    }

    function _registerPolicy(PolicyVerifier.Policy memory p) internal returns (bytes32 policyId) {
        policyId = registry.registerPolicy(p.poolId, p.trader, p.nonce, p.expiry, p.maxLoss, p.maxFee);
    }

    /*
     * This helper represents the future execution layer.
     *
     * It verifies the exact signed policy and then consumes
     * the corresponding registered policy.
     */
    function _authorize(PolicyVerifier.Policy memory p, bytes memory signature) internal {
        authorization.authorize(p, signature);
    }

    function test_ValidPolicyCanBeAuthorized() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        _authorize(policy, signature);

        assertTrue(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_RevertWhenValidSignatureButWrongRegistryPolicy() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory wrongPolicy = policy;
        wrongPolicy.maxLoss = 999;

        // The signature is for maxLoss = 100.
        // The execution policy says maxLoss = 999.
        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(wrongPolicy, signature);
    }

    function test_RevertWhenValidSignatureButWrongTrader() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory wrongPolicy = policy;
        wrongPolicy.trader = attacker;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(wrongPolicy, signature);
    }

    function test_RevertWhenValidSignatureButWrongPool() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory wrongPolicy = policy;
        wrongPolicy.poolId = differentPoolId;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(wrongPolicy, signature);
    }

    function test_RevertWhenValidSignatureButChangedMaxLoss() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory changedPolicy = policy;
        changedPolicy.maxLoss = 1000;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(changedPolicy, signature);
    }

    function test_RevertWhenValidSignatureButChangedMaxFee() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory changedPolicy = policy;
        changedPolicy.maxFee = 1000;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        verifier.verifyPolicy(changedPolicy, signature);
    }

    function test_RevertWhenValidSignatureButPolicyExpired() public {
        PolicyVerifier.Policy memory expiringPolicy = policy;
        expiringPolicy.expiry = block.timestamp + 1;

        _registerPolicy(expiringPolicy);

        bytes memory signature = _signPolicy(expiringPolicy);

        vm.warp(block.timestamp + 2);

        // Signature remains cryptographically valid.
        assertTrue(verifier.verifyPolicy(expiringPolicy, signature));

        // Registry must reject execution after expiry.

        vm.expectRevert(PolicyRegistry.PolicyExpired.selector);

        authorization.authorize(expiringPolicy, signature);
    }

    function test_RevertWhenValidSignatureButPolicyAlreadyConsumed() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        // Signature is cryptographically valid.
        assertTrue(verifier.verifyPolicy(policy, signature));

        // First execution succeeds.
        authorization.authorize(policy, signature);

        assertTrue(registry.isConsumed(policy.trader, policy.nonce));

        // Second execution must fail.
        vm.expectRevert(PolicyRegistry.PolicyAlreadyConsumed.selector);

        authorization.authorize(policy, signature);
    }

    function test_RevertWhenRegisteredPolicyDiffersFromSignedPolicy() public {
        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory maliciousRegistryPolicy = policy;
        maliciousRegistryPolicy.maxLoss = 9999;
        maliciousRegistryPolicy.maxFee = 9999;

        _registerPolicy(maliciousRegistryPolicy);

        vm.expectRevert(PolicyAuthorization.PolicyMismatch.selector);

        _authorize(policy, signature);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_RevertWhenRegisteredPolicyExpiryDiffers() public {
        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory registeredPolicy = policy;
        registeredPolicy.expiry = policy.expiry + 30 minutes;

        _registerPolicy(registeredPolicy);

        vm.expectRevert(PolicyAuthorization.PolicyMismatch.selector);

        authorization.authorize(policy, signature);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    // =============================================================
    // STATE TRANSITION TESTS
    // =============================================================

    function test_StateTransition_ActiveToConsumed() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));

        authorization.authorize(policy, signature);

        assertTrue(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_StateRollsBack_WhenTransactionRevertsAfterAuthorization() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));

        vm.expectRevert(bytes("rollback"));

        this._authorizeThenRevert(policy, signature);

        // The entire external call reverted.
        // Therefore the earlier ACTIVE -> CONSUMED transition was rolled back.
        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function _authorizeThenRevert(PolicyVerifier.Policy memory p, bytes memory signature) external {
        authorization.authorize(p, signature);

        assertTrue(registry.isConsumed(p.trader, p.nonce));

        // Simulate a later failure in the same transaction.
        revert("rollback");
    }

    function test_StateUnchanged_WhenSignatureInvalid() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory modifiedPolicy = policy;
        modifiedPolicy.maxLoss = policy.maxLoss + 1;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        authorization.authorize(modifiedPolicy, signature);

        // Failed authorization must not consume the policy.
        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_StateUnchanged_WhenRegisteredPolicyDoesNotMatch() public {
        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory maliciousPolicy = policy;
        maliciousPolicy.maxLoss = 9999;

        _registerPolicy(maliciousPolicy);

        vm.expectRevert(PolicyAuthorization.PolicyMismatch.selector);

        authorization.authorize(policy, signature);

        // Policy must remain unconsumed after failed authorization.
        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_StateUnchanged_WhenPolicyExpired() public {
        PolicyVerifier.Policy memory expiringPolicy = policy;
        expiringPolicy.expiry = block.timestamp + 1;

        _registerPolicy(expiringPolicy);

        bytes memory signature = _signPolicy(expiringPolicy);

        vm.warp(block.timestamp + 2);

        vm.expectRevert(PolicyRegistry.PolicyExpired.selector);

        authorization.authorize(expiringPolicy, signature);

        // Expiry must not transition the policy into CONSUMED.
        assertFalse(registry.isConsumed(expiringPolicy.trader, expiringPolicy.nonce));
    }

    function test_StateUnchanged_WhenPolicyReplayed() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        // First execution: ACTIVE -> CONSUMED.
        authorization.authorize(policy, signature);

        assertTrue(registry.isConsumed(policy.trader, policy.nonce));

        // Second execution must revert.
        vm.expectRevert(PolicyRegistry.PolicyAlreadyConsumed.selector);

        authorization.authorize(policy, signature);

        // State remains CONSUMED.
        assertTrue(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_FailedAuthorizationDoesNotConsumeDifferentPolicy() public {
        _registerPolicy(policy);

        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory wrongPolicy = policy;
        wrongPolicy.maxFee = policy.maxFee + 100;

        vm.expectRevert(PolicyVerifier.UnauthorizedSigner.selector);

        authorization.authorize(wrongPolicy, signature);

        // Original policy remains ACTIVE.
        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_RevertWhenPolicyIsNotRegistered() public {
        PolicyVerifier.Policy memory unregisteredPolicy = policy;

        bytes memory signature = _signPolicy(unregisteredPolicy);

        vm.expectRevert(PolicyAuthorization.PolicyMismatch.selector);

        authorization.authorize(unregisteredPolicy, signature);
    }

    function test_RevertWhenRegisteredPolicyNonceDiffers() public {
        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory registeredPolicy = policy;
        registeredPolicy.nonce = 2;

        _registerPolicy(registeredPolicy);

        vm.expectRevert(PolicyAuthorization.PolicyMismatch.selector);

        authorization.authorize(policy, signature);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
        assertFalse(registry.isConsumed(registeredPolicy.trader, registeredPolicy.nonce));
    }

    function test_RevertWhenRegisteredPolicyTraderDiffers() public {
        bytes memory signature = _signPolicy(policy);

        PolicyVerifier.Policy memory registeredPolicy = policy;
        registeredPolicy.trader = attacker;

        _registerPolicy(registeredPolicy);

        vm.expectRevert(PolicyAuthorization.PolicyMismatch.selector);

        authorization.authorize(policy, signature);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
        assertFalse(registry.isConsumed(registeredPolicy.trader, registeredPolicy.nonce));
    }
}
