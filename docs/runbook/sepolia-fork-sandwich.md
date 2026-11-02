# Sepolia fork: price move, then minimum output

This runbook records local fork demonstrations and the pool-state risk estimate that replaced `amount / 1000`. No transaction is broadcast. No private key for the live Sepolia signer is used. No faucet is requested. An unpinned fork can move; the tables below are the runs that were logged, not a permanent pool state.

## What the test does

`test/SepoliaForkSandwich.t.sol`, test `test_forkSandwich_unprotectedReceivesLess_protectedReverts`.

The fork is Ethereum Sepolia at the public RPC `https://ethereum-sepolia-rpc.publicnode.com`. The pool is the live USDC/WETH pool (`0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602`) on PoolManager `0xE03A1074c86CFeDd5C142C4F04F1a1536e203543`. USDC is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. WETH is `0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14`. Tokens are funded with Foundry `deal`, not a faucet.

The sequence, all in the same direction (USDC in, WETH out):

1. Quote a victim swap of 20,000 raw USDC (0.02 USDC) with `minAmountOut = 1`. Record the WETH out. Restore the pool so the quote itself is not the price move.
2. An attacker swaps USDC with a price limit 10 ticks below the starting tick. The limit stops the swap. Record the new tick. Active liquidity is still present.
3. Unprotected victim: the same victim swap, again with `minAmountOut = 1`. The WETH out is strictly less than step 1.
4. Restore the post-attacker pool. Protected victim: the same swap through `MEVShieldRouter`, with `minAmountOut` set to the step-1 output. The transaction reverts. The victim's USDC and WETH balances are unchanged. The policy nonce is not left consumed.

The victim price limit is 40 ticks below the starting tick, inside the router's 600-tick cap, and still on the correct side of the price after the 10-tick attacker move.

## Code under test

Deployed into the fork from this repository, and not the live router `0x633282608B2fc66cD7572f5eF58e804063aa150D`:

- `PolicyRegistry`, `PolicyVerifier`, `PolicyAuthorization`
- `MEVShieldRouter`, constructed against the forked PoolManager

The live hook `0xd15E4fDD391a68C2F1C385d1a819117a3aD40080` has the Uniswap v4 `beforeSwap` permission bit set, so every swap calls it. That deployment accepts only signer `0x016B78a30CE176EF0B90c122e8677e13aAB2A815`. This test does not have that key and does not impersonate it. It etches this repository's `MEVShieldHook`, wired to a fork-local signer (`0xA11CE`), onto that address. That is the same etch pattern as `test/SepoliaForkV2Router.t.sol`. The price and liquidity are the forked pool's. The swap that moves the tick is a real `PoolManager.swap`.

The revert is `MEVShieldRouter._enforceMinimumOutput` (`src/MEVShieldRouter.sol`). `_validatePriceLimit` in the same contract can revert with `InvalidPriceLimit` when a limit is on the wrong side of the price or outside tick bounds; this run did not hit that path. `PriceLimitTooFar` is a different error and is not treated as success.

`MEVShieldHook.beforeSwap` (`src/MEVShieldHook.sol`) checks the signature, expiry, nonce, pool, swap parameters, a non-zero `minAmountOut`, and that the caller-supplied loss and fee estimates do not exceed the signed caps. It does not read the attacker's swap and it does not compare realized output with the pre-attack quote. The hook comment states that risk calculation stays off-chain and that the hook does not measure realized loss or fees.

`PolicyAuthorization.authorize` consumes the nonce before `PoolManager.swap` returns to the router. The minimum-output check runs after the swap, inside the same transaction. The revert rolls the nonce consumption back. The test asserts the nonce is not consumed afterward. A successful loose swap (`minAmountOut = 1`) does consume its own nonce, which is how the test shows consumption works.

The risk engine is not on this path.

## Command and block

```bash
export PATH="$HOME/.foundry/bin:$PATH"
RUN_SEPOLIA_FORK_SANDWICH=true forge test --match-path test/SepoliaForkSandwich.t.sol \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com -vv
```

Without `RUN_SEPOLIA_FORK_SANDWICH=true` the test skips, including in `forge test` with no fork URL.

The run below did not set `SEPOLIA_FORK_BLOCK_NUMBER`. Foundry forked the latest block, and the test logged it.

Fork block logged by the first run below: **12018873**

That block is the head the unpinned command happened to fork, not a pin. An unpinned fork follows the chain head, so a later run can log a different block. If the pool's price or active liquidity has changed, the tick and output numbers can change too. The test logs the block it used. It does not assert the tables below.

To repeat the first run's block:

```bash
RUN_SEPOLIA_FORK_SANDWICH=true SEPOLIA_FORK_BLOCK_NUMBER=12018873 \
forge test --match-path test/SepoliaForkSandwich.t.sol \
  --fork-url https://ethereum-sepolia-rpc.publicnode.com \
  --fork-block-number 12018873 -vv
```

If `SEPOLIA_FORK_BLOCK_NUMBER` is set, the test requires `block.number` to match. If it is unset, any fork block is accepted and the log records the one that was used.

Forge may print that it could not clone `lib/forge-std`, `lib/openzeppelin-contracts`, and `lib/v4-core` because those directories already contain the pinned sources copied from the main checkout (the submodule SHAs match; `lib/` is not committed from this worktree). The compiler then uses those copies. The clone warning is not a broadcast.

## Numbers from the run

Logged by `console.log` at `-vv`:

| Measurement | Value |
| --- | --- |
| Fork block | 12018873 |
| Tick before | 198487 |
| Tick after attacker | 198477 |
| Quoted WETH out before the attack (wei) | 8306140005511 |
| Unprotected WETH out after the attack (wei) | 8297097263431 |
| Protected revert | MinimumOutputNotMet |
| Active liquidity before | 1541399567004 |
| Active liquidity after the attacker | 1541399567004 |

