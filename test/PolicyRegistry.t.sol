// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";

contract PolicyRegistryTest is Test {
    PolicyRegistry registry;

    address trader = address(0x1234);
    address traderTwo = address(0x5678);
    address attacker = address(0x9999);
    address hook = address(0xBEEF);

    bytes32 poolId = keccak256("USDC_POOL");

    uint256 nonce = 1;
    uint256 expiry;

    uint256 maxLoss = 100e6;
    uint256 maxFee = 10e6;

    function setUp() public {
        registry = new PolicyRegistry();

        registry.setAuthorizedRegistrar(address(this));

        expiry = block.timestamp + 1 days;
    }

    // ------------------------------------------------------------
    // Registration
    // ------------------------------------------------------------

    function test_RegisterPolicy() public {
        bytes32 policyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        PolicyRegistry.Policy memory policy = registry.getPolicy(policyId);

        assertEq(policy.poolId, poolId);
        assertEq(policy.trader, trader);
        assertEq(policy.nonce, nonce);
        assertEq(policy.expiry, expiry);
        assertEq(policy.maxLoss, maxLoss);
        assertEq(policy.maxFee, maxFee);
    }

    function test_PolicyIdIsDeterministic() public {
        bytes32 expectedPolicyId = keccak256(abi.encode(poolId, trader, nonce));

        bytes32 actualPolicyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        assertEq(actualPolicyId, expectedPolicyId);
    }

    // ------------------------------------------------------------
    // Input validation
    // ------------------------------------------------------------

    function test_RevertWhenPoolIsZero() public {
        vm.expectRevert(PolicyRegistry.InvalidPool.selector);

        registry.registerPolicy(bytes32(0), trader, nonce, expiry, maxLoss, maxFee);
    }

    function test_RevertWhenTraderIsZero() public {
        vm.expectRevert(PolicyRegistry.InvalidTrader.selector);

        registry.registerPolicy(poolId, address(0), nonce, expiry, maxLoss, maxFee);
    }

    function test_RevertWhenPolicyIsExpired() public {
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert(PolicyRegistry.InvalidExpiry.selector);

        registry.registerPolicy(poolId, trader, nonce, block.timestamp, maxLoss, maxFee);
    }

    // ------------------------------------------------------------
    // Nonce uniqueness
    // ------------------------------------------------------------

    function test_ThreatModel_UnauthorizedAddressCannotGriefTraderNonce() public {
        vm.prank(attacker);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);

        registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        assertFalse(registry.isRegistered(trader, nonce));
    }

    function test_RevertWhenNonceAlreadyRegistered() public {
        registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        vm.expectRevert(PolicyRegistry.NonceAlreadyRegistered.selector);

        registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);
    }

    function test_DifferentTradersCanUseSameNonce() public {
        registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        bytes32 policyId = registry.registerPolicy(poolId, traderTwo, nonce, expiry, maxLoss, maxFee);

        PolicyRegistry.Policy memory policy = registry.getPolicy(policyId);

        assertEq(policy.trader, traderTwo);
        assertEq(policy.nonce, nonce);
    }

    // ------------------------------------------------------------
    // Registration state
    // ------------------------------------------------------------

    function test_IsRegistered() public {
        assertFalse(registry.isRegistered(trader, nonce));

        registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        assertTrue(registry.isRegistered(trader, nonce));
    }

    // ------------------------------------------------------------
    // Authorization
    // ------------------------------------------------------------

    function test_OwnerCanSetAuthorizedConsumer() public {
        registry.setAuthorizedConsumer(hook);

        assertEq(registry.authorizedConsumer(), hook);
    }

    function test_RevertWhenNonOwnerSetsConsumer() public {
        vm.prank(attacker);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);

        registry.setAuthorizedConsumer(hook);
    }

    function test_RevertWhenConsumerIsZero() public {
        vm.expectRevert(PolicyRegistry.InvalidConsumer.selector);

        registry.setAuthorizedConsumer(address(0));
    }

    function test_RevertWhenUnauthorizedAddressConsumesPolicy() public {
        bytes32 policyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        vm.prank(attacker);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);

        registry.consumePolicy(policyId);
    }

    // ------------------------------------------------------------
    // Policy consumption
    // ------------------------------------------------------------

    function test_AuthorizedConsumerCanConsumePolicy() public {
        registry.setAuthorizedConsumer(hook);

        bytes32 policyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        assertFalse(registry.isConsumed(trader, nonce));

        vm.prank(hook);

        registry.consumePolicy(policyId);

        assertTrue(registry.isConsumed(trader, nonce));
    }

    function test_RevertWhenPolicyConsumedTwice() public {
        registry.setAuthorizedConsumer(hook);

        bytes32 policyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        vm.startPrank(hook);

        registry.consumePolicy(policyId);

        vm.expectRevert(PolicyRegistry.PolicyAlreadyConsumed.selector);

        registry.consumePolicy(policyId);

        vm.stopPrank();
    }

    function test_RevertWhenUnknownPolicyIsConsumed() public {
        registry.setAuthorizedConsumer(hook);

        bytes32 unknownPolicyId = keccak256("UNKNOWN_POLICY");

        vm.prank(hook);

        vm.expectRevert(PolicyRegistry.PolicyNotFound.selector);

        registry.consumePolicy(unknownPolicyId);
    }

    function test_RevertWhenExpiredPolicyIsConsumed() public {
        registry.setAuthorizedConsumer(hook);

        bytes32 policyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        vm.warp(expiry);

        vm.prank(hook);

        vm.expectRevert(PolicyRegistry.PolicyExpired.selector);

        registry.consumePolicy(policyId);
    }

    function test_RevertWhenNonOwnerSetsRegistrar() public {
        attacker = makeAddr("attacker");
        address newRegistrar = makeAddr("newRegistrar");

        vm.prank(attacker);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);

        registry.setAuthorizedRegistrar(newRegistrar);
    }

    function test_RevertWhenRegistrarIsZero() public {
        vm.expectRevert(PolicyRegistry.InvalidRegistrar.selector);

        registry.setAuthorizedRegistrar(address(0));
    }

    function test_ChangingRegistrarRevokesOldRegistrar() public {
        address oldRegistrar = address(this);
        address newRegistrar = makeAddr("newRegistrar");

        registry.setAuthorizedRegistrar(newRegistrar);

        vm.prank(oldRegistrar);

        vm.expectRevert(PolicyRegistry.Unauthorized.selector);

        registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);
    }

    function test_NewRegistrarCanRegisterAfterRotation() public {
        address newRegistrar = makeAddr("newRegistrar");

        registry.setAuthorizedRegistrar(newRegistrar);

        vm.prank(newRegistrar);

        bytes32 policyId = registry.registerPolicy(poolId, trader, nonce, expiry, maxLoss, maxFee);

        assertTrue(policyId != bytes32(0));
        assertTrue(registry.isRegistered(trader, nonce));
    }
}
