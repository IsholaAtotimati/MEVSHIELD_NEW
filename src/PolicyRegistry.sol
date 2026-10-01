// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

contract PolicyRegistry {
    struct Policy {
        bytes32 poolId;
        address trader;
        uint256 nonce;
        uint256 expiry;
        uint256 maxLoss;
        uint256 maxFee;
    }

    address public owner;
    address public authorizedConsumer;
    address public authorizedRegistrar;

    mapping(bytes32 => Policy) private policies;

    mapping(address => mapping(uint256 => bool)) private registeredNonces;

    mapping(address => mapping(uint256 => bool)) public consumedNonces;

    error Unauthorized();
    error InvalidConsumer();
    error InvalidRegistrar();
    error PolicyAlreadyConsumed();
    error PolicyNotFound();
    error PolicyExpired();
    error InvalidPool();
    error InvalidTrader();
    error InvalidExpiry();
    error NonceAlreadyRegistered();

    event PolicyRegistered(
        bytes32 indexed policyId,
        bytes32 indexed poolId,
        address indexed trader,
        uint256 nonce,
        uint256 expiry,
        uint256 maxLoss,
        uint256 maxFee
    );

    event AuthorizedConsumerUpdated(address indexed oldConsumer, address indexed newConsumer);
    event AuthorizedRegistrarUpdated(address indexed oldRegistrar, address indexed newRegistrar);

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyAuthorizedConsumer() {
        if (msg.sender != authorizedConsumer) {
            revert Unauthorized();
        }
        _;
    }

    modifier onlyAuthorizedRegistrar() {
        if (msg.sender != authorizedRegistrar) {
            revert Unauthorized();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setAuthorizedConsumer(address consumer) external onlyOwner {
        if (consumer == address(0)) {
            revert InvalidConsumer();
        }

        address oldConsumer = authorizedConsumer;

        authorizedConsumer = consumer;

        emit AuthorizedConsumerUpdated(oldConsumer, consumer);
    }

    function setAuthorizedRegistrar(address registrar) external onlyOwner {
        if (registrar == address(0)) revert InvalidRegistrar();

        address oldRegistrar = authorizedRegistrar;
        authorizedRegistrar = registrar;

        emit AuthorizedRegistrarUpdated(oldRegistrar, registrar);
    }

    function registerPolicy(
        bytes32 poolId,
        address trader,
        uint256 nonce,
        uint256 expiry,
        uint256 maxLoss,
        uint256 maxFee
    ) external onlyAuthorizedRegistrar returns (bytes32 policyId) {
        if (poolId == bytes32(0)) {
            revert InvalidPool();
        }

        if (trader == address(0)) {
            revert InvalidTrader();
        }

        if (expiry <= block.timestamp) {
            revert InvalidExpiry();
        }

        if (registeredNonces[trader][nonce]) {
            revert NonceAlreadyRegistered();
        }

        policyId = keccak256(abi.encode(poolId, trader, nonce));

        policies[policyId] =
            Policy({poolId: poolId, trader: trader, nonce: nonce, expiry: expiry, maxLoss: maxLoss, maxFee: maxFee});

        registeredNonces[trader][nonce] = true;

        emit PolicyRegistered(policyId, poolId, trader, nonce, expiry, maxLoss, maxFee);
    }

    function getPolicy(bytes32 policyId) external view returns (Policy memory) {
        return policies[policyId];
    }

    function isRegistered(address trader, uint256 nonce) external view returns (bool) {
        return registeredNonces[trader][nonce];
    }

    function isConsumed(address trader, uint256 nonce) external view returns (bool) {
        return consumedNonces[trader][nonce];
    }

    function consumePolicy(bytes32 policyId) external onlyAuthorizedConsumer {
        Policy memory policy = policies[policyId];

        if (policy.trader == address(0)) {
            revert PolicyNotFound();
        }

        if (block.timestamp >= policy.expiry) {
            revert PolicyExpired();
        }

        if (consumedNonces[policy.trader][policy.nonce]) {
            revert PolicyAlreadyConsumed();
        }

        consumedNonces[policy.trader][policy.nonce] = true;
    }
}
