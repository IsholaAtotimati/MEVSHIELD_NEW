// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {Deployers} from "../lib/v4-core/test/utils/Deployers.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";

import {MEVShieldHook} from "../src/MEVShieldHook.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";
import {MEVShieldRouter} from "../src/MEVShieldRouter.sol";

contract MEVShieldIntegrationTest is Test, Deployers {
    using PoolIdLibrary for PoolKey;

    PolicyRegistry internal registry;
    PolicyVerifier internal verifier;
    PolicyAuthorization internal authorization;
    MEVShieldRouter internal mevShieldRouter;

    MEVShieldHook internal implementation;
    MEVShieldHook internal hook;

    uint256 internal signerPrivateKey = 0xA11CE;
    address internal signer;

    uint256 internal expiry;

    function setUp() public {
        /*
         * ------------------------------------------------------------
         * 1. Deploy the real v4 PoolManager + test routers
         * ------------------------------------------------------------
         */
        deployFreshManagerAndRouters();

        /*
         * ------------------------------------------------------------
         * 2. Deploy MEVShield authorization stack
         * ------------------------------------------------------------
         */
        registry = new PolicyRegistry();
        registry.setAuthorizedRegistrar(address(this));
        verifier = new PolicyVerifier();
        authorization = new PolicyAuthorization(address(registry), address(verifier));
        mevShieldRouter = new MEVShieldRouter(manager);

        signer = vm.addr(signerPrivateKey);

        verifier.setAuthorizedSigner(signer);
        registry.setAuthorizedConsumer(address(authorization));

        /*
         * ------------------------------------------------------------
         * 3. Deploy hook implementation
         *
         * The implementation is deployed normally so its immutable
         * PoolManager + Authorization addresses are embedded correctly.
         * ------------------------------------------------------------
         */
        implementation = new MEVShieldHook(manager, authorization);

        /*
         * ------------------------------------------------------------
         * 4. Give the hook a valid BEFORE_SWAP permission address.
         *
         * Uniswap v4 encodes hook permissions in the low bits of the
         * hook address.
         *
         * BEFORE_SWAP_FLAG = 1 << 7 = 0x80
         * ------------------------------------------------------------
         */
        address hookAddress = address(uint160(0x100000 | Hooks.BEFORE_SWAP_FLAG));

        vm.etch(hookAddress, address(implementation).code);

        hook = MEVShieldHook(hookAddress);

        /*
         * ------------------------------------------------------------
         * 5. Deploy two test ERC20s and initialize a real pool.
         *
         * The pool has ONLY BEFORE_SWAP enabled, so v4 will call our
         * beforeSwap hook but will not call the reverting afterSwap hook.
         * ------------------------------------------------------------
         */
        deployMintAndApprove2Currencies();

        (key,) = initPoolAndAddLiquidity(currency0, currency1, IHooks(address(hook)), 3000, SQRT_PRICE_1_1);

        expiry = block.timestamp + 1 days;
    }

    function _policy() internal view returns (MEVShieldHook.Policy memory policy) {
        policy = MEVShieldHook.Policy({
            poolId: PoolId.unwrap(key.toId()),
            /*
             * IMPORTANT:
             *
             * PoolSwapTest calls PoolManager.swap().
             * Therefore PoolManager -> Hook sees PoolSwapTest as sender.
             */
            trader: address(swapRouter),
            nonce: 1,
            expiry: expiry,
            maxLoss: 100e6,
            maxFee: 5000,
            zeroForOne: true,
            amountSpecified: -100e6,
            /*
             * 1:1 price limit.
             */
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
    }

    function _routerPolicy() internal view returns (MEVShieldHook.Policy memory policy) {
        policy = MEVShieldHook.Policy({
            poolId: PoolId.unwrap(key.toId()),
            /*
             * PoolManager.swap() is called by MEVShieldRouter,
             * therefore MEVShieldHook sees MEVShieldRouter as sender.
             */
            trader: address(mevShieldRouter),
            nonce: 100,
            expiry: expiry,
            maxLoss: 100e6,
            maxFee: 5000,
            zeroForOne: true,
            amountSpecified: -100e6,
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });
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

    function _hookData() internal returns (bytes memory) {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        /*
         * Keep actualLoss and actualFee within the signed limits.
         */
        return abi.encode(policy, signature, policy.maxLoss, policy.maxFee);
    }

    function test_Integration_RealPoolManagerReachesHook() public {
        MEVShieldHook.Policy memory policy = _policy();

        bytes memory signature = _signPolicy(policy);

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        /*
         * PoolSwapTest's sender becomes the sender observed by
         * PoolManager -> Hooks -> MEVShieldHook.
         */
        assertEq(policy.trader, address(swapRouter));

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));

        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        bytes memory hookData = abi.encode(policy, signature, policy.maxLoss, policy.maxFee);

        /*
         * This is the real v4 execution path:
         *
         * test
         *   ↓
         * PoolSwapTest
         *   ↓
         * PoolManager.unlock()
         *   ↓
         * PoolManager.swap()
         *   ↓
         * Hooks.beforeSwap()
         *   ↓
         * MEVShieldHook.beforeSwap()
         *   ↓
         * PolicyAuthorization.authorize()
         *   ↓
         * PolicyVerifier.verifyPolicy()
         *   ↓
         * PolicyRegistry.consumePolicy()
         */
        swapRouter.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);

        /*
         * Successful authorization must consume the nonce.
         */
        assertTrue(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_Integration_ReplayedPolicyFails() public {
        bytes memory hookData = _hookData();

        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        /*
         * First execution succeeds and consumes the policy.
         */
        swapRouter.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);

        assertTrue(registry.isConsumed(address(swapRouter), 1));

        /*
         * The same signed policy cannot be used again.
         */
        vm.expectRevert();

        swapRouter.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);
    }

    function test_Integration_WrongPoolPolicyFails() public {
        MEVShieldHook.Policy memory policy = _policy();

        bytes32 wrongPool = keccak256("wrong-pool");

        policy.poolId = wrongPool;

        bytes memory signature = _signPolicy(policy);

        /*
         * No registry registration is needed because the hook should
         * reject the pool mismatch before authorization.
         */
        bytes memory hookData = abi.encode(policy, signature, policy.maxLoss, policy.maxFee);

        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -100e6, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        vm.expectRevert();

        swapRouter.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_Integration_WrongSwapParametersFail() public {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        bytes memory hookData = abi.encode(policy, signature, policy.maxLoss, policy.maxFee);

        /*
         * Policy says -100e6.
         * Actual swap attempts -200e6.
         */
        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -200e6, sqrtPriceLimitX96: MIN_PRICE_LIMIT});

        vm.expectRevert();

        swapRouter.swap(key, params, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData);

        /*
         * Authorization must not consume the policy because the hook
         * rejected the swap before authorization.
         */
        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_Integration_MaxLossExceededFailsWithoutConsumingPolicy() public {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        uint256 actualLoss = policy.maxLoss + 1;
        uint256 actualFee = policy.maxFee;

        bytes memory hookData = abi.encode(policy, signature, actualLoss, actualFee);

        vm.expectRevert();

        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_Integration_MaxFeeExceededFailsWithoutConsumingPolicy() public {
        MEVShieldHook.Policy memory policy = _policy();

        registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        uint256 actualLoss = policy.maxLoss;
        uint256 actualFee = policy.maxFee + 1;

        bytes memory hookData = abi.encode(policy, signature, actualLoss, actualFee);

        vm.expectRevert();

        swapRouter.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            hookData
        );

        assertFalse(registry.isConsumed(policy.trader, policy.nonce));
    }

    function test_Integration_MEVShieldRouterExecutesProtectedSwap() public {
        MEVShieldHook.Policy memory policy = _routerPolicy();

        registry.registerPolicy(
            policy.poolId,
            policy.trader,
            policy.nonce,
            policy.expiry,
            policy.maxLoss,
            policy.maxFee
        );

        bytes memory signature = _signPolicy(policy);

        bytes memory hookData =
            abi.encode(
                policy,
                signature,
                policy.maxLoss,
                policy.maxFee
            );

        IPoolManager.SwapParams memory params =
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            });

        /*
         * The test contract is the user/payer.
         * The router pulls the input token during PoolManager settlement.
         */
        IERC20Minimal(Currency.unwrap(key.currency0)).approve(
            address(mevShieldRouter),
            type(uint256).max
        );

        assertGt(
            key.currency0.balanceOf(address(this)),
            0
        );

        assertFalse(
            registry.isConsumed(
                policy.trader,
                policy.nonce
            )
        );

        mevShieldRouter.executeSwap(
            key,
            params,
            hookData,
            address(this)
        );

        /*
         * Successful execution proves:
         *
         * user
         *   -> MEVShieldRouter
         *   -> PoolManager.unlock()
         *   -> PoolManager.swap()
         *   -> MEVShieldHook
         *   -> PolicyAuthorization
         *   -> PolicyVerifier
         *   -> PolicyRegistry.consumePolicy()
         */
        assertTrue(
            registry.isConsumed(
                policy.trader,
                policy.nonce
            )
        );
    }

}
