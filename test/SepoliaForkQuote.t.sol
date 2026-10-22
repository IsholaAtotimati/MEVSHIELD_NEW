// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Run only against a local Foundry fork:
// RUN_SEPOLIA_FORK_QUOTE=true forge test --match-path test/SepoliaForkQuote.t.sol \
//   --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
// Optional input overrides: SEPOLIA_FORK_WETH_INPUT (wei), SEPOLIA_FORK_USDC_INPUT (micro-USDC).
// Fork state is modified to use a disposable signer and token balance; no RPC transaction is broadcast.
// This deliberately exercises the currently deployed legacy policy schema, not the local v2 schema.

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

interface ILegacyPolicyVerifier {
    struct Policy {
        bytes32 poolId;
        address trader;
        uint256 nonce;
        uint256 expiry;
        uint256 maxLoss;
        uint256 maxFee;
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function authorizedSigner() external view returns (address);
    function POLICY_TYPEHASH() external view returns (bytes32);
    function hashPolicy(Policy calldata policy) external view returns (bytes32);
}

interface ILegacyPolicyAuthorization {
    function registry() external view returns (address);
    function verifier() external view returns (address);
    function registerPolicy(ILegacyPolicyVerifier.Policy calldata policy, bytes calldata signature)
        external
        returns (bytes32 policyId);
}

interface ILegacyPolicyRegistry {
    function authorizedConsumer() external view returns (address);
    function authorizedRegistrar() external view returns (address);
}

interface ILegacyHook {
    function poolManager() external view returns (address);
    function authorization() external view returns (address);
}

interface ILegacyRouter {
    function poolManager() external view returns (address);

