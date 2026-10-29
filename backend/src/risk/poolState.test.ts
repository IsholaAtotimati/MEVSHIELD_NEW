import assert from "node:assert/strict";
import test from "node:test";
import {
  PoolStateUnavailableError,
  createProtectedPoolReader,
  decodePoolState,
  poolStateSlots,
  readProtectedPoolState,
} from "./poolState.js";

const POOL_ID =
  "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602";
/** Slot observed from PoolManager.extsload on Sepolia for this pool id. */
const OBSERVED_SLOT0_KEY =
  0x684074ab16a28d9cb93aba3e57ec1396ee2e2288a4ce82e78d17a979d29469c7n;
const OBSERVED_SLOT0_WORD =
  0x000000000bb80000000307570000000000004fbc6a1e3126042957bd9612d33dn;
const OBSERVED_LIQUIDITY_WORD = 0x166e292da9cn;

test("pool state slot matches the PoolManager layout used on Sepolia", () => {
  const slots = poolStateSlots(POOL_ID);
  assert.equal(slots.slot0, OBSERVED_SLOT0_KEY);
  assert.equal(slots.liquidity, OBSERVED_SLOT0_KEY + 3n);
});

test("decodes the observed Sepolia slot0 and liquidity words", () => {
  const state = decodePoolState(
    OBSERVED_SLOT0_WORD,
    OBSERVED_LIQUIDITY_WORD,
    999n,
  );
  assert.equal(state.sqrtPriceX96, 1617238095152076543778314735768381n);
  assert.equal(state.liquidity, 1_541_399_567_004n);
  assert.equal(state.feePips, 3000n);
});

test("uses the configured fee when slot0 lpFee is zero", () => {
  const sqrtOnly = 1617238095152076543778314735768381n;
  const state = decodePoolState(sqrtOnly, OBSERVED_LIQUIDITY_WORD, 3000n);
  assert.equal(state.feePips, 3000n);
  assert.equal(state.liquidity, 1_541_399_567_004n);
});

test("returns zero liquidity instead of inventing depth", () => {
  const state = decodePoolState(OBSERVED_SLOT0_WORD, 0n, 3000n);
  assert.equal(state.liquidity, 0n);
  assert.equal(state.sqrtPriceX96, 1617238095152076543778314735768381n);
});

test("uninitialized pool is a failed read", () => {
  assert.throws(
    () => decodePoolState(0n, OBSERVED_LIQUIDITY_WORD, 3000n),
    (error: unknown) => {
      assert.ok(error instanceof PoolStateUnavailableError);
      assert.match(error.message, /uninitialized/);
      return true;
    },
  );
});

test("missing RPC fails closed before any call", async () => {
  await assert.rejects(
    () =>
      readProtectedPoolState({
        rpcUrl: undefined,
        poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
        poolId: POOL_ID,
        chainId: 11155111,
        fallbackFeePips: 3000n,
        call: async () => {
          throw new Error("call should not run");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof PoolStateUnavailableError);
      assert.match(error.message, /SEPOLIA_RPC_URL or RPC_URL/);
      return true;
    },
  );
});

test("an RPC failure is a pool-state error and not a numeric estimate", async () => {
  await assert.rejects(
    () =>
      readProtectedPoolState({
        rpcUrl: "http://127.0.0.1:9",
        poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
        poolId: POOL_ID,
        chainId: 11155111,
        fallbackFeePips: 3000n,
        call: async () => {
          throw new Error("rpc down");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof PoolStateUnavailableError);
      assert.match(error.message, /Pool state read failed: rpc down/);
      return true;
    },
  );
});

test("createProtectedPoolReader fails closed when no RPC is configured", async () => {
  const read = createProtectedPoolReader(
    {},
    { poolId: POOL_ID, fee: 3000 },
    11155111,
  );
  await assert.rejects(read(), (error: unknown) => {
    assert.ok(error instanceof PoolStateUnavailableError);
    assert.match(error.message, /SEPOLIA_RPC_URL or RPC_URL/);
    return true;
  });
});
