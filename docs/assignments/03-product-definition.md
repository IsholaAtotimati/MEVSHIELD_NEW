# Assignment 3 — Explain the Product Precisely

## Product Category

MEVShield is programmable execution-control infrastructure for Uniswap v4 that uses signed execution policies to enforce loss and fee limits on swaps.

## What MEVShield Is

MEVShield combines an off-chain risk engine with on-chain execution enforcement.

The off-chain system evaluates a requested swap and generates an execution policy containing:

- pool identity
- trader identity
- nonce
- expiry
- maximum permitted loss
- maximum permitted fee
- swap direction
- swap amount
- price-limit parameter

The policy is authorized using EIP-712 and registered on-chain.

During execution, the MEVShieldRouter sends the swap through Uniswap v4. The MEVShieldHook validates the policy before allowing the swap to proceed.

## What MEVShield Does

MEVShield can:

- calculate execution-risk limits
- generate execution policies
- cryptographically authorize policies
- register policies on-chain
- route swaps through a dedicated execution router
- enforce policy conditions at the Uniswap v4 hook
- reject swaps that violate policy limits
- prevent policy replay through nonce consumption
- bind policies to specific pools and swap parameters

## What MEVShield Does Not Currently Do

The current implementation does not yet:

- analyze the public mempool
- consume external market-risk APIs
- use live oracle data
- provide a wallet interface
- delay transactions
- independently calculate realized market loss inside the hook
- provide production-grade statistical risk prediction
- protect a live mainnet ETH/USDC transaction

These are outside the current MVP scope.

## Product Behavior

MEVShield is not only an analytics or warning system.

Its primary security property is enforcement.

The system converts an off-chain risk assessment into an authorized execution policy and enforces the policy at the on-chain execution boundary.

The execution model is:

    Swap Request
         |
         v
    Risk Assessment
         |
         v
    Policy Generation
         |
         v
    EIP-712 Authorization
         |
         v
    Policy Registration
         |
         v
    MEVShieldRouter
         |
         v
    Uniswap v4 PoolManager
         |
         v
    MEVShieldHook
         |
         +------ Policy Valid ------> Execute
         |
         +------ Policy Invalid ----> Revert

## Core Security Model

The key design principle is:

> The backend proposes the execution policy, but the blockchain enforces the policy.

The backend cannot simply cause an unsafe swap to execute after the policy has been signed.

The hook independently verifies the policy conditions before execution.

## Current Enforcement Conditions

The hook verifies:

1. Pool identity
2. Trader identity
3. Swap direction
4. Swap amount
5. Price-limit parameter
6. Policy expiry
7. Maximum loss
8. Maximum fee
9. EIP-712 authorization
10. Policy registration
11. Policy consumption state

A failure of a required condition causes the protected execution to revert.

## Current Architecture

    MEVShield
        |
        +-----------------------------+
        |                             |
    Off-chain                      On-chain
        |                             |
    Risk Engine                  Policy Registry
        |                             |
    Policy Generator             Policy Verifier
        |                             |
    EIP-712 Signer              Policy Authorization
        |                             |
        +-------------+---------------+
                      |
               MEVShieldRouter
                      |
                 PoolManager
                      |
                MEVShieldHook
                      |
                 +----+----+
                 |         |
               ALLOW     REJECT

## Current Deployment Environment

The current implementation is tested against an Anvil local EVM environment using Uniswap v4 contracts.

Chain ID:

    31337

The backend communicates with the local blockchain through JSON-RPC.

## Current Product Boundary

MEVShield should currently be described as a programmable execution-control prototype rather than a complete production MEV detection network.

Its demonstrated capability is policy-based protection at the execution layer.

The next milestones expand the risk model and evidence around this enforcement mechanism.