    function executeSwap(
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData,
        address recipient
    ) external payable returns (int256 delta);
}

contract SepoliaForkQuoteTest is Test {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    bytes32 private constant LEGACY_POLICY_TYPEHASH =
        0xd8be789417c1a86fc9ed80b5538ea5966dabbcdee4b9bab1ed51980cb4f34b75;
    uint256 private constant LOCAL_SIGNER_PRIVATE_KEY = 0xA11CE;
    uint160 private constant MIN_SQRT_PRICE_X96 = 4295128740;
    uint160 private constant MAX_SQRT_PRICE_X96 = 1461446703485210103287273052203988822378723970341;

    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant HOOK = 0xd8aE178f4C5a17daF7f32b3648e0Ac42f50DC080;
    address private constant REGISTRY = 0xC57DE7312B9e90f29bAdE0d1944f6A73f5FC7365;
    address private constant VERIFIER = 0x9DF6c29bD323B61f83f1D3214041bf08f1267544;
    address private constant REGISTRATION_AUTHORIZATION = 0x415fde3E9a373f2c482a90dB069ccf4A2d215304;
    address private constant HOOK_AUTHORIZATION = 0x0Ebb15276f230130DD238fa1581d4379488111f5;
    address private constant ROUTER = 0xE57525678cbf6417F685727b77551316a3De3bba;
    bytes32 private constant EXPECTED_POOL_ID = 0x37d213cbaee2010a7fa4c5fd122001a301ea0364bf63bfee0116913f14477c78;

    IPoolManager private manager;
    ILegacyPolicyVerifier private verifier;
    ILegacyPolicyAuthorization private registrationAuthorization;
    ILegacyPolicyRegistry private registry;
    ILegacyRouter private router;
    PoolKey private poolKey;
    uint256 private wethInputAmount;
    uint256 private usdcInputAmount;

    function setUp() public {
        if (!vm.envOr("RUN_SEPOLIA_FORK_QUOTE", false)) {
            vm.skip(true);
        }
        require(block.chainid == SEPOLIA_CHAIN_ID, "run with a Sepolia fork");
        wethInputAmount = vm.envOr("SEPOLIA_FORK_WETH_INPUT", uint256(1e15));
        usdcInputAmount = vm.envOr("SEPOLIA_FORK_USDC_INPUT", uint256(100e6));
        require(wethInputAmount > 0 && wethInputAmount <= uint256(type(int256).max), "invalid WETH input");
        require(usdcInputAmount > 0 && usdcInputAmount <= uint256(type(int256).max), "invalid USDC input");

        manager = IPoolManager(POOL_MANAGER);
        verifier = ILegacyPolicyVerifier(VERIFIER);
        registrationAuthorization = ILegacyPolicyAuthorization(REGISTRATION_AUTHORIZATION);
        registry = ILegacyPolicyRegistry(REGISTRY);
        router = ILegacyRouter(ROUTER);

        require(POOL_MANAGER.code.length != 0, "PoolManager code missing");
        require(HOOK.code.length != 0, "hook code missing");
        require(REGISTRY.code.length != 0, "registry code missing");
        require(VERIFIER.code.length != 0, "verifier code missing");
        require(REGISTRATION_AUTHORIZATION.code.length != 0, "registration authorization code missing");
        require(HOOK_AUTHORIZATION.code.length != 0, "hook authorization code missing");
        require(ROUTER.code.length != 0, "router code missing");
        require(router.poolManager() == POOL_MANAGER, "router PoolManager mismatch");
        require(ILegacyHook(HOOK).poolManager() == POOL_MANAGER, "hook PoolManager mismatch");
        require(ILegacyHook(HOOK).authorization() == HOOK_AUTHORIZATION, "hook authorization mismatch");
        require(registrationAuthorization.registry() == REGISTRY, "registration registry mismatch");
        require(registrationAuthorization.verifier() == VERIFIER, "registration verifier mismatch");
        require(registry.authorizedRegistrar() == REGISTRATION_AUTHORIZATION, "registrar mismatch");
        require(registry.authorizedConsumer() == HOOK_AUTHORIZATION, "consumer mismatch");
        require(verifier.POLICY_TYPEHASH() == LEGACY_POLICY_TYPEHASH, "deployed verifier is not legacy schema");

        poolKey = PoolKey({
            currency0: Currency.wrap(USDC),
            currency1: Currency.wrap(WETH),
            fee: 3000,
            tickSpacing: 60,
            hooks: IHooks(HOOK)
        });
        require(PoolId.unwrap(poolKey.toId()) == EXPECTED_POOL_ID, "pool ID mismatch");

        uint256 slot0 = uint256(keccak256(abi.encodePacked(EXPECTED_POOL_ID, uint256(6))));
        bytes32 packedSlot0 = manager.extsload(bytes32(slot0));
        bytes32 packedLiquidity = manager.extsload(bytes32(slot0 + 3));
        require(uint160(uint256(packedSlot0)) != 0, "pool is uninitialized");
        require(uint128(uint256(packedLiquidity)) != 0, "pool has no active liquidity");

        address localSigner = vm.addr(LOCAL_SIGNER_PRIVATE_KEY);
        // Slot 3 is the deployed verifier's authorizedSigner; this mutation is fork-local only.
        vm.store(VERIFIER, bytes32(uint256(3)), bytes32(uint256(uint160(localSigner))));
        require(verifier.authorizedSigner() == localSigner, "fork-local signer override failed");
    }

    function test_QuoteOnly_LegacyDeployedRouterOnSepoliaFork() public {
        uint256 nonce = uint256(keccak256(abi.encode(block.number, address(this), wethInputAmount)));
        uint160 sqrtPriceLimitX96 = MAX_SQRT_PRICE_X96 - 1;

        ILegacyPolicyVerifier.Policy memory policy = ILegacyPolicyVerifier.Policy({
            poolId: EXPECTED_POOL_ID,
            trader: ROUTER,
            nonce: nonce,
            expiry: block.timestamp + 1 hours,
            maxLoss: 0,
            maxFee: 0,
            zeroForOne: false,
            amountSpecified: -int256(wethInputAmount),
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        bytes32 digest = verifier.hashPolicy(policy);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(LOCAL_SIGNER_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        registrationAuthorization.registerPolicy(policy, signature);

        deal(WETH, address(this), wethInputAmount);
        require(IERC20Minimal(WETH).approve(ROUTER, wethInputAmount), "WETH approval failed");

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: policy.zeroForOne,
            amountSpecified: policy.amountSpecified,
            sqrtPriceLimitX96: policy.sqrtPriceLimitX96
        });
        bytes memory hookData = abi.encode(policy, signature, uint256(0), uint256(0));

        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(address(this));
        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));
        int256 rawDelta = router.executeSwap(poolKey, params, hookData, address(this));
        int128 outputDelta = BalanceDelta.wrap(rawDelta).amount0();
        assertGt(outputDelta, 0, "PoolManager reports no positive USDC output");
        uint256 amountOut = uint256(uint128(outputDelta));
        uint256 wethSpent = wethBefore - IERC20Minimal(WETH).balanceOf(address(this));
        uint256 usdcReceived = IERC20Minimal(USDC).balanceOf(address(this)) - usdcBefore;

        assertGt(amountOut, 0, "quote returned no output");
        assertGt(wethSpent, 0, "router consumed no WETH");
        assertLe(wethSpent, wethInputAmount, "router spent more WETH than requested");
        assertEq(usdcReceived, amountOut, "router delta differs from received output");
        assertLt(amountOut, type(uint128).max, "quote output exceeds supported amount");

        console2.log("Fork block:", block.number);
        console2.log("Fork timestamp:", block.timestamp);
        console2.log("LOCAL FORK ONLY - WETH input (wei):", wethInputAmount);
        console2.log("LOCAL FORK ONLY - WETH actually spent (wei):", wethSpent);
        console2.log("LOCAL FORK ONLY - Exact input fully consumed:", wethSpent == wethInputAmount);
        console2.log("LOCAL FORK ONLY - USDC output (micro-USDC):", amountOut);
        console2.log("No Sepolia transaction was broadcast.");
    }

