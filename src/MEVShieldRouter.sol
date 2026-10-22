// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {CurrencyLibrary} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";

/// @title MEVShieldRouter
/// @notice Minimal execution router connecting an external user to Uniswap v4
///         while allowing the MEVShield hook to enforce a signed policy.
///
/// Execution path:
/// user
///   -> executeSwap()
///   -> PoolManager.unlock()
///   -> unlockCallback()
///   -> PoolManager.swap()
///   -> MEVShieldHook.beforeSwap()
///   -> settle/take
contract MEVShieldRouter is IUnlockCallback {
    using CurrencyLibrary for Currency;
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
        uint256 minAmountOut;
    }

    IPoolManager public immutable poolManager;

    error Unauthorized();
    error InvalidPayer();
    error InvalidRecipient();
    error InvalidCallback();
    error NativeCurrencyNotSupported();
    error InsufficientNativeValue();
    error UnexpectedNativeValue();
    error NativeRefundFailed();
    error InvalidMinimumOutput();
    error MinimumOutputNotMet(uint256 amountOut, uint256 minAmountOut);
    error InvalidPriceLimit();
    error PriceLimitTooFar(int24 currentTick, int24 limitTick, uint24 maxDistance);

    /// @dev Provisional execution bound: 600 ticks is approximately a 6.2%
    ///      price ratio. This is not a guarantee of execution price or profit.
    uint24 public constant MAX_PRICE_LIMIT_TICK_DISTANCE = 600;

    constructor(IPoolManager poolManager_) {
        poolManager = poolManager_;
    }

    /// @notice Execute a policy-protected swap through PoolManager.
    /// @param key Uniswap v4 pool key.
    /// @param params Swap parameters.
    /// @param hookData Policy + signature + risk attestation consumed by the hook.
    /// @param recipient Address receiving positive swap deltas.
    function executeSwap(
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        bytes calldata hookData,
        address recipient
    ) external payable returns (BalanceDelta delta) {
        if (recipient == address(0)) revert InvalidRecipient();

        bytes memory result = poolManager.unlock(abi.encode(msg.sender, recipient, key, params, hookData, msg.value));

        uint256 nativeSpent;
        (delta, nativeSpent) = abi.decode(result, (BalanceDelta, uint256));

        // ETH is accepted only when this swap actually owes native ETH to PoolManager.
        if (nativeSpent == 0 && msg.value != 0) revert UnexpectedNativeValue();

        // Return only the unused ETH from this call, never the router's old balance.
        uint256 refund = msg.value - nativeSpent;
        if (refund != 0) {
            (bool success,) = payable(msg.sender).call{value: refund}("");
            if (!success) revert NativeRefundFailed();
        }
    }

    /// @notice PoolManager callback invoked during unlock().
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) {
            revert Unauthorized();
        }

        (
            address payer,
            address recipient,
            PoolKey memory key,
            IPoolManager.SwapParams memory params,
            bytes memory hookData,
            uint256 nativeBudget
        ) = abi.decode(data, (address, address, PoolKey, IPoolManager.SwapParams, bytes, uint256));

        if (payer == address(0)) revert InvalidPayer();
        if (recipient == address(0)) revert InvalidRecipient();

        _validatePriceLimit(key, params);

        BalanceDelta delta = poolManager.swap(key, params, hookData);
        _enforceMinimumOutput(key, params, hookData, delta);

        uint256 nativeSpent = _settleAndTake(key, payer, recipient, delta, nativeBudget);

        return abi.encode(delta, nativeSpent);
    }

    /// @dev Reject invalid directional limits and limits farther than the
    ///      configured tick distance before entering PoolManager.swap().
    function _validatePriceLimit(PoolKey memory key, IPoolManager.SwapParams memory params) internal view {
        (uint160 currentSqrtPriceX96, int24 currentTick,,) =
            StateLibrary.getSlot0(poolManager, key.toId());

        if (
            currentSqrtPriceX96 < TickMath.MIN_SQRT_PRICE
                || currentSqrtPriceX96 >= TickMath.MAX_SQRT_PRICE
        ) revert InvalidPriceLimit();

        uint160 limit = params.sqrtPriceLimitX96;

        if (
            limit <= TickMath.MIN_SQRT_PRICE
                || limit >= TickMath.MAX_SQRT_PRICE
                || (params.zeroForOne && limit >= currentSqrtPriceX96)
                || (!params.zeroForOne && limit <= currentSqrtPriceX96)
        ) revert InvalidPriceLimit();

        int24 limitTick = TickMath.getTickAtSqrtPrice(limit);
        int256 distance = params.zeroForOne
            ? int256(currentTick) - int256(limitTick)
            : int256(limitTick) - int256(currentTick);

        if (distance <= 0) revert InvalidPriceLimit();
        if (uint256(distance) > MAX_PRICE_LIMIT_TICK_DISTANCE) {
            revert PriceLimitTooFar(currentTick, limitTick, MAX_PRICE_LIMIT_TICK_DISTANCE);
        }
    }

    function _enforceMinimumOutput(
        PoolKey memory key,
        IPoolManager.SwapParams memory params,
        bytes memory hookData,
        BalanceDelta delta
    ) internal pure {
        (Policy memory policy,,,) = abi.decode(hookData, (Policy, bytes, uint256, uint256));
        if (policy.minAmountOut == 0 || policy.poolId != PoolId.unwrap(key.toId())) {
            revert InvalidMinimumOutput();
        }
        if (
            policy.zeroForOne != params.zeroForOne || policy.amountSpecified != params.amountSpecified
                || policy.sqrtPriceLimitX96 != params.sqrtPriceLimitX96
        ) {
            revert InvalidMinimumOutput();
        }

        int128 outputDelta = params.zeroForOne ? delta.amount1() : delta.amount0();
        if (outputDelta <= 0) {
            revert MinimumOutputNotMet(0, policy.minAmountOut);
        }

        uint256 amountOut = uint256(uint128(outputDelta));
        if (amountOut < policy.minAmountOut) {
            revert MinimumOutputNotMet(amountOut, policy.minAmountOut);
        }
    }

    /// @dev Pay currencies owed to PoolManager and transfer currencies
    ///      owed to the user.
    function _settleAndTake(
        PoolKey memory key,
        address payer,
        address recipient,
        BalanceDelta delta,
        uint256 nativeBudget
    ) internal returns (uint256 nativeSpent) {
        Currency currency0 = key.currency0;
        Currency currency1 = key.currency1;

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        // Negative delta = router owes PoolManager.
        if (amount0 < 0) {
            nativeSpent += _settle(currency0, payer, uint256(uint128(-amount0)), nativeBudget);
        }

        if (amount1 < 0) {
            nativeSpent += _settle(currency1, payer, uint256(uint128(-amount1)), nativeBudget);
        }

        // Positive delta = PoolManager owes recipient.
        if (amount0 > 0) {
            poolManager.take(currency0, recipient, uint256(uint128(amount0)));
        }

        if (amount1 > 0) {
            poolManager.take(currency1, recipient, uint256(uint128(amount1)));
        }
    }

    function _settle(Currency currency, address payer, uint256 amount, uint256 nativeBudget)
        internal
        returns (uint256 nativeSpent)
    {
        if (currency.isAddressZero()) {
            // msg.value belongs to this executeSwap call; never spend old router ETH.
            if (amount > nativeBudget) revert InsufficientNativeValue();
            poolManager.settle{value: amount}();
            return amount;
        }

        poolManager.sync(currency);

        if (payer == address(this)) {
            currency.transfer(address(poolManager), amount);
        } else {
            // The user must approve this router to spend the input token.
            bool success = _transferFrom(currency, payer, address(poolManager), amount);

            if (!success) revert InvalidPayer();
        }

        poolManager.settle();
    }

    function _transferFrom(Currency currency, address from, address to, uint256 amount)
        internal
        returns (bool success)
    {
        address token = Currency.unwrap(currency);

        bytes memory returndata;

        (success, returndata) = token.call(
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, to, amount)
        );

        if (!success) {
            return false;
        }

        if (returndata.length == 0) {
            return true;
        }

        if (returndata.length >= 32) {
            return abi.decode(returndata, (bool));
        }

        return false;
    }

    receive() external payable {}
}
