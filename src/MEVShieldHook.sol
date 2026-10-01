// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta, BeforeSwapDeltaLibrary} from "v4-core/types/BeforeSwapDelta.sol";
import {PolicyAuthorization} from "./PolicyAuthorization.sol";
import {PolicyVerifier} from "./PolicyVerifier.sol";

/// @title MEVShieldHook
/// @notice MVP Uniswap v4 hook enforcing signed swap policies.
///
/// Week 3:
/// - beforeSwap() integration
/// - pool binding
/// - trader binding
/// - expiry enforcement
/// - maxLoss / maxFee enforcement
///
/// Risk calculation remains off-chain.
/// This contract is the on-chain enforcement boundary.
contract MEVShieldHook is IHooks {
    IPoolManager public immutable poolManager;
    PolicyAuthorization public immutable authorization;

    error Unauthorized();

    modifier onlyPoolManager() {
        if (msg.sender != address(poolManager)) {
            revert Unauthorized();
        }
        _;
    }

    using PoolIdLibrary for PoolKey;

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

    error HookNotImplemented();
    error InvalidPool();
    error InvalidTrader();
    error PolicyExpired();
    error PoolMismatch();
    error TraderMismatch();
    error SwapMismatch();
    error MaxLossExceeded();
    error MaxFeeExceeded();

    event SwapPolicyEnforced(
        bytes32 indexed poolId, address indexed trader, uint256 nonce, uint256 maxLoss, uint256 maxFee
    );

    /// @notice Uniswap v4 beforeSwap execution boundary.
    ///
    /// Policy is passed through hookData for the MVP.
    constructor(IPoolManager poolManager_, PolicyAuthorization authorization_) {
        poolManager = poolManager_;
        authorization = authorization_;
    }

    function beforeSwap(
        address sender,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData
    ) external override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
        if (sender == address(0)) {
            revert InvalidTrader();
        }

        bytes32 actualPoolId = PoolId.unwrap(key.toId());

        if (actualPoolId == bytes32(0)) {
            revert InvalidPool();
        }

        (Policy memory policy, bytes memory signature, uint256 actualLoss, uint256 actualFee) =
            abi.decode(hookData, (Policy, bytes, uint256, uint256));

        if (policy.poolId != actualPoolId) {
            revert PoolMismatch();
        }

        if (policy.trader != sender) {
            revert TraderMismatch();
        }

        if (
            policy.zeroForOne != params.zeroForOne || policy.amountSpecified != params.amountSpecified
                || policy.sqrtPriceLimitX96 != params.sqrtPriceLimitX96
        ) {
            revert SwapMismatch();
        }

        if (block.timestamp >= policy.expiry) {
            revert PolicyExpired();
        }

        if (actualLoss > policy.maxLoss) {
            revert MaxLossExceeded();
        }

        if (actualFee > policy.maxFee) {
            revert MaxFeeExceeded();
        }

        // Cryptographically authorize the policy and consume it.
        //
        // PolicyAuthorization enforces:
        // 1. valid EIP-712 signature
        // 2. authorized signer
        // 3. exact match with registered policy
        // 4. policy not expired
        // 5. policy nonce not already consumed
        //
        // If any condition fails, the entire beforeSwap transaction
        // reverts and no policy state transition occurs.
        authorization.authorize(
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
            }),
            signature
        );

        emit SwapPolicyEnforced(actualPoolId, sender, policy.nonce, policy.maxLoss, policy.maxFee);

        return (this.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, 0);
    }

    function beforeInitialize(address, PoolKey calldata, uint160) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure override returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function afterSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, BalanceDelta, bytes calldata)
        external
        pure
        override
        returns (bytes4, int128)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