The unprotected victim received 9,042,742,080 wei less WETH than the pre-attack quote. The protected swap used that pre-attack quote as `minAmountOut` and reverted `MinimumOutputNotMet`.

### Later unpinned run

The same unpinned command was run again on 29 October 2026. The block had moved. The tick, output, revert, and liquidity figures matched the table above.

| Measurement | Value |
| --- | --- |
| Fork block | 12018906 |
| Tick before | 198487 |
| Tick after attacker | 198477 |
| Quoted WETH out before the attack (wei) | 8306140005511 |
| Unprotected WETH out after the attack (wei) | 8297097263431 |
| Protected revert | MinimumOutputNotMet |
| Active liquidity before | 1541399567004 |
| Active liquidity after the attacker | 1541399567004 |

## What the revert proves, and what it does not

It proves that, on this forked pool, a same-direction swap moved the tick from 198487 to 198477 without removing active liquidity, the same victim swap then received less WETH, and this repository's router refused that worse output when the minimum was the pre-attack quote. The victim's balances did not change. The nonce consumed inside the reverting transaction was rolled back.

It does not prove any of the following:

- The live router or the live hook bytecode behaved this way. Those were not the contracts executed. The live deployment was not sent a transaction.
- The hook detected the attacker or measured the loss. It did not.
- The backend risk score saw this sequence, the mempool, or a sandwich. It did not run.
- The 10-tick gap on this thin pool (about 75 USDC of virtual token0 at the time of the run) is a general bound on sandwich loss, or that every pool will revert rather than hit `InvalidPriceLimit`.
- A user is protected if they sign `minAmountOut = 1`, or if they submit through a path that does not call this router.

## Risk score

`backend/src/risk/riskEngine.ts` estimates price impact from the current pool state for this trade size. `/risk-preview` and `/policy` read `slot0` and active liquidity through the configured RPC. If that read fails, the API returns `503` `pool_state_unavailable`. It does not substitute `amount / 1000`.

```text
fee        = amount * feePips / 1_000_000
amountIn   = amount - fee
estimatedFee = fee

zeroForOne (token0 in, price down):
  nextSqrt = ceil(L * 2^96 * sqrtP / (L * 2^96 + amountIn * sqrtP))
  amountOut = L * (sqrtP - nextSqrt) / 2^96
  outputValueInInput = amountOut * 2^96 / sqrtP * 2^96 / sqrtP

oneForZero (token1 in, price up):
  nextSqrt = sqrtP + amountIn * 2^96 / L
  amountOut = L * 2^96 * (nextSqrt - sqrtP) / (nextSqrt * sqrtP)
  outputValueInInput = amountOut * sqrtP / 2^96 * sqrtP / 2^96

estimatedLoss = amountIn - outputValueInInput
lossBps       = estimatedLoss * 10_000 / amount
maxLoss       = estimatedLoss * 2
maxFee        = estimatedFee * 2
```

`L` is active liquidity. `sqrtP` is `sqrtPriceX96`. `amount` is `abs(amountSpecified)`. `zeroForOne` chooses the direction. The swap fee is `estimatedFee`. `estimatedLoss` is only the curvature shortfall against the spot price, in input-token units. Integer division rounds the quoted output value down.

| `lossBps` | Level |
| --- | --- |
| `<= 10` | `LOW` |
| `<= 50` | `MEDIUM` |
| `> 50` | `HIGH` |

If active liquidity cannot support the trade, `estimatedLoss` is the full input and the level is `HIGH`.

Unit tests in `backend/src/risk/riskEngine.test.ts`, at a raw spot price of 1 unless noted:

| Case | Inputs | `estimatedLoss` | Level |
| --- | --- | --- | --- |
| Small trade, deep pool | amount `10^18`, L `10^30`, fee 3000 | 994010 (0 bps) | `LOW` |
| Threshold | amount 9501, L 10,000,000, fee 0 | 10 (10 bps) | `LOW` |
| Mid impact | amount 30501, L 10,000,000, fee 0 | 93 (30 bps) | `MEDIUM` |
| Threshold | amount 50501, L 10,000,000, fee 0 | 254 (50 bps) | `MEDIUM` |
| Just over the cap | amount 51501, L 10,000,000, fee 0 | 264 (51 bps) | `HIGH` |
| Liquidity too small | amount 5000, L 1000, fee 0 | 5000 | `HIGH` |

The same amount at `sqrtPriceX96 = 2 * 2^96` produces loss 1961 (`HIGH`) when `zeroForOne` is true and loss 500 (`MEDIUM`) when it is false. Direction is an input.

This score does not detect a sandwich, read the mempool, or walk neighboring ticks. A trade that leaves the current liquidity range can cost more than the estimate. `maxLoss` and `maxFee` are twice the estimates. The hook still compares those caps to the numbers the caller puts in `hookData`. It does not measure this loss. The disclaimer on `/risk-preview` and `/policy` says the same thing.

## How to re-run

No private keys. Do not broadcast. Do not point this test at a live signer. Do not change `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED` or the execute gate to "prove" the result.

```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge test
cd backend && npm test && npm run build
```

`forge test` without `RUN_SEPOLIA_FORK_SANDWICH=true` skips the fork test. The fork command is the one in the section above.

Recorded with this change: `forge test --offline` passed 88 tests, skipped 6 (the fork suites, including this one), 0 failed, 94 total. `cd backend && npm test` passed 102 tests, 0 failed. `npm run build` completed. The fork command above passed `test_forkSandwich_unprotectedReceivesLess_protectedReverts` and printed the table in this runbook.
