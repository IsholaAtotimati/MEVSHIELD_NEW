// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {MEVShieldHook} from "../src/MEVShieldHook.sol";
import {MEVShieldRouter} from "../src/MEVShieldRouter.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";

contract SepoliaForkDeploymentAExecutionTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 private constant WETH_INPUT = 1e15;

    address private constant POOL_MANAGER =
        0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant HOOK =
        0xd15E4fDD391a68C2F1C385d1a819117a3aD40080;
    address private constant ROUTER =
        0x633282608B2fc66cD7572f5eF58e804063aa150D;
    address private constant USDC =
        0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH =
        0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant EXPECTED_VERIFIER =
        0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f;
    address private constant EXPECTED_AUTH =
        0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5;
    address private constant EXPECTED_REGISTRY =
        0xB2897da1CfC0c73C3983221a87C27586D1cE1c9E;

    bytes32 private constant EXPECTED_POOL_ID =
        0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602;

    IPoolManager private manager;
    MEVShieldHook private hook;
    MEVShieldRouter private router;
    PolicyAuthorization private authorization;
    PolicyRegistry private registry;
    PolicyVerifier private verifier;
    PoolKey private poolKey;
    uint256 private signerKey;

    function setUp() public {
        if (!vm.envOr("RUN_SEPOLIA_FORK_DEPLOYMENT_A_EXECUTION", false)) {
            vm.skip(true);
        }

        uint256 pinnedBlock = vm.envOr(
            "SEPOLIA_FORK_BLOCK_NUMBER", uint256(0)
        );

        require(pinnedBlock != 0, "pinned block required");
        require(block.number == pinnedBlock, "wrong fork block");
        require(block.chainid == SEPOLIA_CHAIN_ID, "not Sepolia fork");

        manager = IPoolManager(POOL_MANAGER);
        hook = MEVShieldHook(HOOK);
        router = MEVShieldRouter(payable(ROUTER));
        authorization = hook.authorization();
        registry = authorization.registry();
        verifier = authorization.verifier();

        require(POOL_MANAGER.code.length != 0, "PoolManager code missing");
        require(HOOK.code.length != 0, "hook code missing");
        require(ROUTER.code.length != 0, "router code missing");
        require(address(verifier) == EXPECTED_VERIFIER, "verifier mismatch");
        require(address(authorization) == EXPECTED_AUTH, "authorization mismatch");
        require(address(registry) == EXPECTED_REGISTRY, "registry mismatch");
        require(address(hook.poolManager()) == POOL_MANAGER, "hook manager mismatch");
        require(address(router.poolManager()) == POOL_MANAGER, "router manager mismatch");

        poolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });

        require(
            PoolId.unwrap(poolKey.toId()) == EXPECTED_POOL_ID,
            "pool ID mismatch"
        );

        signerKey = vm.envUint("SIGNER_PRIVATE_KEY");
        require(
            vm.addr(signerKey) == verifier.authorizedSigner(),
            "configured key is not authorized signer"
        );
    }

    function test_deployedPolicyCanAuthorizeProtectedSwap() public {
        uint256 nonce = uint256(
            keccak256(abi.encode(block.number, address(this), uint256(1)))
        );

        MEVShieldHook.Policy memory policy = _newPolicy(nonce, 1);
        bytes memory signature = _sign(policy);

        authorization.registerPolicy(_toVerifierPolicy(policy), signature);

        deal(WETH, address(this), WETH_INPUT);
        require(
            IERC20Minimal(WETH).approve(ROUTER, WETH_INPUT),
            "WETH approval failed"
        );

        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));

        (uint160 priceLimit,,,) = _poolPriceAndLimit(false);

        // The policy was built using the same price limit as the swap.
        require(
            policy.sqrtPriceLimitX96 == priceLimit,
            "policy price limit mismatch"
        );

        bytes memory hookData = abi.encode(
            policy, signature, uint256(0), uint256(0)
        );

        router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            hookData,
            address(this)
        );

        uint256 usdcAfter = IERC20Minimal(USDC).balanceOf(address(this));

        assertGt(usdcAfter, usdcBefore, "swap produced no USDC");
        assertTrue(
            registry.isConsumed(policy.trader, policy.nonce),
            "deployed policy was not consumed"
        );
    }


    function test_impossibleMinimumOutputRevertsAndRollsBack() public {
        uint256 nonce = uint256(
            keccak256(abi.encode(block.number, address(this), uint256(2)))
        );

        uint256 impossibleMinOut = type(uint128).max;

        MEVShieldHook.Policy memory policy = _newPolicy(
            nonce,
            impossibleMinOut
        );
        bytes memory signature = _sign(policy);

        authorization.registerPolicy(_toVerifierPolicy(policy), signature);

        deal(WETH, address(this), WETH_INPUT);
        require(
            IERC20Minimal(WETH).approve(ROUTER, WETH_INPUT),
            "WETH approval failed"
        );

        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(address(this));
        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));

        bytes memory hookData = abi.encode(
            policy,
            signature,
            uint256(0),
            uint256(0)
        );

        // Verify that the swap fails; balance and nonce checks follow.
        vm.expectPartialRevert(
            MEVShieldRouter.MinimumOutputNotMet.selector
        );

        router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            hookData,
            address(this)
        );

        assertEq(
            IERC20Minimal(WETH).balanceOf(address(this)),
            wethBefore,
            "WETH balance changed after revert"
        );
        assertEq(
            IERC20Minimal(USDC).balanceOf(address(this)),
            usdcBefore,
            "USDC balance changed after revert"
        );
        assertFalse(
            registry.isConsumed(policy.trader, policy.nonce),
            "policy consumed despite reverted transaction"
        );
    }

    function _newPolicy(uint256 nonce, uint256 minAmountOut)
        private
        view
        returns (MEVShieldHook.Policy memory policy)
    {
        (uint160 priceLimit,,,) = _poolPriceAndLimit(false);

        policy = MEVShieldHook.Policy({
            poolId: EXPECTED_POOL_ID,
            trader: ROUTER,
            nonce: nonce,
            expiry: block.timestamp + 1 hours,
            maxLoss: 0,
            maxFee: 0,
            zeroForOne: false,
            amountSpecified: -int256(WETH_INPUT),
            sqrtPriceLimitX96: priceLimit,
            minAmountOut: minAmountOut
        });
    }

    function _poolPriceAndLimit(bool zeroForOne)
        private
        view
        returns (uint160 limit, int24 currentTick, uint24 protocolFee, uint24 lpFee)
    {

        (, currentTick, protocolFee, lpFee) =
            StateLibrary.getSlot0(manager, PoolId.wrap(EXPECTED_POOL_ID));

        int24 limitTick = zeroForOne
            ? currentTick - 500
            : currentTick + 500;

        limit = TickMath.getSqrtPriceAtTick(limitTick);
    }

    function _sign(MEVShieldHook.Policy memory policy)
        private
        view
        returns (bytes memory)
    {
        bytes32 digest = verifier.hashPolicy(_toVerifierPolicy(policy));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _toVerifierPolicy(MEVShieldHook.Policy memory policy)
        private
        pure
        returns (PolicyVerifier.Policy memory)
    {
        return PolicyVerifier.Policy({
            poolId: policy.poolId,
            trader: policy.trader,
            nonce: policy.nonce,
            expiry: policy.expiry,
            maxLoss: policy.maxLoss,
            maxFee: policy.maxFee,
            zeroForOne: policy.zeroForOne,
            amountSpecified: policy.amountSpecified,
            sqrtPriceLimitX96: policy.sqrtPriceLimitX96,
            minAmountOut: policy.minAmountOut
        });
    }
}
