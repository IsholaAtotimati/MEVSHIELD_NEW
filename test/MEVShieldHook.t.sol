// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {MEVShieldHook} from "../src/MEVShieldHook.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";

contract MEVShieldHookTest is Test {
    using PoolIdLibrary for PoolKey;

    MEVShieldHook internal hook;

    PolicyRegistry internal registry;
    PolicyVerifier internal verifier;
    PolicyAuthorization internal authorization;

    uint256 internal signerPrivateKey = 0xA11CE;
    address internal signer;

    address internal poolManager = address(0x100);
    address internal trader = address(0x200);
    address internal attacker = address(0x300);

    PoolKey internal key;

    uint256 internal expiry;

    function setUp() public {
        registry = new PolicyRegistry();
        registry.setAuthorizedRegistrar(address(this));
        verifier = new PolicyVerifier();
        authorization = new PolicyAuthorization(address(registry), address(verifier));

        signer = vm.addr(signerPrivateKey);

        verifier.setAuthorizedSigner(signer);
        registry.setAuthorizedConsumer(address(authorization));

        hook = new MEVShieldHook(IPoolManager(poolManager), authorization);

        key = PoolKey({
            currency0: Currency.wrap(address(0x400)),
            currency1: Currency.wrap(address(0x500)),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(address(hook))
        });

        expiry = block.timestamp + 1 days;
    }

    function _policy() internal view returns (MEVShieldHook.Policy memory policy) {
        policy = MEVShieldHook.Policy({
            poolId: PoolId.unwrap(key.toId()),
            trader: trader,
            nonce: 1,
            expiry: expiry,
            maxLoss: 100e6,
            maxFee: 5000,
            zeroForOne: true,
            amountSpecified: -100e6,
            sqrtPriceLimitX96: 79228162514264337593543950336
        });
    }

    function _hookData() internal returns (bytes memory) {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        return abi.encode(policy, signature, policy.maxLoss, policy.maxFee);
    }

    function _signPolicy(MEVShieldHook.Policy memory policy) internal view returns (bytes memory signature) {
        bytes32 digest = verifier.hashPolicy(
            PolicyVerifier.Policy({
                poolId: policy.poolId,
                trader: policy.trader,
                nonce: policy.nonce,
                expiry: policy.expiry,
                maxLoss: policy.maxLoss,
                maxFee: policy.maxFee,
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            })
        );

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);

        signature = abi.encodePacked(r, s, v);
    }

    function _params() internal pure returns (IPoolManager.SwapParams memory params) {
        params = IPoolManager.SwapParams({
            zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: 79228162514264337593543950336
        });
    }

    function test_BeforeSwap_RequiresAuthorization() public {
        MEVShieldHook.Policy memory policy = _policy();

        // Register the exact policy on-chain.
        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        // Create the authorized EIP-712 signature.
        bytes memory signature = _signPolicy(policy);

        // The policy is valid and authorized off-chain/on-chain,
        // but the current hook does not yet consume authorization.
        vm.prank(poolManager);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy, signature, policy.maxLoss, policy.maxFee));

        // This assertion documents the desired state transition:
        // ACTIVE -> CONSUMED.
        assertTrue(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_BeforeSwap_AllowsValidPolicy() public {
        bytes memory hookData = _hookData();

        vm.prank(poolManager);

        (bytes4 selector, BeforeSwapDelta delta, uint24 fee) = hook.beforeSwap(trader, key, _params(), hookData);

        assertEq(selector, hook.beforeSwap.selector);
        assertEq(BeforeSwapDelta.unwrap(delta), BeforeSwapDelta.unwrap(BeforeSwapDeltaLibrary.ZERO_DELTA));
        assertEq(fee, 0);
    }

    function test_ThreatModel_ActualLossAndFeeAreCallerSupplied() public {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        // These values are supplied through hookData.
        // The hook only checks that they are within the signed limits.
        uint256 claimedLoss = 0;
        uint256 claimedFee = 0;

        vm.prank(poolManager);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy, signature, claimedLoss, claimedFee));

        // Authorization succeeds because the supplied claims
        // do not exceed the signed limits.
        assertTrue(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_RevertWhenActualLossExceedsMaxLoss() public {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        vm.prank(poolManager);

        vm.expectRevert(MEVShieldHook.MaxLossExceeded.selector);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy, signature, policy.maxLoss + 1, policy.maxFee));

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_RevertWhenActualFeeExceedsMaxFee() public {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        vm.prank(poolManager);

        vm.expectRevert(MEVShieldHook.MaxFeeExceeded.selector);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy, signature, policy.maxLoss, policy.maxFee + 1));

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_RevertWhenPoolDoesNotMatchPolicy() public {
        MEVShieldHook.Policy memory policy = _policy();

        policy.poolId = keccak256("wrong-pool");

        bytes memory signature = _signPolicy(policy);

        vm.prank(poolManager);

        vm.expectRevert(MEVShieldHook.PoolMismatch.selector);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy, signature));
    }

    function test_RevertWhenTraderDoesNotMatchPolicy() public {
        MEVShieldHook.Policy memory policy = _policy();

        bytes memory signature = _signPolicy(policy);

        vm.prank(poolManager);

        vm.expectRevert(MEVShieldHook.TraderMismatch.selector);

        hook.beforeSwap(attacker, key, _params(), abi.encode(policy, signature));
    }

    function test_RevertWhenPolicyExpired() public {
        MEVShieldHook.Policy memory policy = _policy();

        bytes memory signature = _signPolicy(policy);

        vm.warp(policy.expiry);

        vm.prank(poolManager);

        vm.expectRevert(MEVShieldHook.PolicyExpired.selector);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy, signature));
    }

    function test_RevertWhenCallerIsNotPoolManager() public {
        MEVShieldHook.Policy memory policy = _policy();

        vm.prank(trader);

        vm.expectRevert(MEVShieldHook.Unauthorized.selector);

        hook.beforeSwap(trader, key, _params(), abi.encode(policy));
    }
}
