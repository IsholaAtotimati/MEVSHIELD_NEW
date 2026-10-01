// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";

import {PoolManager} from "v4-core/PoolManager.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";

import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

import {MockERC20} from "solmate/src/test/utils/mocks/MockERC20.sol";

import {PolicyRegistry} from "../src/PolicyRegistry.sol";
import {PolicyVerifier} from "../src/PolicyVerifier.sol";
import {PolicyAuthorization} from "../src/PolicyAuthorization.sol";
import {MEVShieldHook} from "../src/MEVShieldHook.sol";

contract RunProtectedSwap is Script {
    using PoolIdLibrary for PoolKey;

    uint256 internal constant DEFAULT_DEPLOYER_KEY = 0x4f3edf983ac636a65a842ce7c78d9aa706d3b113bce036f2f8b6f4e0f6f4a7c;

    uint256 internal constant SIGNER_PRIVATE_KEY = 0xA11CE;

    uint24 internal constant POOL_FEE = 3000;
    int24 internal constant TICK_SPACING = 60;

    uint160 internal constant MIN_PRICE_LIMIT = TickMath.MIN_SQRT_PRICE + 1;

    uint256 internal constant LIQUIDITY = 1e18;
    uint256 internal constant SWAP_AMOUNT = 100e6;

    struct Deployment {
        address manager;
        address registry;
        address verifier;
        address authorization;
        address hook;
    }

    struct PolicyInput {
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

    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", DEFAULT_DEPLOYER_KEY);

        address deployer = vm.addr(deployerKey);
        address signer = vm.addr(SIGNER_PRIVATE_KEY);

        Deployment memory d = Deployment({
            manager: vm.envAddress("POOL_MANAGER"),
            registry: vm.envAddress("POLICY_REGISTRY"),
            verifier: vm.envAddress("POLICY_VERIFIER"),
            authorization: vm.envAddress("POLICY_AUTHORIZATION"),
            hook: vm.envAddress("MEVSHIELD_HOOK")
        });

        console2.log("");
        console2.log("========================================");
        console2.log("     MEVShield REAL ANVIL SWAP");
        console2.log("========================================");
        console2.log("Chain ID:", block.chainid);
        console2.log("Deployer:", deployer);
        console2.log("Signer:", signer);
        console2.log("PoolManager:", d.manager);
        console2.log("PolicyRegistry:", d.registry);
        console2.log("PolicyVerifier:", d.verifier);
        console2.log("PolicyAuthorization:", d.authorization);
        console2.log("MEVShieldHook:", d.hook);

        PoolManager manager = PoolManager(d.manager);
        PolicyRegistry registry = PolicyRegistry(d.registry);
        PolicyVerifier verifier = PolicyVerifier(d.verifier);

        require(verifier.authorizedSigner() == signer, "authorized signer mismatch");

        require(registry.authorizedRegistrar() == deployer, "authorized registrar mismatch");

        require(registry.authorizedConsumer() == d.authorization, "authorized consumer mismatch");

        vm.startBroadcast(deployerKey);

        // ------------------------------------------------------------
        // 1. Deploy the real v4 test routers.
        // ------------------------------------------------------------

        PoolSwapTest swapRouter = new PoolSwapTest(manager);
        PoolModifyLiquidityTest liquidityRouter = new PoolModifyLiquidityTest(manager);

        console2.log("");
        console2.log("PoolSwapTest:", address(swapRouter));
        console2.log("PoolModifyLiquidityTest:", address(liquidityRouter));

        // ------------------------------------------------------------
        // 2. Deploy two real ERC20 test currencies.
        // ------------------------------------------------------------

        MockERC20 tokenA = new MockERC20("MEVShield Token A", "MSA", 18);

        MockERC20 tokenB = new MockERC20("MEVShield Token B", "MSB", 18);

        // Mint enough tokens to the EOA executing the script.
        tokenA.mint(deployer, 2 ** 120);
        tokenB.mint(deployer, 2 ** 120);

        Currency currencyA = Currency.wrap(address(tokenA));
        Currency currencyB = Currency.wrap(address(tokenB));

        Currency currency0;
        Currency currency1;

        if (address(tokenA) < address(tokenB)) {
            currency0 = currencyA;
            currency1 = currencyB;
        } else {
            currency0 = currencyB;
            currency1 = currencyA;
        }

        console2.log("");
        console2.log("Token0:", Currency.unwrap(currency0));
        console2.log("Token1:", Currency.unwrap(currency1));

        // ------------------------------------------------------------
        // 3. Approve the v4 helper routers.
        // ------------------------------------------------------------

        tokenA.approve(address(swapRouter), type(uint256).max);
        tokenB.approve(address(swapRouter), type(uint256).max);

        tokenA.approve(address(liquidityRouter), type(uint256).max);
        tokenB.approve(address(liquidityRouter), type(uint256).max);

        // ------------------------------------------------------------
        // 4. Create the PoolKey using the already deployed hook.
        // ------------------------------------------------------------

        PoolKey memory key = PoolKey({
            currency0: currency0, currency1: currency1, fee: POOL_FEE, tickSpacing: TICK_SPACING, hooks: IHooks(d.hook)
        });

        bytes32 poolId = PoolId.unwrap(key.toId());

        console2.log("");
        console2.log("PoolId:");
        console2.logBytes32(poolId);

        // ------------------------------------------------------------
        // 5. Initialize the actual PoolManager pool.
        // ------------------------------------------------------------

        manager.initialize(key, 79228162514264337593543950336);

        console2.log("Pool initialized.");

        // ------------------------------------------------------------
        // 6. Add real liquidity through PoolModifyLiquidityTest.
        // ------------------------------------------------------------

        IPoolManager.ModifyLiquidityParams memory liquidityParams = IPoolManager.ModifyLiquidityParams({
            tickLower: -120, tickUpper: 120, liquidityDelta: int256(LIQUIDITY), salt: bytes32(0)
        });

        liquidityRouter.modifyLiquidity(key, liquidityParams, bytes(""));

        console2.log("Liquidity added.");

        // ------------------------------------------------------------
        // 7. Build the exact policy expected by the hook.
        //
        // IMPORTANT:
        // The trader is PoolSwapTest, because PoolManager invokes the
        // hook with PoolSwapTest as the swap sender.
        // ------------------------------------------------------------

        uint256 nonce = 1;
        uint256 expiry = block.timestamp + 1 days;

        PolicyInput memory policy = PolicyInput({
            poolId: poolId,
            trader: address(swapRouter),
            nonce: nonce,
            expiry: expiry,
            maxLoss: 100e6,
            maxFee: 5000,
            zeroForOne: true,
            amountSpecified: -int256(SWAP_AMOUNT),
            sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });

        console2.log("");
        console2.log("Policy trader:", policy.trader);
        console2.log("Policy nonce:", policy.nonce);
        console2.log("Policy expiry:", policy.expiry);
        console2.log("Policy maxLoss:", policy.maxLoss);
        console2.log("Policy maxFee:", policy.maxFee);

        // ------------------------------------------------------------
        // 8. Register the policy through the authorized registrar.
        // ------------------------------------------------------------

        bytes32 policyId = registry.registerPolicy(
            policy.poolId, policy.trader, policy.nonce, policy.expiry, policy.maxLoss, policy.maxFee
        );

        console2.log("");
        console2.log("Policy registered:");
        console2.logBytes32(policyId);

        require(registry.isRegistered(policy.trader, policy.nonce), "policy was not registered");

        // ------------------------------------------------------------
        // 9. Build the exact EIP-712 PolicyVerifier struct.
        // ------------------------------------------------------------

        PolicyVerifier.Policy memory verifierPolicy = PolicyVerifier.Policy({
            poolId: policy.poolId,
            trader: policy.trader,
            nonce: policy.nonce,
            expiry: policy.expiry,
            maxLoss: policy.maxLoss,
            maxFee: policy.maxFee,
            zeroForOne: policy.zeroForOne,
            amountSpecified: policy.amountSpecified,
            sqrtPriceLimitX96: policy.sqrtPriceLimitX96
        });

        bytes32 digest = verifier.hashPolicy(verifierPolicy);

        // ------------------------------------------------------------
        // 10. Sign the exact digest with the authorized signer.
        // ------------------------------------------------------------

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PRIVATE_KEY, digest);

        bytes memory signature = abi.encodePacked(r, s, v);

        address recovered = verifier.recoverSigner(verifierPolicy, signature);

        console2.log("");
        console2.log("EIP-712 digest:");
        console2.logBytes32(digest);
        console2.log("Recovered signer:", recovered);

        require(recovered == signer, "EIP712 signer mismatch");

        // ------------------------------------------------------------
        // 11. Build hookData.
        //
        // actualLoss <= maxLoss
        // actualFee <= maxFee
        // ------------------------------------------------------------

        uint256 actualLoss = 0;
        uint256 actualFee = 0;

        bytes memory hookData = abi.encode(policy, signature, actualLoss, actualFee);

        // ------------------------------------------------------------
        // 12. Execute the REAL PoolManager swap.
        // ------------------------------------------------------------

        IPoolManager.SwapParams memory swapParams = IPoolManager.SwapParams({
            zeroForOne: true, amountSpecified: -int256(SWAP_AMOUNT), sqrtPriceLimitX96: MIN_PRICE_LIMIT
        });

        console2.log("");
        console2.log("Executing protected swap...");
        console2.log("Amount specified:", SWAP_AMOUNT);

        swapRouter.swap(
            key, swapParams, PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}), hookData
        );

        console2.log("Protected swap succeeded.");

        vm.stopBroadcast();

        // ------------------------------------------------------------
        // 13. Verify one-time policy consumption.
        // ------------------------------------------------------------

        bool consumed = registry.isConsumed(policy.trader, policy.nonce);

        console2.log("");
        console2.log("Policy consumed:", consumed);

        require(consumed, "policy was NOT consumed");

        console2.log("");
        console2.log("========================================");
        console2.log("       PROTECTED SWAP: SUCCESS");
        console2.log("========================================");
        console2.log("");
        console2.log("PoolId:");
        console2.logBytes32(poolId);
        console2.log("Trader:", address(swapRouter));
        console2.log("Nonce:", nonce);
        console2.log("Policy consumed:", consumed);
    }
}
