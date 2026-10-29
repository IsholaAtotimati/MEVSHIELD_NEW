// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

// Fork-local demonstration. Nothing here is broadcast.
//
//   RUN_SEPOLIA_FORK_SANDWICH=true forge test --match-path test/SepoliaForkSandwich.t.sol \
//     --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
//
// Optional pin: SEPOLIA_FORK_BLOCK_NUMBER plus --fork-block-number.
// Without the env flag the test is skipped, so CI does not need an RPC.
//
// What is forked: PoolManager, the USDC/WETH pool, and its current price and
// liquidity. Addresses match test/SepoliaForkDeploymentVerification.t.sol.
//
// What this file deploys, from this repository, into the fork only:
// PolicyRegistry, PolicyVerifier, PolicyAuthorization, and MEVShieldRouter.
// The live router 0x6332…150D is not called.
//
// The live hook 0xd15E…0080 has BEFORE_SWAP_FLAG set, so PoolManager calls
// beforeSwap on every swap. That deployed hook accepts only the live signer
// 0x016B…A815. This test does not have that key and does not impersonate it.
// It etches this repository's MEVShieldHook, authorized by a fork-local signer
// (private key 0xA11CE), onto the hook address. The pattern is the same etch
// used by test/SepoliaForkV2Router.t.sol. The price movement is a real swap
// against the forked pool.
//
// The check under test is MEVShieldRouter._enforceMinimumOutput (and
// _validatePriceLimit if the post-attack price makes the limit illegal).
// MEVShieldHook.beforeSwap does not measure output, loss, or the attacker
// swap. See src/MEVShieldHook.sol beforeSwap. A protected revert rolls the
// whole transaction back, including any nonce PolicyAuthorization.authorize
// consumed inside that transaction.

import {Test} from "forge-std/Test.sol";
import {console} from "forge-std/console.sol";
import {IERC20Minimal} from "v4-core/interfaces/external/IERC20Minimal.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {BalanceDelta, BalanceDeltaLibrary} from "v4-core/types/BalanceDelta.sol";
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