    function test_QuoteOnly_ReverseLegacyRouteOnSepoliaFork() public {
        uint256 nonce = uint256(keccak256(abi.encode(block.number, address(this), usdcInputAmount)));
        uint160 sqrtPriceLimitX96 = MIN_SQRT_PRICE_X96 + 1;

        ILegacyPolicyVerifier.Policy memory policy = ILegacyPolicyVerifier.Policy({
            poolId: EXPECTED_POOL_ID,
            trader: ROUTER,
            nonce: nonce,
            expiry: block.timestamp + 1 hours,
            maxLoss: 0,
            maxFee: 0,
            zeroForOne: true,
            amountSpecified: -int256(usdcInputAmount),
            sqrtPriceLimitX96: sqrtPriceLimitX96
        });

        bytes32 digest = verifier.hashPolicy(policy);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(LOCAL_SIGNER_PRIVATE_KEY, digest);
        bytes memory signature = abi.encodePacked(r, s, v);
        registrationAuthorization.registerPolicy(policy, signature);

        deal(USDC, address(this), usdcInputAmount);
        require(IERC20Minimal(USDC).approve(ROUTER, usdcInputAmount), "USDC approval failed");

        IPoolManager.SwapParams memory params = IPoolManager.SwapParams({
            zeroForOne: policy.zeroForOne,
            amountSpecified: policy.amountSpecified,
            sqrtPriceLimitX96: policy.sqrtPriceLimitX96
        });
        bytes memory hookData = abi.encode(policy, signature, uint256(0), uint256(0));

        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(address(this));
        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(address(this));
        int256 rawDelta = router.executeSwap(poolKey, params, hookData, address(this));
        int128 outputDelta = BalanceDelta.wrap(rawDelta).amount1();
        assertGt(outputDelta, 0, "PoolManager reports no positive WETH output");
        uint256 amountOut = uint256(uint128(outputDelta));
        uint256 usdcSpent = usdcBefore - IERC20Minimal(USDC).balanceOf(address(this));
        uint256 wethReceived = IERC20Minimal(WETH).balanceOf(address(this)) - wethBefore;

        assertGt(amountOut, 0, "reverse quote returned no output");
        assertGt(usdcSpent, 0, "router consumed no USDC");
        assertLe(usdcSpent, usdcInputAmount, "router spent more USDC than requested");
        assertEq(wethReceived, amountOut, "router delta differs from received output");
        assertLt(amountOut, type(uint128).max, "reverse quote output exceeds supported amount");

        console2.log("Fork block:", block.number);
        console2.log("Fork timestamp:", block.timestamp);
        console2.log("LOCAL FORK ONLY - USDC input (micro-USDC):", usdcInputAmount);
        console2.log("LOCAL FORK ONLY - USDC actually spent (micro-USDC):", usdcSpent);
        console2.log("LOCAL FORK ONLY - Exact input fully consumed:", usdcSpent == usdcInputAmount);
        console2.log("LOCAL FORK ONLY - WETH output (wei):", amountOut);
        console2.log("No Sepolia transaction was broadcast.");
    }
}
