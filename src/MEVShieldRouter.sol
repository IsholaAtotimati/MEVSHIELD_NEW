// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {CurrencyLibrary} from "v4-core/types/Currency.sol";

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

    IPoolManager public immutable poolManager;

    error Unauthorized();
    error InvalidPayer();
    error InvalidRecipient();
    error InvalidCallback();
    error NativeCurrencyNotSupported();

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

        bytes memory result = poolManager.unlock(
            abi.encode(
                msg.sender,
                recipient,
                key,
                params,
                hookData
            )
        );

        delta = abi.decode(result, (BalanceDelta));
    }

    /// @notice PoolManager callback invoked during unlock().
    function unlockCallback(bytes calldata data)
        external
        override
        returns (bytes memory)
    {
        if (msg.sender != address(poolManager)) {
            revert Unauthorized();
        }

        (
            address payer,
            address recipient,
            PoolKey memory key,
            IPoolManager.SwapParams memory params,
            bytes memory hookData
        ) = abi.decode(
            data,
            (
                address,
                address,
                PoolKey,
                IPoolManager.SwapParams,
                bytes
            )
        );

        if (payer == address(0)) revert InvalidPayer();
        if (recipient == address(0)) revert InvalidRecipient();

        BalanceDelta delta = poolManager.swap(
            key,
            params,
            hookData
        );

        _settleAndTake(
            key,
            payer,
            recipient,
            delta
        );

        return abi.encode(delta);
    }

    /// @dev Pay currencies owed to PoolManager and transfer currencies
    ///      owed to the user.
    function _settleAndTake(
        PoolKey memory key,
        address payer,
        address recipient,
        BalanceDelta delta
    ) internal {
        Currency currency0 = key.currency0;
        Currency currency1 = key.currency1;

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        // Negative delta = router owes PoolManager.
        if (amount0 < 0) {
            _settle(
                currency0,
                payer,
                uint256(uint128(-amount0))
            );
        }

        if (amount1 < 0) {
            _settle(
                currency1,
                payer,
                uint256(uint128(-amount1))
            );
        }

        // Positive delta = PoolManager owes recipient.
        if (amount0 > 0) {
            poolManager.take(
                currency0,
                recipient,
                uint256(uint128(amount0))
            );
        }

        if (amount1 > 0) {
            poolManager.take(
                currency1,
                recipient,
                uint256(uint128(amount1))
            );
        }
    }

    function _settle(
        Currency currency,
        address payer,
        uint256 amount
    ) internal {
        if (currency.isAddressZero()) {
            poolManager.settle{value: amount}();
            return;
        }

        poolManager.sync(currency);

        if (payer == address(this)) {
            currency.transfer(address(poolManager), amount);
        } else {
            // The user must approve this router to spend the input token.
            bool success = _transferFrom(
                currency,
                payer,
                address(poolManager),
                amount
            );

            if (!success) revert InvalidPayer();
        }

        poolManager.settle();
    }

    function _transferFrom(
        Currency currency,
        address from,
        address to,
        uint256 amount
    ) internal returns (bool success) {
        address token = Currency.unwrap(currency);

        bytes memory returndata;

        (success, returndata) = token.call(
            abi.encodeWithSelector(
                bytes4(keccak256("transferFrom(address,address,uint256)")),
                from,
                to,
                amount
            )
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
