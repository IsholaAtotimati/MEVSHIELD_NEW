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

contract SepoliaForkDeploymentBExecutionTest is Test {
    using PoolIdLibrary for PoolKey;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 private constant WETH_INPUT = 1e15;

    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant HOOK = 0x15D8C5eb1b839A4Fd86989348c1371c10168c080;
    address private constant ROUTER = 0x78ffC9Fd8cd6312Ac6f4038FBBFF4870d8dC4283;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant EXPECTED_VERIFIER = 0xD3635b589dB0B4E215283274937C0b7600314A6d;
    address private constant EXPECTED_AUTH = 0xEDC98B44349EDF0D0b71cBc5D4523352ffB8c821;
    address private constant EXPECTED_REGISTRY = 0x3b1b05954b226633e87cC875593E5E8FB998eFBC;

    bytes32 private constant EXPECTED_POOL_ID = 0xba95e58e09df6620bcf06cf124eb902eba371655696b14ba8b43ec1b9fc22235;

    IPoolManager private manager;
    MEVShieldHook private hook;
    MEVShieldRouter private router;
    PolicyAuthorization private authorization;
    PolicyRegistry private registry;
    PolicyVerifier private verifier;
    PoolKey private poolKey;
    // Disposable key used only inside the local Sepolia fork.
    uint256 private constant FORK_SIGNER_KEY = 0xA11CE;

    function setUp() public {
        if (!vm.envOr("RUN_SEPOLIA_FORK_DEPLOYMENT_B_EXECUTION", false)) {
            vm.skip(true);
        }

        uint256 pinnedBlock = vm.envOr("SEPOLIA_FORK_BLOCK_NUMBER", uint256(0));

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

        require(PoolId.unwrap(poolKey.toId()) == EXPECTED_POOL_ID, "pool ID mismatch");

        // Verify the original Deployment B signer before changing fork state.
        address liveSigner = verifier.authorizedSigner();
        address expectedLiveSigner = address(uint160(0x016B78a30CE176EF0B90c122e8677e13aAB2A815));

        require(liveSigner == expectedLiveSigner, "unexpected live authorized signer");

        // Confirm storage slot 3 matches the deployed getter.
        bytes32 signerSlot = bytes32(uint256(3));
        bytes32 originalSlotValue = vm.load(address(verifier), signerSlot);

        require(originalSlotValue == bytes32(uint256(uint160(liveSigner))), "authorizedSigner storage slot mismatch");

        // Change signer only in the disposable fork's local state.
        address forkSigner = vm.addr(FORK_SIGNER_KEY);
        require(forkSigner != liveSigner, "fork signer must be different");

        vm.store(address(verifier), signerSlot, bytes32(uint256(uint160(forkSigner))));

        require(verifier.authorizedSigner() == forkSigner, "fork signer override failed");
    }

    function test_deployedPolicyCanAuthorizeProtectedSwap() public {
        uint256 nonce = uint256(keccak256(abi.encode(block.number, address(this), uint256(1))));

        MEVShieldHook.Policy memory policy = _newPolicy(nonce, 1);
        bytes memory signature = _sign(policy);

        authorization.registerPolicy(_toVerifierPolicy(policy), signature);

        deal(WETH, address(this), WETH_INPUT);
        require(IERC20Minimal(WETH).approve(ROUTER, WETH_INPUT), "WETH approval failed");

        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));

        (uint160 priceLimit,,,) = _poolPriceAndLimit(false);

        // The policy was built using the same price limit as the swap.
        require(policy.sqrtPriceLimitX96 == priceLimit, "policy price limit mismatch");

        bytes memory hookData = abi.encode(policy, signature, uint256(0), uint256(0));

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
        emit log_named_uint("Actual USDC output (6 decimals)", usdcAfter - usdcBefore);

        assertGt(usdcAfter, usdcBefore, "swap produced no USDC");
        assertTrue(registry.isConsumed(policy.trader, policy.nonce), "deployed policy was not consumed");
    }

    function test_impossibleMinimumOutputRevertsAndRollsBack() public {
        uint256 nonce = uint256(keccak256(abi.encode(block.number, address(this), uint256(2))));

        uint256 impossibleMinOut = type(uint128).max;

        MEVShieldHook.Policy memory policy = _newPolicy(nonce, impossibleMinOut);
        bytes memory signature = _sign(policy);

        authorization.registerPolicy(_toVerifierPolicy(policy), signature);

        deal(WETH, address(this), WETH_INPUT);
        require(IERC20Minimal(WETH).approve(ROUTER, WETH_INPUT), "WETH approval failed");

        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(address(this));
        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));

        bytes memory hookData = abi.encode(policy, signature, uint256(0), uint256(0));

        // Verify that the swap fails; balance and nonce checks follow.
        vm.expectPartialRevert(MEVShieldRouter.MinimumOutputNotMet.selector);

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

        assertEq(IERC20Minimal(WETH).balanceOf(address(this)), wethBefore, "WETH balance changed after revert");
        assertEq(IERC20Minimal(USDC).balanceOf(address(this)), usdcBefore, "USDC balance changed after revert");
        assertFalse(registry.isConsumed(policy.trader, policy.nonce), "policy consumed despite reverted transaction");
    }

    function _newPolicy(uint256 nonce, uint256 minAmountOut) private view returns (MEVShieldHook.Policy memory policy) {
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
        (, currentTick, protocolFee, lpFee) = StateLibrary.getSlot0(manager, PoolId.wrap(EXPECTED_POOL_ID));

        int24 limitTick = zeroForOne ? currentTick - 500 : currentTick + 500;

        limit = TickMath.getSqrtPriceAtTick(limitTick);
    }

    function _sign(MEVShieldHook.Policy memory policy) private view returns (bytes memory) {
        bytes32 digest = verifier.hashPolicy(_toVerifierPolicy(policy));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(FORK_SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _toVerifierPolicy(MEVShieldHook.Policy memory policy) private pure returns (PolicyVerifier.Policy memory) {
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
