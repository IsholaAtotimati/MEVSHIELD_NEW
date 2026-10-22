// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Run only against a local Foundry fork:
// RUN_SEPOLIA_FORK_V2=true forge test --match-path test/SepoliaForkV2Router.t.sol \
//   --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
// This replaces hook code and deploys the v2 policy stack only in local fork state.
// No Sepolia transaction is broadcast; this does not verify or change the live deployment.

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {MEVShieldHook} from "../src/MEVShieldHook.sol";
import {MEVShieldRouter} from "../src/MEVShieldRouter.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";
import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";

contract SepoliaForkV2RouterTest is Test {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 private constant LOCAL_SIGNER_PRIVATE_KEY = 0xA11CE;
    uint256 private constant WETH_INPUT_AMOUNT = 1e15;
    uint256 private constant USDC_INPUT_AMOUNT = 1e6;
    uint160 private constant MIN_SQRT_PRICE_X96 = 4295128740;
    uint160 private constant MAX_SQRT_PRICE_X96 = 1461446703485210103287273052203988822378723970341;

    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant HOOK = 0xd8aE178f4C5a17daF7f32b3648e0Ac42f50DC080;
    bytes32 private constant EXPECTED_POOL_ID = 0x37d213cbaee2010a7fa4c5fd122001a301ea0364bf63bfee0116913f14477c78;

    IPoolManager private manager;
    PolicyRegistry private registry;
    PolicyVerifier private verifier;
    PolicyAuthorization private authorization;
    MEVShieldHook private hook;
    MEVShieldRouter private router;
    PoolKey private poolKey;
    address private signer;
    uint256 private nonce;

    function setUp() public {
        if (!vm.envOr("RUN_SEPOLIA_FORK_V2", false)) {
            vm.skip(true);
        }
        require(block.chainid == SEPOLIA_CHAIN_ID, "run with a Sepolia fork");
        require(POOL_MANAGER.code.length != 0, "PoolManager code missing");
        require(HOOK.code.length != 0, "deployed hook code missing");

        manager = IPoolManager(POOL_MANAGER);
        poolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
        require(PoolId.unwrap(poolKey.toId()) == EXPECTED_POOL_ID, "pool ID mismatch");

        uint256 slot0 = uint256(keccak256(abi.encodePacked(EXPECTED_POOL_ID, uint256(6))));
        require(uint160(uint256(manager.extsload(bytes32(slot0)))) != 0, "pool is uninitialized");
        require(uint128(uint256(manager.extsload(bytes32(slot0 + 3)))) != 0, "pool has no active liquidity");

        registry = new PolicyRegistry();
        registry.setAuthorizedRegistrar(address(this));
        verifier = new PolicyVerifier();
        authorization = new PolicyAuthorization(address(registry), address(verifier));
        router = new MEVShieldRouter(manager);

        signer = vm.addr(LOCAL_SIGNER_PRIVATE_KEY);
        verifier.setAuthorizedSigner(signer);
        registry.setAuthorizedConsumer(address(authorization));

        MEVShieldHook implementation = new MEVShieldHook(manager, authorization);
        vm.etch(HOOK, address(implementation).code);
        hook = MEVShieldHook(HOOK);
        authorization.setAuthorizedHook(address(hook));
        registry.setAuthorizedRegistrar(address(authorization));

        require(address(hook.poolManager()) == POOL_MANAGER, "fork hook PoolManager mismatch");
        require(address(hook.authorization()) == address(authorization), "fork hook authorization mismatch");
        require(address(router.poolManager()) == POOL_MANAGER, "fork router PoolManager mismatch");

        nonce = uint256(keccak256(abi.encode(block.number, address(this))));
    }

    function test_V2RouterEnforcesMinimumOutputForWethToUsdc() public {
        uint256 minAmountOut = 1;
        MEVShieldHook.Policy memory policy =
            _registerPolicy(false, -int256(WETH_INPUT_AMOUNT), MAX_SQRT_PRICE_X96 - 1, minAmountOut);

        deal(WETH, address(this), WETH_INPUT_AMOUNT);
        require(IERC20Minimal(WETH).approve(address(router), WETH_INPUT_AMOUNT), "WETH approval failed");

        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));
        BalanceDelta delta = router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            abi.encode(policy, _signature(policy), uint256(0), uint256(0)),
            address(this)
        );
        int128 outputDelta = delta.amount0();
        assertGt(outputDelta, int128(int256(minAmountOut)), "USDC output did not clear the signed minimum");
        assertEq(
            IERC20Minimal(USDC).balanceOf(address(this)) - usdcBefore,
            uint256(uint128(outputDelta)),
            "router output differs from received USDC"
        );
        assertTrue(registry.isConsumed(policy.trader, policy.nonce), "successful policy was not consumed");

        console2.log("LOCAL FORK V2 - WETH to USDC output (micro-USDC):", uint256(uint128(outputDelta)));
        console2.log("LOCAL FORK V2 - Signed minimum (micro-USDC):", minAmountOut);
    }

    function test_V2RouterEnforcesMinimumOutputForUsdcToWeth() public {
        uint256 minAmountOut = 1;
        MEVShieldHook.Policy memory policy =
            _registerPolicy(true, -int256(USDC_INPUT_AMOUNT), MIN_SQRT_PRICE_X96 + 1, minAmountOut);

        deal(USDC, address(this), USDC_INPUT_AMOUNT);
        require(IERC20Minimal(USDC).approve(address(router), USDC_INPUT_AMOUNT), "USDC approval failed");

        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(address(this));
        BalanceDelta delta = router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: policy.zeroForOne,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            abi.encode(policy, _signature(policy), uint256(0), uint256(0)),
            address(this)
        );
        int128 outputDelta = delta.amount1();
        assertGt(outputDelta, int128(int256(minAmountOut)), "WETH output did not clear the signed minimum");
        assertEq(
            IERC20Minimal(WETH).balanceOf(address(this)) - wethBefore,
            uint256(uint128(outputDelta)),
            "router output differs from received WETH"
        );
        assertTrue(registry.isConsumed(policy.trader, policy.nonce), "successful policy was not consumed");

        console2.log("LOCAL FORK V2 - USDC to WETH output (wei):", uint256(uint128(outputDelta)));
        console2.log("LOCAL FORK V2 - Signed minimum (wei):", minAmountOut);
    }

    function test_V2RouterEnforcesExactMinimumBoundaryAndRollsBackNonce() public {
        uint256 snapshotId = vm.snapshotState();
        uint160 priceLimit = MAX_SQRT_PRICE_X96 - 1;
        MEVShieldHook.Policy memory quotePolicy = _registerPolicy(false, -int256(WETH_INPUT_AMOUNT), priceLimit, 1);
        deal(WETH, address(this), WETH_INPUT_AMOUNT);
        require(IERC20Minimal(WETH).approve(address(router), WETH_INPUT_AMOUNT), "WETH quote approval failed");

        BalanceDelta quoteDelta = router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: quotePolicy.zeroForOne,
                amountSpecified: quotePolicy.amountSpecified,
                sqrtPriceLimitX96: quotePolicy.sqrtPriceLimitX96
            }),
            abi.encode(quotePolicy, _signature(quotePolicy), uint256(0), uint256(0)),
            address(this)
        );
        int128 quoteOutputDelta = quoteDelta.amount0();
        assertGt(quoteOutputDelta, 1, "fork quote is too small for boundary test");
        uint256 quotedOutput = uint256(uint128(quoteOutputDelta));
        require(vm.revertToState(snapshotId), "could not restore fork state after quote");

        MEVShieldHook.Policy memory exactPolicy =
            _registerPolicy(false, -int256(WETH_INPUT_AMOUNT), priceLimit, quotedOutput);
        deal(WETH, address(this), WETH_INPUT_AMOUNT);
        require(IERC20Minimal(WETH).approve(address(router), WETH_INPUT_AMOUNT), "WETH exact-boundary approval failed");

        BalanceDelta exactDelta = router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: exactPolicy.zeroForOne,
                amountSpecified: exactPolicy.amountSpecified,
                sqrtPriceLimitX96: exactPolicy.sqrtPriceLimitX96
            }),
            abi.encode(exactPolicy, _signature(exactPolicy), uint256(0), uint256(0)),
            address(this)
        );
        assertEq(uint256(uint128(exactDelta.amount0())), quotedOutput, "minimum equal to actual output should pass");
        assertTrue(registry.isConsumed(exactPolicy.trader, exactPolicy.nonce), "exact-boundary policy not consumed");
        require(vm.revertToState(snapshotId), "could not restore fork state before above-bound test");

        MEVShieldHook.Policy memory abovePolicy =
            _registerPolicy(false, -int256(WETH_INPUT_AMOUNT), priceLimit, quotedOutput + 1);
        deal(WETH, address(this), WETH_INPUT_AMOUNT);
        require(IERC20Minimal(WETH).approve(address(router), WETH_INPUT_AMOUNT), "WETH above-bound approval failed");

        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(address(this));
        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));
        bytes memory hookData = abi.encode(abovePolicy, _signature(abovePolicy), uint256(0), uint256(0));
        vm.expectPartialRevert(MEVShieldRouter.MinimumOutputNotMet.selector);
        router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: abovePolicy.zeroForOne,
                amountSpecified: abovePolicy.amountSpecified,
                sqrtPriceLimitX96: abovePolicy.sqrtPriceLimitX96
            }),
            hookData,
            address(this)
        );

        assertFalse(registry.isConsumed(abovePolicy.trader, abovePolicy.nonce), "reverted swap consumed its policy");
        assertEq(IERC20Minimal(WETH).balanceOf(address(this)), wethBefore, "reverted swap spent WETH");
        assertEq(IERC20Minimal(USDC).balanceOf(address(this)), usdcBefore, "reverted swap transferred USDC");

        console2.log("LOCAL FORK V2 - Exact minimum boundary (micro-USDC):", quotedOutput);
        console2.log("LOCAL FORK V2 - One unit above minimum reverted.");
    }

    function _registerPolicy(bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, uint256 minAmountOut)
        private
        returns (MEVShieldHook.Policy memory policy)
    {
        policy = MEVShieldHook.Policy({
            poolId: EXPECTED_POOL_ID,
            trader: address(router),
            nonce: nonce++,
            expiry: block.timestamp + 1 hours,
            maxLoss: 0,
            maxFee: 0,
            zeroForOne: zeroForOne,
            amountSpecified: amountSpecified,
            sqrtPriceLimitX96: sqrtPriceLimitX96,
            minAmountOut: minAmountOut
        });

        PolicyVerifier.Policy memory verifierPolicy = _verifierPolicy(policy);
        bytes memory signature = _signature(policy);
        authorization.registerPolicy(verifierPolicy, signature);
    }

    function _signature(MEVShieldHook.Policy memory policy) private view returns (bytes memory) {
        PolicyVerifier.Policy memory verifierPolicy = _verifierPolicy(policy);
        bytes32 digest = verifier.hashPolicy(verifierPolicy);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(LOCAL_SIGNER_PRIVATE_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _verifierPolicy(MEVShieldHook.Policy memory policy) private pure returns (PolicyVerifier.Policy memory) {
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
