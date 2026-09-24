// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";

contract PolicyVerifier is EIP712 {
    struct Policy {
        bytes32 poolId;
        address trader;
        uint256 nonce;
        uint256 expiry;
        uint256 maxLoss;
        uint256 maxFee;
    }

    bytes32 public constant POLICY_TYPEHASH =
        keccak256("Policy(bytes32 poolId,address trader,uint256 nonce,uint256 expiry,uint256 maxLoss,uint256 maxFee)");

    address public owner;
    address public authorizedSigner;

    error NotOwner();
    error InvalidSigner();
    error UnauthorizedSigner();
    error InvalidSignature();

    event AuthorizedSignerUpdated(address indexed oldSigner, address indexed newSigner);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        _;
    }

    constructor() EIP712("MEVShield", "1") {
        owner = msg.sender;
    }

    function setAuthorizedSigner(address signer) external onlyOwner {
        if (signer == address(0)) {
            revert InvalidSigner();
        }

        address oldSigner = authorizedSigner;
        authorizedSigner = signer;

        emit AuthorizedSignerUpdated(oldSigner, signer);
    }

    function hashPolicy(Policy calldata policy) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                POLICY_TYPEHASH,
                policy.poolId,
                policy.trader,
                policy.nonce,
                policy.expiry,
                policy.maxLoss,
                policy.maxFee
            )
        );

        return _hashTypedDataV4(structHash);
    }

    function recoverSigner(Policy calldata policy, bytes calldata signature) public view returns (address) {
        bytes32 digest = hashPolicy(policy);

        return ECDSA.recover(digest, signature);
    }

    function verifyPolicy(Policy calldata policy, bytes calldata signature) external view returns (bool) {
        if (authorizedSigner == address(0)) {
            revert InvalidSigner();
        }

        address signer = recoverSigner(policy, signature);

        if (signer != authorizedSigner) {
            revert UnauthorizedSigner();
        }

        return true;
    }
}