contract SepoliaForkSandwichTest is Test {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    uint256 private constant SEPOLIA_CHAIN_ID = 11155111;
    uint256 private constant LOCAL_SIGNER_PRIVATE_KEY = 0xA11CE;
    /// Ten ticks is enough to change a victim fill on this pool and stays
    /// inside the ~120-tick position that was active when this test was written.
    int24 private constant ATTACKER_TICK_DISTANCE = 10;
    /// Victim limit sits further through the attack so it is still legal after
    /// the attacker stops, and still inside the router's 600-tick cap.
    int24 private constant VICTIM_LIMIT_DISTANCE = 40;
    /// 0.02 USDC. Small relative to the ~75 USDC virtual reserve, so the quote
    /// itself does not reach the 40-tick limit.
    uint256 private constant VICTIM_USDC_IN = 20_000;
    /// More than enough to reach the attacker price limit. The limit stops the
    /// swap, so this does not drain the position.
    uint256 private constant ATTACKER_USDC_IN = 2_000_000;

    address private constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address private constant USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;
    address private constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address private constant HOOK = 0xd15E4fDD391a68C2F1C385d1a819117a3aD40080;
    address private constant LIVE_ROUTER = 0x633282608B2fc66cD7572f5eF58e804063aa150D;
    address private constant LIVE_AUTHORIZED_SIGNER = 0x016B78a30CE176EF0B90c122e8677e13aAB2A815;
    bytes32 private constant EXPECTED_POOL_ID = 0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602;

    IPoolManager private manager;
    PolicyRegistry private registry;
    PolicyVerifier private verifier;
    PolicyAuthorization private authorization;
    MEVShieldRouter private router;
    PoolKey private poolKey;
    address private signer;
    address private attacker;
    address private victim;
    uint256 private nonce;

    function setUp() public {
        if (!vm.envOr("RUN_SEPOLIA_FORK_SANDWICH", false)) {
            vm.skip(true);
        }

        uint256 pinnedBlock = vm.envOr("SEPOLIA_FORK_BLOCK_NUMBER", uint256(0));
        if (pinnedBlock != 0) {
            require(block.number == pinnedBlock, "wrong fork block");
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

        (uint160 sqrtPriceX96,,,) = StateLibrary.getSlot0(manager, poolKey.toId());
        require(sqrtPriceX96 != 0, "pool is uninitialized");
        require(StateLibrary.getLiquidity(manager, poolKey.toId()) != 0, "pool has no active liquidity");

        registry = new PolicyRegistry();
        registry.setAuthorizedRegistrar(address(this));
        verifier = new PolicyVerifier();
        authorization = new PolicyAuthorization(address(registry), address(verifier));
        router = new MEVShieldRouter(manager);
        require(address(router) != LIVE_ROUTER, "fork test must deploy this repo's router");
        require(router.MAX_PRICE_LIMIT_TICK_DISTANCE() == 600, "deployed router is not this source");
        require(address(router.poolManager()) == POOL_MANAGER, "fork router PoolManager mismatch");

        signer = vm.addr(LOCAL_SIGNER_PRIVATE_KEY);
        require(signer != LIVE_AUTHORIZED_SIGNER, "refusing to use the live Sepolia signer");
        verifier.setAuthorizedSigner(signer);
        registry.setAuthorizedConsumer(address(authorization));

        MEVShieldHook implementation = new MEVShieldHook(manager, authorization);
        vm.etch(HOOK, address(implementation).code);
        MEVShieldHook hook = MEVShieldHook(HOOK);
        authorization.setAuthorizedHook(address(hook));
        registry.setAuthorizedRegistrar(address(authorization));
        require(address(hook.poolManager()) == POOL_MANAGER, "etched hook PoolManager mismatch");
        require(address(hook.authorization()) == address(authorization), "etched hook authorization mismatch");

        attacker = makeAddr("fork-attacker");
        victim = makeAddr("fork-victim");
        nonce = 1;
    }

    function test_forkSandwich_unprotectedReceivesLess_protectedReverts() public {
        (, int24 tickBefore,,) = StateLibrary.getSlot0(manager, poolKey.toId());
        uint128 liquidityBefore = StateLibrary.getLiquidity(manager, poolKey.toId());
        uint160 victimLimit = TickMath.getSqrtPriceAtTick(tickBefore - VICTIM_LIMIT_DISTANCE);
        uint160 attackerLimit = TickMath.getSqrtPriceAtTick(tickBefore - ATTACKER_TICK_DISTANCE);

        uint256 clean = vm.snapshotState();
        (uint256 quotedOut,) = _swap(victim, VICTIM_USDC_IN, victimLimit, 1);
        assertGt(quotedOut, 1, "pre-attack quote was too small");
        require(vm.revertToState(clean), "could not restore the pool after the quote");

        _swap(attacker, ATTACKER_USDC_IN, attackerLimit, 1);
        (, int24 tickAfter,,) = StateLibrary.getSlot0(manager, poolKey.toId());
        uint128 liquidityAfter = StateLibrary.getLiquidity(manager, poolKey.toId());
        assertLt(tickAfter, tickBefore, "attacker did not move the tick down");
        assertGt(tickAfter, tickBefore - VICTIM_LIMIT_DISTANCE, "attacker reached the victim price limit");
        assertGt(uint256(liquidityAfter), 0, "attacker removed active liquidity");

        uint256 afterAttack = vm.snapshotState();
        (uint256 unprotectedOut, uint256 looseNonce) = _swap(victim, VICTIM_USDC_IN, victimLimit, 1);
        assertLt(unprotectedOut, quotedOut, "unprotected victim did not receive less than the pre-attack quote");
        assertTrue(registry.isConsumed(address(router), looseNonce), "loose swap should consume its policy");
        require(vm.revertToState(afterAttack), "could not restore the post-attacker pool");

        MEVShieldHook.Policy memory protectedPolicy =
            _registerPolicy(true, -int256(VICTIM_USDC_IN), victimLimit, quotedOut);
        assertFalse(registry.isConsumed(address(router), protectedPolicy.nonce), "protected nonce consumed before the swap");

        deal(USDC, victim, VICTIM_USDC_IN);
        uint256 usdcBefore = IERC20Minimal(USDC).balanceOf(victim);
        uint256 wethBefore = IERC20Minimal(WETH).balanceOf(victim);
        vm.startPrank(victim);
        require(IERC20Minimal(USDC).approve(address(router), VICTIM_USDC_IN), "victim USDC approval failed");
        (bool ok, bytes memory reason) = address(router).call(
            abi.encodeCall(
                router.executeSwap,
                (
                    poolKey,
                    IPoolManager.SwapParams({
                        zeroForOne: true,
                        amountSpecified: protectedPolicy.amountSpecified,
                        sqrtPriceLimitX96: protectedPolicy.sqrtPriceLimitX96
                    }),
                    abi.encode(protectedPolicy, _signature(protectedPolicy), uint256(0), uint256(0)),
                    victim
                )
            )
        );
        vm.stopPrank();

        assertFalse(ok, "protected swap succeeded after the attacker moved the pool");
        string memory revertReason = "unrecognized";
        if (_revertDataContains(reason, MEVShieldRouter.MinimumOutputNotMet.selector)) {
            revertReason = "MinimumOutputNotMet";
        } else if (_revertDataContains(reason, MEVShieldRouter.InvalidPriceLimit.selector)) {
            revertReason = "InvalidPriceLimit";
        } else {
            console.log("unrecognized revert data:");
            console.logBytes(reason);
        }

        console.log("fork block", block.number);
        console.log("tick before", int256(tickBefore));
        console.log("tick after attacker", int256(tickAfter));
        console.log("quoted amount out before attack", quotedOut);
        console.log("unprotected amount out", unprotectedOut);
        console.log("protected revert reason", revertReason);
        console.log("active liquidity before", uint256(liquidityBefore));
        console.log("active liquidity after attacker", uint256(liquidityAfter));

        assertTrue(
            keccak256(bytes(revertReason)) == keccak256("MinimumOutputNotMet")
                || keccak256(bytes(revertReason)) == keccak256("InvalidPriceLimit"),
            "protected swap did not revert with MinimumOutputNotMet or InvalidPriceLimit"
        );
        assertEq(IERC20Minimal(USDC).balanceOf(victim), usdcBefore, "reverted swap spent victim USDC");
        assertEq(IERC20Minimal(WETH).balanceOf(victim), wethBefore, "reverted swap paid the victim WETH");
        assertTrue(registry.isRegistered(address(router), protectedPolicy.nonce), "protected policy registration was lost");
        assertFalse(
            registry.isConsumed(address(router), protectedPolicy.nonce),
            "reverted swap left the policy nonce consumed"
        );
    }

    /// @dev Sells USDC (token0) for WETH. Tokens are funded with deal, not a faucet.
    function _swap(address payer, uint256 amountIn, uint160 sqrtPriceLimitX96, uint256 minAmountOut)
        private
        returns (uint256 amountOut, uint256 usedNonce)
    {
        deal(USDC, payer, amountIn);
        MEVShieldHook.Policy memory policy = _registerPolicy(true, -int256(amountIn), sqrtPriceLimitX96, minAmountOut);
        usedNonce = policy.nonce;

        vm.startPrank(payer);
        require(IERC20Minimal(USDC).approve(address(router), amountIn), "USDC approval failed");
        BalanceDelta delta = router.executeSwap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: policy.amountSpecified,
                sqrtPriceLimitX96: policy.sqrtPriceLimitX96
            }),
            abi.encode(policy, _signature(policy), uint256(0), uint256(0)),
            payer
        );
        vm.stopPrank();

        int128 outputDelta = delta.amount1();
        require(outputDelta > 0, "swap output was not positive");
        amountOut = uint256(uint128(outputDelta));
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
        authorization.registerPolicy(_verifierPolicy(policy), _signature(policy));
    }

    function _signature(MEVShieldHook.Policy memory policy) private view returns (bytes memory) {
        bytes32 digest = verifier.hashPolicy(_verifierPolicy(policy));
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

    function _revertDataContains(bytes memory reason, bytes4 selector) private pure returns (bool) {
        if (reason.length < 4) {
            return false;
        }
        for (uint256 i = 0; i <= reason.length - 4; ++i) {
            bytes4 found;
            assembly {
                found := mload(add(add(reason, 0x20), i))
            }
            if (found == selector) {
                return true;
            }
        }
        return false;
    }
}
