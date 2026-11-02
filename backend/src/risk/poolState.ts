import {
  AbiCoder,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  keccak256,
} from "ethers";

import { resolveSepoliaRpcUrl } from "../config/env.js";
import { LOCAL_CHAIN_ID } from "../config/runtimeConfig.js";

/**
 * Reads slot0 and active liquidity for the configured pool.
 *
 * The numbers feed the price-impact estimate. A failed read is an error.
 * Callers must not substitute amount/1000.
 */

export const SEPOLIA_POOL_MANAGER = "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543";
/** Deterministic anvil address from the local Docker deploy. */
export const LOCAL_POOL_MANAGER = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;
const POOL_MANAGER_STATE = new Interface([
  "function extsload(bytes32 slot) view returns (bytes32)",
]);

export class PoolStateUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PoolStateUnavailableError";
  }
}

export type ActivePoolState = {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  feePips: bigint;
};

export type PoolStateReader = () => Promise<ActivePoolState>;

type SlotCaller = (slot: bigint) => Promise<bigint>;

export type ReadPoolStateOptions = {
  rpcUrl: string | undefined;
  poolManager: string;
  poolId: string;
  chainId: number;
  /** Pool-key fee used only when slot0's lpFee is zero. */
  fallbackFeePips: bigint;
  call?: SlotCaller;
};

/**
 * PoolManager storage slot of `pools[poolId].slot0`.
 * Matches `StateLibrary._getPoolStateSlot`: keccak256(abi.encodePacked(poolId, bytes32(uint256(6)))).
 * `abi.encode` of `(bytes32, uint256)` is the same 64 bytes.
 * Liquidity is three slots higher (`StateLibrary.LIQUIDITY_OFFSET`).
 */
export function poolStateSlots(poolId: string): {
  slot0: bigint;
  liquidity: bigint;
} {
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "uint256"],
    [poolId, POOLS_SLOT],
  );
  const slot0 = BigInt(keccak256(encoded));
  return { slot0, liquidity: slot0 + LIQUIDITY_OFFSET };
}

/**
 * Decodes a PoolManager slot0 word and the liquidity word.
 * Layout matches `StateLibrary.getSlot0`: sqrtPrice in the low 160 bits,
 * lpFee in bits 208..231. Liquidity is the low 128 bits of its slot.
 * A zero sqrt price means the pool is uninitialized, which is a failed read.
 * Zero liquidity is returned so the impact formula can refuse the trade.
 */
export function decodePoolState(
  slot0Word: bigint,
  liquidityWord: bigint,
  fallbackFeePips: bigint,
): ActivePoolState {
  const sqrtPriceX96 = slot0Word & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) {
    throw new PoolStateUnavailableError(
      "Protected pool is uninitialized (sqrtPriceX96 is zero), so price impact cannot be estimated.",
    );
  }

  const lpFee = (slot0Word >> 208n) & 0xffffffn;
  const liquidity = liquidityWord & ((1n << 128n) - 1n);
  const feePips = lpFee > 0n ? lpFee : fallbackFeePips;
  return { sqrtPriceX96, liquidity, feePips };
}

export function createProtectedPoolReader(
  env: NodeJS.ProcessEnv,
  pool: { poolId: string; fee: number },
  chainId: number,
): PoolStateReader {
  return () =>
    readProtectedPoolState({
      rpcUrl: resolveSepoliaRpcUrl(env),
      poolManager:
        chainId === LOCAL_CHAIN_ID ? LOCAL_POOL_MANAGER : SEPOLIA_POOL_MANAGER,
      poolId: pool.poolId,
      chainId,
      fallbackFeePips: BigInt(pool.fee),
    });
}

export async function readProtectedPoolState(
  options: ReadPoolStateOptions,
): Promise<ActivePoolState> {
  try {
    if (!options.rpcUrl) {
      throw new PoolStateUnavailableError(
        "SEPOLIA_RPC_URL or RPC_URL is required to read pool state for the price-impact estimate.",
      );
    }

    const slots = poolStateSlots(options.poolId);
    const call = options.call ?? ((slot: bigint) => extsload(options, slot));
    const slot0Word = await call(slots.slot0);
    const liquidityWord = await call(slots.liquidity);
    return decodePoolState(slot0Word, liquidityWord, options.fallbackFeePips);
  } catch (error) {
    if (error instanceof PoolStateUnavailableError) {
      throw error;
    }
    const detail =
      error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    throw new PoolStateUnavailableError(`Pool state read failed: ${detail}`);
  }
}

async function extsload(
  options: ReadPoolStateOptions,
  slot: bigint,
): Promise<bigint> {
  const request = new FetchRequest(options.rpcUrl as string);
  request.timeout = 10_000;
  const provider = new JsonRpcProvider(request, options.chainId, {
    staticNetwork: true,
  });
  try {
    const word = await provider.call({
      to: options.poolManager,
      data: POOL_MANAGER_STATE.encodeFunctionData("extsload", [toWord(slot)]),
    });
    return BigInt(word);
  } finally {
    provider.destroy();
  }
}

function toWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
