# MEVShield

**Programmable Execution Infrastructure for USDC**

MEVShield is an experimental, policy-controlled swap execution system designed to help traders define acceptable execution conditions before submitting a transaction to an EVM-compatible decentralized exchange.

It combines deterministic pre-trade risk assessment, cryptographically signed execution policies, and on-chain enforcement to give users and applications more control over how swaps are executed.

**Project status:** Experimental MVP — testnet development  
**Primary focus:** Uniswap v4, Solidity, EVM infrastructure, and protected token swaps

> MEVShield is under active development. It is not a guarantee against all forms of maximal extractable value (MEV), slippage, sandwich attacks, or financial loss. Do not use it with funds you cannot afford to lose.

---

## Table of Contents

- [The Problem](#the-problem)
- [Our Approach](#our-approach)
- [Core Features](#core-features)
- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Execution Policy](#execution-policy)
- [Risk Assessment](#risk-assessment)
- [Technology Stack](#technology-stack)
- [Repository Structure](#repository-structure)
- [Getting Started](#getting-started)
- [Environment Configuration](#environment-configuration)
- [Development and Testing](#development-and-testing)
- [Security Model](#security-model)
- [Current Limitations](#current-limitations)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Responsible Disclosure](#responsible-disclosure)
- [License](#license)

---

## The Problem

Decentralized exchanges allow users to trade directly through smart contracts. However, a transaction submitted to a public blockchain may be exposed to changing pool conditions, transaction ordering, adverse execution, and other MEV-related risks.

Common challenges include:

- **Uncertain execution:** The actual swap result can differ from the result a trader expects.
- **Adverse price movement:** Pool prices may move before or during transaction execution.
- **Transaction ordering:** Searchers and other participants may influence the ordering of transactions.
- **Limited user-defined controls:** A typical swap interface may not expose a comprehensive, application-enforced execution policy.
- **Fragmented risk management:** Risk assessment, transaction authorization, and on-chain execution are often implemented as separate systems.

A quote or warning by itself cannot guarantee that a swap will execute under the conditions a user expects. A meaningful protection mechanism needs to connect its pre-trade assessment to enforceable transaction conditions.

## Our Approach

MEVShield introduces a policy-controlled execution flow:

1. Assess the proposed swap before execution.
2. Calculate a deterministic risk assessment.
3. Define execution constraints in a structured policy.
4. Sign the policy using a cryptographic authorization mechanism.
5. Verify the policy and its authorization on-chain.
6. Execute the swap only when the applicable checks pass.
7. Reject execution when an enforced policy condition is violated.

The goal is to make execution constraints explicit, verifiable, and enforceable rather than relying solely on interface warnings.

MEVShield is designed around a simple principle:

**Assess before execution. Authorize explicitly. Enforce on-chain.**

---

## Core Features

### 1. Pre-trade risk assessment

The backend evaluates swap parameters and returns a deterministic risk assessment. The current MVP uses a simplified rule-based model rather than AI or a live-market predictive model.

### 2. Signed execution policies

Structured policies define the conditions under which a swap may execute. Policy data is cryptographically signed and checked against the intended transaction.

### 3. On-chain policy enforcement

The MEVShield hook and supporting contracts validate authorization and policy constraints during the swap execution path.

### 4. Uniswap v4 integration

The Solidity contracts integrate with the Uniswap v4 `PoolManager` and use a custom hook to participate in swap execution.

### 5. Price-limit validation

The current router implementation validates swap price limits before calling the pool manager. It also caps the distance between the current tick and the requested price-limit tick. That cap is a source constant fixed at 600 ticks in the current router, not a configurable setting, so changing it requires editing source, rebuilding, and redeploying.

### 6. Minimum-output enforcement

The current router implementation checks that the swap output satisfies the minimum-output condition encoded in the policy.

### 7. Execution observability

Transaction receipts, swap events, policy checks, and execution results can be used to investigate whether a protected swap followed its expected execution path.

---

## How It Works

The intended execution flow is:

```text
                    USER / DAPP
                         |
                         v
                 Submit Swap Request
                         |
                         v
                MEVShield Backend
                         |
              +----------+----------+
              |                     |
              v                     v
       Risk Assessment       Policy Construction
              |                     |
              +----------+----------+
                         |
                         v
                Policy Authorization
                         |
                         v
                  MEVShield Router
                         |
                         v
                  PoolManager.unlock
                         |
                         v
                Router Unlock Callback
                         |
                         v
               Validate Price Limit
                         |
                         v
                 PoolManager.swap
                         |
                         v
                 MEVShield Hook
                         |
                         v
              Policy and Authorization
                     Validation
                         |
               +---------+---------+
               |                   |
               v                   v
            Reject             Continue
                                   |
                                   v
                         Minimum Output Check
                                   |
                                   v
                          Settle / Take Tokens
                                   |
                                   v
                          Transaction Result
```

This diagram represents the intended architecture. The exact validation sequence depends on the implementation and execution path. A successful local test does not establish that every deployed component has been verified.

### Step-by-step

**Step 1 — Request assessment**

The application submits a proposed swap, including the pool, direction, and amount.

**Step 2 — Calculate risk**

The backend applies its current deterministic risk rules and returns the assessment.

**Step 3 — Construct the policy**

The policy specifies the pool, trader, nonce, expiry, risk constraints, swap parameters, price limit, and minimum output.

**Step 4 — Authorize the policy**

The applicable signing and verification components establish whether the policy is validly authorized.

**Step 5 — Execute through the router**

The router checks the request before calling the Uniswap v4 pool manager.

**Step 6 — Enforce execution conditions**

The hook and router enforce their respective authorization and execution constraints.

**Step 7 — Settle the swap**

If the transaction completes successfully, the router settles the required token balances and delivers the output. If an enforced condition fails and the transaction reverts, its state changes are reverted atomically.

---

## Architecture

MEVShield is divided into three main layers.

### 1. Application layer

The frontend provides the user-facing workflow for entering swap details, reviewing risk information, and interacting with the backend and wallet.

Responsibilities include:

- Collecting swap parameters.
- Requesting risk assessments.
- Displaying policy and execution status.
- Connecting to an EVM-compatible wallet.
- Submitting supported contract interactions.
- Displaying transaction results.

### 2. Backend layer

The backend supports risk assessment, policy generation, signing, and related API workflows.

Responsibilities include:

- Validating incoming requests.
- Calculating deterministic risk assessments.
- Constructing policy data.
- Supporting policy signing and signature verification.
- Exposing API endpoints to the frontend.
- Supporting execution monitoring and diagnostics.

The backend's risk score is not itself a security guarantee. Critical execution conditions must be checked by the appropriate on-chain components.

### 3. Smart-contract layer

The contract system connects signed policies to swap execution.

| Component | Responsibility |
|---|---|
| `MEVShieldRouter` | Coordinates the protected swap, price-limit validation, minimum-output enforcement, and settlement. |
| `MEVShieldHook` | Participates in Uniswap v4 swap execution and enforces applicable policy checks. |
| `PolicyAuthorization` | Supports policy authorization and consumption controls. |
| `PolicyVerifier` | Supports policy and signature verification. |
| `PolicyRegistry` | Stores and validates registered policy-related state. |

These components work together; none should be assumed to provide complete protection in isolation.

---

## Execution Policy

A MEVShield policy binds an authorization to specific swap conditions.

The current router policy structure includes:

| Field | Purpose |
|---|---|
| `poolId` | Identifies the intended pool. |
| `trader` | Identifies the trader associated with the policy. |
| `nonce` | Supports replay protection and policy-use tracking. |
| `expiry` | Defines when the policy expires. |
| `maxLoss` | Caps the loss estimate the hook will accept for this policy. |
| `maxFee` | Caps the fee estimate the hook will accept for this policy. |
| `zeroForOne` | Specifies the swap direction. |
| `amountSpecified` | Binds the policy to the requested swap amount. |
| `sqrtPriceLimitX96` | Specifies the requested price boundary. |
| `minAmountOut` | Specifies the minimum acceptable output amount. |

The policy is intended to bind authorization to the actual execution request. A mismatch between the policy and the submitted swap must not be treated as an acceptable authorization.

`maxLoss` and `maxFee` do not bound a measured outcome. The hook compares each signed cap against caller-supplied estimate values taken from `hookData`, so the comparison constrains what the caller asserts, not what the swap actually costs. Realized minimum output and the tick distance cap are router-only checks. This boundary is recorded in [docs/reviews/2026-10-28-code-review.md](docs/reviews/2026-10-28-code-review.md).

The implementation uses structured policy data and EIP-712-related signing and verification components. The precise signature domain, nonce lifecycle, expiry behavior, and authorization rules should be confirmed against the current contract implementations before an integration is considered production-ready.

---

## Risk Assessment

The backend estimates price impact from the current pool state for this trade size. It reads the pool's `sqrtPriceX96`, active liquidity, and swap fee, then quotes the trade against that active liquidity as a constant-product depth proxy.

It does not read the mempool, detect sandwich attacks, predict execution, or use an AI model. The figure is not a guarantee of realized loss.

### Current calculation

`amount` is the absolute value of `amountSpecified`. `zeroForOne` selects which token is the input. `L` is active liquidity and `sqrtP` is `sqrtPriceX96`.

```text
fee        = amount * feePips / 1_000_000
amountIn   = amount - fee
estimatedFee = fee

zeroForOne:
  nextSqrt = ceil(L * 2^96 * sqrtP / (L * 2^96 + amountIn * sqrtP))
  amountOut = L * (sqrtP - nextSqrt) / 2^96
  outputValueInInput = amountOut * 2^96 / sqrtP * 2^96 / sqrtP

oneForZero:
  nextSqrt = sqrtP + amountIn * 2^96 / L
  amountOut = L * 2^96 * (nextSqrt - sqrtP) / (nextSqrt * sqrtP)
  outputValueInInput = amountOut * sqrtP / 2^96 * sqrtP / 2^96

estimatedLoss = amountIn - outputValueInInput
lossBps       = estimatedLoss * 10_000 / amount
maxLoss       = estimatedLoss * 2
maxFee        = estimatedFee * 2
```

`estimatedLoss` is the shortfall versus selling the post-fee input at the spot price with no curvature. The swap fee is `estimatedFee`, not part of that shortfall. Integer division rounds the output value down.

| `lossBps` | `riskLevel` |
|---|---|
| `<= 10` | `LOW` |
| `<= 50` | `MEDIUM` |
| `> 50` | `HIGH` |

If active liquidity cannot support the trade (no liquidity, the input exhausts the virtual reserve, the next price leaves the Uniswap tick bounds, or the quote rounds to zero output), `estimatedLoss` is the full input amount and the level is `HIGH`. A failed pool read returns an error. The server does not fall back to `amount / 1000`.

`/risk-preview` and `/policy` both use this function. The response disclaimer states the same limit: the number is a price-impact estimate from current pool state for this trade size.

**Important limitations:** Active liquidity is assumed to remain available for the whole trade. The model does not walk neighboring ticks, so a swap that leaves the current range can cost more than the estimate. It does not observe other transactions, gas, or whether a minimum-output check would revert. `maxLoss` and `maxFee` are twice the estimates. The hook still compares those caps to caller-supplied values in `hookData`; it does not measure this loss.

---

## Technology Stack

| Layer | Technologies |
|---|---|
| Smart contracts | Solidity, Foundry |
| DEX integration | Uniswap v4, EVM |
| Contract security and testing | Foundry tests, Solidity unit and integration tests |
| Backend | Node.js, TypeScript |
| Frontend | React, TypeScript, Vite |
| Wallet and contract interaction | viem and EVM-compatible wallet integrations |
| Cryptographic authorization | EIP-712-compatible structured signing and verification |
| Development environment | Git, Linux/WSL, npm |

The exact versions should be taken from the project's current lockfiles and Foundry configuration.

---

## Repository Structure

The repository contains the following major areas:

```text
MEV_NEW/
├── src/
│   ├── MEVShieldHook.sol
│   ├── MEVShieldRouter.sol
│   ├── PolicyAuthorization.sol
│   ├── PolicyRegistry.sol
│   └── PolicyVerifier.sol
├── test/
│   ├── MEVShieldHook.t.sol
│   ├── MEVShieldIntegration.t.sol
│   ├── PolicyAuthorization.t.sol
│   ├── PolicyRegistry.t.sol
│   ├── PolicyVerifier.t.sol
│   └── SepoliaForkCurrentPoolQuote.t.sol
├── script/
│   └── deployment and setup scripts
├── backend/
│   ├── src/
│   │   ├── risk/
│   │   ├── policy/
│   │   ├── signer/
│   │   └── monitor/
│   └── package.json
├── frontend/
│   ├── src/
│   └── package.json
├── foundry.toml
└── README.md
```

This is a high-level representation; individual files and directories may change during development.

---

## Getting Started

### Prerequisites

Install the following:

- Git
- Node.js and npm
- Foundry (`forge`, `cast`, and `anvil`)
- An EVM-compatible wallet for testnet interaction
- RPC access to the network you intend to use

### 1. Clone the repository

```bash
git clone https://github.com/IsholaAtotimati/MEVSHIELD_NEW.git
cd MEVSHIELD_NEW
```

### 2. Install smart-contract dependencies

```bash
forge install
forge build
```

If dependencies are already managed in the repository, follow the existing Foundry configuration rather than reinstalling them unnecessarily.

### 3. Install backend dependencies

```bash
cd backend
npm install
```

Inspect `backend/package.json` for the supported development, build, and test scripts. Do not assume that a script name is available without checking it.

### 4. Install frontend dependencies

```bash
cd ../frontend
npm install
```

Use the scripts defined in `frontend/package.json` to run the development server and build the frontend.

### 5. Configure environment variables

Create local environment files using the documented examples:

- Backend: `backend/.env.example`
- Frontend: `frontend/.env.example`

Supply the required RPC endpoints, contract addresses, and application configuration for the intended test environment.

Do not commit private keys, API secrets, signing keys, or populated environment files.

### 6. Run the components

Start the backend and frontend using their respective package scripts. Verify that the frontend is connected to the correct backend and that the configured contract addresses belong to the same network.

**Do not run deployment, pool initialization, liquidity provisioning, approval, or swap scripts simply to test the installation.** Review each script and confirm its network, addresses, assumptions, and intended effects first.

---

## Environment Configuration

MEVShield relies on configuration being consistent across the frontend, backend, and smart contracts.

Typical configuration categories include:

| Configuration | Purpose |
|---|---|
| RPC URL | Connects to the intended EVM network. |
| Chain ID | Prevents accidental use of the wrong network. |
| PoolManager address | Identifies the Uniswap v4 execution contract. |
| Hook address | Identifies the MEVShield hook. |
| Router address | Identifies the router used for protected swaps. |
| Authorization address | Identifies the policy authorization component. |
| Registry and verifier addresses | Identify the associated policy components. |
| Policy feature flag | Controls whether the relevant policy workflow is enabled. |
| Minimum-output verification flag | Controls whether the deployment is recognized as verified for that protection. |

Names and exact environment-variable requirements should be taken from the current environment examples and configuration code.

For a protected deployment, confirm that all addresses match the same network and the intended deployment. A locally compiled contract is not proof that the deployed contract contains the same code.

---

## Development and Testing

Testing is essential because MEVShield's security depends on interactions among the router, hook, policy contracts, and pool manager.

### Build the contracts

```bash
forge build
```

### Run the smart-contract tests

```bash
forge test -vv
```

### Run the integration tests

```bash
forge test --match-path test/MEVShieldIntegration.t.sol -vv
```

### Run targeted price-limit tests

```bash
forge test \
  --match-path test/MEVShieldIntegration.t.sol \
  --match-test 'test_RouterRejectsPriceLimitBeyondTickDistanceZeroForOne|test_RouterRejectsPriceLimitBeyondTickDistanceOneForZero|test_RouterRejectsPriceLimitEqualToCurrentPrice' \
  -vv
```

### Test categories

The test suite should cover:

- Valid and invalid policy authorization.
- Expired policies and nonce/replay handling.
- Pool ID and swap-parameter mismatches.
- Invalid and excessively distant price limits.
- Minimum-output violations.
- Invalid callers and recipients.
- Token settlement and output delivery.
- Unexpected native ETH and refund behavior.
- Hook permission and pool configuration assumptions.
- End-to-end execution on a controlled local or forked environment.

### Fork tests

Fork tests can help evaluate interactions with a real deployed protocol at a selected block. They depend on RPC availability and the state of the selected pool.

A passing fork test does not prove that a current live pool has adequate liquidity, that a deployment matches the source, or that a transaction will succeed under future pool conditions.

### Deployment verification

Before enabling protected execution on a deployed network, verify:

1. The deployed runtime bytecode matches the intended build.
2. Constructor arguments and immutable dependencies are correct.
3. The hook permissions and pool key are correct.
4. The authorization, registry, and verifier are configured correctly.
5. The signed policy matches the executed swap.
6. Price limits and minimum output are enforced.
7. Settlement and token balances behave as expected.
8. End-to-end tests pass against a suitable, independently verified test environment.

### Read-only current Sepolia pool initialization plan

`script/PlanCurrentSepoliaPoolInitialization.s.sol` validates the approved current Sepolia pool key, confirms that the hook points to the expected PoolManager, and prints the initialization calldata without sending it. It requires an explicit `POOL_INITIAL_SQRT_PRICE_X96` value; it does not select a price or create a liquidity plan.

Run it against an approved Sepolia RPC endpoint without `--broadcast`:

```bash
POOL_INITIAL_SQRT_PRICE_X96=<owner-approved-integer> \
forge script script/PlanCurrentSepoliaPoolInitialization.s.sol:PlanCurrentSepoliaPoolInitialization \
  --rpc-url "$SEPOLIA_RPC_URL"
```

For currency0 USDC (6 decimals) and currency1 WETH (18 decimals), Uniswap v4 interprets the pool price as the raw-unit ratio:

```text
raw WETH per USDC = (sqrtPriceX96 / 2^96)^2
human WETH per USDC = raw WETH per USDC * 10^(6 - 18)
                    = raw WETH per USDC / 10^12
human USDC per WETH = 1 / human WETH per USDC
```

Independently calculate from the exact integer `sqrtPriceX96` using arbitrary-precision arithmetic, then compare the human-unit quote to an owner-approved independent reference price and verify the quote direction. Do not infer a price from the pool ID or old scripts.

The initialization tick is obtained from `TickMath.getTickAtSqrtPrice(sqrtPriceX96)`. A later liquidity range must be chosen explicitly: both boundaries must be multiples of the pool's 60-tick spacing, with `tickLower <= currentTick < tickUpper`. For negative ticks, round the lower boundary down toward negative infinity, not toward zero; then select an upper multiple strictly greater than the current tick. Range width and liquidity are owner decisions and are not inferred by this plan.

Do not prepare a liquidity plan until the LP owner and recipient are supplied and read-only checks confirm their USDC/WETH balances, ERC-20 approvals to Permit2, Permit2 allowances to the PositionManager, and the PositionManager/Permit2 addresses, code presence, and approved code hashes. The initialization planner intentionally does not inspect or print those owner-specific values.

---

## Security Model

MEVShield is designed to enforce explicit execution conditions. It does not eliminate every possible source of execution risk.

### Security principles

**Fail closed.** Invalid authorization or violated execution conditions should reject the protected swap.

**Bind authorization to intent.** The authorized policy should match the intended pool and swap parameters.

**Validate on-chain.** Backend calculations and frontend warnings must not replace contract-level enforcement of security-critical constraints.

**Limit execution parameters.** Price limits and minimum-output constraints help prevent execution outside explicitly defined boundaries.

**Preserve atomicity.** A reverting transaction must not leave partial swap state changes committed.

**Verify deployments.** The deployed bytecode, constructor configuration, hook permissions, and policy components must be checked rather than inferred from local source code.

### Threats addressed by the design

Depending on the specific execution path and verified implementation, MEVShield aims to constrain:

- Execution beyond an accepted price boundary.
- Output below an enforced minimum.
- Unauthorized or mismatched policy use.
- Invalid swap parameters.
- Certain invalid or replayed policy requests.

### Threats not eliminated

MEVShield should not be represented as eliminating:

- All sandwich attacks or transaction-ordering manipulation.
- Network congestion, failed transactions, or gas costs.
- Oracle manipulation or incorrect external price information.
- Smart-contract vulnerabilities in dependencies.
- Liquidity shortages and market volatility.
- Compromised signing keys or incorrect authorization configuration.
- Risks arising from unverified deployments or unsupported pool configurations.

### Audit status

The project is experimental and should not be considered production-audited based solely on its local test suite.

No claim of a completed independent security audit is made here. Before handling meaningful user funds, MEVShield requires comprehensive security review, deployment verification, and adversarial testing.

A source review of this repository on 28 October 2026 is recorded in [docs/reviews/2026-10-28-code-review.md](docs/reviews/2026-10-28-code-review.md). That note records the current enforcement boundary. It is not an independent audit.

---

## Current Limitations

The current MVP has important limitations:

1. **Simplified risk model:** The deterministic assessment is not a complete market-aware prediction of loss or MEV exposure.
2. **Quote and simulation requirements:** Reliable execution decisions require validated quotes and transaction simulation, not fabricated or unavailable quote data.
3. **Testnet dependency:** Successful operation depends on correctly configured contracts and suitable pool state.
4. **Deployment consistency:** Local source and deployed bytecode must be independently matched before relying on a deployment.
5. **Policy rollout controls:** Policy execution and minimum-output verification should remain disabled until their deployment and end-to-end checks are complete.
6. **No production guarantee:** The MVP is not a substitute for an independent audit or a guarantee of profitable or safe swaps.
7. **Enforcement boundary:** Signed authorization, expiry, and nonce consumption run in the hook. Realized minimum output and the tick-distance cap run in the router. Loss and fee caps are compared to caller-supplied estimates. Details are in the 28 October 2026 source review.

The active Sepolia pool used during earlier development has encountered an invalid operational price state and must not be treated as a healthy pool for further swap testing. Use a newly validated, controlled test environment for subsequent end-to-end work.

---

## Roadmap

### Phase 1 — Reliable execution foundation

- [x] Implement the core router, hook, and policy contract architecture.
- [x] Add initial deterministic risk assessment.
- [x] Add price-limit validation to the current router source.
- [x] Add minimum-output enforcement to the current router source.
- [x] Add initial unit and integration tests.
- [ ] Verify the intended router bytecode against the deployment.
- [ ] Establish a safe, correctly initialized test pool.
- [ ] Complete end-to-end policy-protected swap validation.

### Phase 2 — Stronger risk assessment

- [ ] Integrate a validated quote and simulation path.
- [ ] Improve pool-state and price-impact analysis.
- [ ] Calibrate risk thresholds using documented test scenarios.
- [ ] Compare predicted risk against observed execution results.
- [ ] Improve risk explanations and diagnostic information.

### Phase 3 — Stronger security and observability

- [ ] Conduct independent smart-contract security review.
- [ ] Expand fuzzing, invariant testing, and adversarial testing.
- [ ] Improve policy lifecycle and replay-protection tests.
- [ ] Add more comprehensive transaction and policy monitoring.
- [ ] Verify deployment reproducibility and runtime bytecode.

### Phase 4 — Broader integration

- [ ] Improve developer integration documentation.
- [ ] Evaluate additional EVM networks and compatible pools.
- [ ] Develop clearer application and wallet integration interfaces.
- [ ] Evaluate additional execution-protection strategies using measurable results.

Roadmap items may change as testing reveals new requirements. A checklist item marked complete describes development progress, not independent verification of production readiness.

---

## Contributing

Contributions, bug reports, security feedback, and technical discussion are welcome.

A useful contribution should:

1. Explain the problem or proposed improvement.
2. Identify the affected component.
3. Include tests where appropriate.
4. Describe security implications and assumptions.
5. Avoid introducing undocumented changes to deployment or authorization behavior.

For smart-contract changes, run the relevant Foundry tests before opening a pull request.

Do not include private keys, credentials, populated `.env` files, or sensitive production data in commits or issue reports.

---

## Responsible Disclosure

If you discover a potential vulnerability, avoid exploiting it against third-party systems or moving funds to demonstrate impact.

Please report the affected contract or component, the relevant execution conditions, and a minimal reproducible test case through the project's designated private security-reporting channel.

A public security-reporting contact should be added here before the repository is used for a public vulnerability disclosure process.

---

## License

The Solidity files include MIT license identifiers. Confirm the repository's root license file and dependency licenses before declaring the licensing terms for the entire project.

If the repository is intended to be MIT-licensed, include the corresponding `LICENSE` file at the root.

---

## Project Summary

MEVShield explores a practical approach to protected decentralized exchange execution by connecting deterministic pre-trade risk assessment with signed policies and on-chain enforcement.

Its central objective is to make swap execution constraints explicit and verifiable.

The current implementation is an experimental foundation. The next milestone is to establish a verified deployment and demonstrate a complete policy-protected swap flow in a controlled test environment before enabling the system for broader use.
