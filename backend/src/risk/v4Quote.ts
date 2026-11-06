import {
  AbiCoder,
  FetchRequest,
  Interface,
  JsonRpcProvider,
  keccak256,
} from "ethers";

import { resolveSepoliaRpcUrl } from "../config/env.js";
import {
  LOCAL_CHAIN_ID,
  type ProtectedPoolConfig,
  SEPOLIA_CHAIN_ID,
} from "../config/runtimeConfig.js";
import {
  LOCAL_POOL_MANAGER,
  SEPOLIA_POOL_MANAGER,
} from "./poolState.js";
import { sqrtRatioAtTick, tickAtSqrtRatio } from "./tickMath.js";
import {
  SharedStateUnavailableError,
  type SharedStateStore,
} from "../state/stateStore.js";

const Q96 = 2n ** 96n;
const ONE = 1n;
const ZERO = 0n;
const MAX_UINT160 = (1n << 160n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT128 = (1n << 128n) - 1n;
const MIN_TICK = -887_272;
const MAX_TICK = 887_272;

type TickDataProvider = {
  getTick(tick: number): Promise<{ liquidityNet: string | number | bigint }>;
  nextInitializedTickWithinOneWord(
    tick: number,
    lte: boolean,
    tickSpacing: number,
  ): Promise<[number, boolean]>;
};

function mulDivRoundUp(a: bigint, b: bigint, c: bigint): bigint {
  const product = a * b;
  const quotient = product / c;
  return product % c === 0n ? quotient : quotient + 1n;
}

function getAmount0Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  const numerator1 = liquidity << 96n;
  const numerator2 = sqrtRatioBX96 - sqrtRatioAX96;
  return roundUp
    ? mulDivRoundUp(mulDivRoundUp(numerator1, numerator2, sqrtRatioBX96), ONE, sqrtRatioAX96)
    : ((numerator1 * numerator2) / sqrtRatioBX96) / sqrtRatioAX96;
}

function getAmount1Delta(
  sqrtRatioAX96: bigint,
  sqrtRatioBX96: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  if (sqrtRatioAX96 > sqrtRatioBX96) {
    [sqrtRatioAX96, sqrtRatioBX96] = [sqrtRatioBX96, sqrtRatioAX96];
  }
  return roundUp
    ? mulDivRoundUp(liquidity, sqrtRatioBX96 - sqrtRatioAX96, Q96)
    : (liquidity * (sqrtRatioBX96 - sqrtRatioAX96)) / Q96;
}

const POOLS_SLOT = 6n;
const LIQUIDITY_OFFSET = 3n;
const TICKS_OFFSET = 4n;
const TICK_BITMAP_OFFSET = 5n;
const MAX_PRICE_LIMIT_TICK_DISTANCE = 600;
const MAX_AMOUNT = (1n << 127n) - 1n;
const MAX_SLIPPAGE_BPS = 1_000;
const PIPS_DENOMINATOR = 1_000_000;
const BPS_DENOMINATOR = 10_000n;
const BLOCK_READ_ATTEMPTS = 3;
const BLOCK_READ_RETRY_DELAY_MS = 150;
const MANAGER = new Interface([
  "function extsload(bytes32 slot) view returns (bytes32)",
]);
const ABI_CODER = AbiCoder.defaultAbiCoder();

export type V4PoolSnapshot = {
  sqrtPriceX96: bigint;
  tick: number;
  liquidity: bigint;
  protocolFee: bigint;
  lpFee: bigint;
};

export type ProtectedQuoteInput = {
  amountIn: string;
  zeroForOne: boolean;
  sqrtPriceLimitX96?: string;
  slippageBps: number;
};

export type ProtectedV4Quote = {
  chainId: number;
  poolId: string;
  zeroForOne: boolean;
  amountSpecified: string;
  amountOut: string;
  minAmountOut: string;
  priceImpactBps: number;
  sqrtPriceLimitX96: string;
  feePips: number;
  blockNumber: number;
  blockTimestamp: number;
  quotedAt: string;
  expiresAt: string;
  quoteId: string;
  poolState: {
    sqrtPriceX96: string;
    tick: number;
    liquidity: string;
  };
};

const QUOTE_CACHE_TTL_MS = 15_000;
const QUOTE_CACHE_PREFIX = "mevshield:quote:";

export function isQuoteCacheEntryValid(
  quote: Pick<ProtectedV4Quote, "expiresAt">,
  issuedAtMs: number,
  nowMs = Date.now(),
): boolean {
  return (
    nowMs - issuedAtMs <= QUOTE_CACHE_TTL_MS &&
    nowMs < Date.parse(quote.expiresAt)
  );
}

export async function storeProtectedQuote(
  quote: ProtectedV4Quote,
  store: SharedStateStore,
  issuedAtMs = Date.now(),
): Promise<void> {
  await store.set(
    `${QUOTE_CACHE_PREFIX}${quote.quoteId}`,
    JSON.stringify({ quote, issuedAtMs }),
    QUOTE_CACHE_TTL_MS,
  );
}

export async function isCachedQuoteValidForPolicy(
  input: {
  quoteId: string;
  poolId: string;
  amountSpecified: string;
  zeroForOne: boolean;
  sqrtPriceLimitX96: string;
  minAmountOut: string;
  },
  store: SharedStateStore,
): Promise<boolean> {
  const cachedValue = await store.get(`${QUOTE_CACHE_PREFIX}${input.quoteId}`);
  if (!cachedValue) {
    return false;
  }
  let cached: { quote: ProtectedV4Quote; issuedAtMs: number };
  try {
    cached = JSON.parse(cachedValue) as typeof cached;
  } catch {
    return false;
  }
  if (
    !cached.quote ||
    typeof cached.issuedAtMs !== "number" ||
    !isQuoteCacheEntryValid(cached.quote, cached.issuedAtMs)
  ) {
    return false;
  }
  const quote = cached.quote;
  return (
    quote.poolId.toLowerCase() === input.poolId.toLowerCase() &&
    quote.amountSpecified === input.amountSpecified &&
    quote.zeroForOne === input.zeroForOne &&
    quote.sqrtPriceLimitX96 === input.sqrtPriceLimitX96 &&
    quote.minAmountOut === input.minAmountOut
  );
}

export class ProtectedQuoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtectedQuoteError";
  }
}

async function readLatestQuoteBlock(
  provider: JsonRpcProvider,
): Promise<NonNullable<Awaited<ReturnType<JsonRpcProvider["getBlock"]>>>> {
  for (let attempt = 0; attempt < BLOCK_READ_ATTEMPTS; attempt += 1) {
    const block = await provider.getBlock("latest");
    if (block) return block;
    if (attempt + 1 < BLOCK_READ_ATTEMPTS) {
      await new Promise((resolve) =>
        setTimeout(resolve, BLOCK_READ_RETRY_DELAY_MS),
      );
    }
  }
  throw new ProtectedQuoteError("Could not read the quote block timestamp.");
}

export function poolStorageSlots(poolId: string): {
  state: bigint;
  liquidity: bigint;
  ticks: bigint;
  tickBitmap: bigint;
} {
  const state = BigInt(
    keccak256(ABI_CODER.encode(["bytes32", "uint256"], [poolId, POOLS_SLOT])),
  );
  return {
    state,
    liquidity: state + LIQUIDITY_OFFSET,
    ticks: state + TICKS_OFFSET,
    tickBitmap: state + TICK_BITMAP_OFFSET,
  };
}

export function tickBitmapStorageSlot(
  bitmapMappingSlot: bigint,
  wordPosition: number,
): bigint {
  return BigInt(
    keccak256(
      ABI_CODER.encode(["int256", "bytes32"], [
        BigInt(wordPosition),
        toWord(bitmapMappingSlot),
      ]),
    ),
  );
}

export function tickInfoStorageSlot(
  ticksMappingSlot: bigint,
  tick: number,
): bigint {
  return BigInt(
    keccak256(
      ABI_CODER.encode(["int256", "bytes32"], [
        BigInt(tick),
        toWord(ticksMappingSlot),
      ]),
    ),
  );
}

export function decodeV4PoolSnapshot(
  slot0Word: bigint,
  liquidityWord: bigint,
): V4PoolSnapshot {
  const sqrtPriceX96 = slot0Word & ((1n << 160n) - 1n);
  if (sqrtPriceX96 === 0n) {
    throw new ProtectedQuoteError("Protected pool is not initialized.");
  }
  const tick = Number(BigInt.asIntN(24, slot0Word >> 160n));
  const protocolFee = (slot0Word >> 184n) & 0xffffffn;
  const lpFee = (slot0Word >> 208n) & 0xffffffn;
  const liquidity = liquidityWord & ((1n << 128n) - 1n);
  const priceTick = tickAtSqrtRatio(sqrtPriceX96);
  if (priceTick !== tick && priceTick !== tick + 1) {
    throw new ProtectedQuoteError(
      "Protected pool price and tick state are inconsistent.",
    );
  }
  return { sqrtPriceX96, tick, liquidity, protocolFee, lpFee };
}

export function assertSupportedV4PoolState(
  pool: ProtectedPoolConfig,
  snapshot: V4PoolSnapshot,
): number {
  if (snapshot.protocolFee !== 0n) {
    throw new ProtectedQuoteError(
      "Protected pool protocol fees are nonzero and are not supported by this quote path.",
    );
  }
  if (snapshot.lpFee !== BigInt(pool.fee)) {
    throw new ProtectedQuoteError(
      "Protected pool LP fee does not match the configured static pool fee.",
    );
  }
  if (pool.fee >= PIPS_DENOMINATOR) {
    throw new ProtectedQuoteError("Configured pool fee is invalid.");
  }
  return Number(snapshot.lpFee);
}

export function validatePriceLimit(
  snapshot: V4PoolSnapshot,
  zeroForOne: boolean,
  sqrtPriceLimitX96: bigint,
): number {
  if (
    sqrtPriceLimitX96 <= 0n ||
    sqrtPriceLimitX96 >= 1n << 160n ||
    sqrtPriceLimitX96 <= sqrtRatioAtTick(MIN_TICK) ||
    sqrtPriceLimitX96 >= sqrtRatioAtTick(MAX_TICK) ||
    (zeroForOne && sqrtPriceLimitX96 >= snapshot.sqrtPriceX96) ||
    (!zeroForOne && sqrtPriceLimitX96 <= snapshot.sqrtPriceX96)
  ) {
    throw new ProtectedQuoteError(
      "Price limit is invalid for the requested swap direction.",
    );
  }

  const limitTick = tickAtSqrtRatio(sqrtPriceLimitX96);
  const distance = zeroForOne
    ? snapshot.tick - limitTick
    : limitTick - snapshot.tick;
  if (distance <= 0 || distance > MAX_PRICE_LIMIT_TICK_DISTANCE) {
    throw new ProtectedQuoteError(
      "Price limit must be within 600 ticks of the current pool price.",
    );
  }
  return limitTick;
}

export async function simulateV4ExactInput(
  snapshot: V4PoolSnapshot,
  tickSpacing: number,
  feePips: number,
  amountIn: bigint,
  zeroForOne: boolean,
  sqrtPriceLimitX96: bigint,
  tickDataProvider: TickDataProvider,
): Promise<bigint> {
  if (amountIn <= 0n || amountIn > MAX_AMOUNT) {
    throw new ProtectedQuoteError(
      "Input amount must be positive and fit the v4 int128 swap-delta range.",
    );
  }
  if (feePips < 0 || feePips >= PIPS_DENOMINATOR) {
    throw new ProtectedQuoteError("Swap fee is invalid.");
  }
  if (!Number.isInteger(tickSpacing) || tickSpacing <= 0) {
    throw new ProtectedQuoteError("Pool tick spacing is invalid.");
  }

  let sqrtPriceX96 = snapshot.sqrtPriceX96;
  let tick = snapshot.tick;
  let liquidity = snapshot.liquidity;
  let amountRemaining = amountIn;
  let amountOut = 0n;

  while (amountRemaining > 0n && sqrtPriceX96 !== sqrtPriceLimitX96) {
    let [tickNext, initialized] =
      await tickDataProvider.nextInitializedTickWithinOneWord(
        tick,
        zeroForOne,
        tickSpacing,
      );
    tickNext = Math.max(MIN_TICK, Math.min(MAX_TICK, tickNext));
    const sqrtPriceAtNextTick = sqrtRatioAtTick(tickNext);
    const targetSqrtPriceX96 = zeroForOne
      ? maxBigInt(sqrtPriceLimitX96, sqrtPriceAtNextTick)
      : minBigInt(sqrtPriceLimitX96, sqrtPriceAtNextTick);

    let amountInStep = 0n;
    let amountOutStep = 0n;
    let feeAmount = 0n;
    let nextSqrtPriceX96 = targetSqrtPriceX96;

    if (liquidity > 0n) {
      const amountRemainingLessFee =
        (amountRemaining * BigInt(PIPS_DENOMINATOR - feePips)) /
        BigInt(PIPS_DENOMINATOR);
      const amountInToTarget = zeroForOne
        ? getAmount0Delta(
            targetSqrtPriceX96,
            sqrtPriceX96,
            liquidity,
            true,
          )
        : getAmount1Delta(
            sqrtPriceX96,
            targetSqrtPriceX96,
            liquidity,
            true,
          );

      if (amountRemainingLessFee >= amountInToTarget) {
        amountInStep = amountInToTarget;
      } else {
        nextSqrtPriceX96 = getNextSqrtPriceFromInput(
          sqrtPriceX96,
          liquidity,
          amountRemainingLessFee,
          zeroForOne,
        );
      }

      amountOutStep = zeroForOne
        ? getAmount1Delta(
            nextSqrtPriceX96,
            sqrtPriceX96,
            liquidity,
            false,
          )
        : getAmount0Delta(
            sqrtPriceX96,
            nextSqrtPriceX96,
            liquidity,
            false,
          );
      if (nextSqrtPriceX96 === targetSqrtPriceX96) {
        feeAmount = mulDivRoundUp(
          amountInStep,
          BigInt(feePips),
          BigInt(PIPS_DENOMINATOR - feePips),
        );
      } else {
        amountInStep = zeroForOne
          ? getAmount0Delta(
              nextSqrtPriceX96,
              sqrtPriceX96,
              liquidity,
              true,
            )
          : getAmount1Delta(
              sqrtPriceX96,
              nextSqrtPriceX96,
              liquidity,
              true,
            );
        feeAmount = amountRemaining - amountInStep;
      }
    }

    if (
      amountInStep > MAX_AMOUNT ||
      amountOutStep > MAX_AMOUNT ||
      feeAmount > MAX_AMOUNT
    ) {
      throw new ProtectedQuoteError("Swap step exceeds the v4 int128 delta range.");
    }
    const consumed = amountInStep + feeAmount;
    if (consumed > amountRemaining) {
      throw new ProtectedQuoteError("Swap fee rounding exceeds the remaining input.");
    }
    amountRemaining -= consumed;
    amountOut += amountOutStep;
    if (amountOut > MAX_AMOUNT) {
      throw new ProtectedQuoteError("Swap output exceeds the v4 int128 delta range.");
    }

    sqrtPriceX96 = nextSqrtPriceX96;
    if (sqrtPriceX96 === sqrtPriceAtNextTick) {
      if (initialized) {
        const liquidityNet = BigInt(
          (await tickDataProvider.getTick(tickNext)).liquidityNet,
        );
        liquidity += zeroForOne ? -liquidityNet : liquidityNet;
        if (liquidity < 0n || liquidity > MAX_UINT128) {
          throw new ProtectedQuoteError(
            "Initialized tick produces invalid active liquidity.",
          );
        }
      }
      tick = zeroForOne ? tickNext - 1 : tickNext;
    } else if (sqrtPriceX96 !== snapshot.sqrtPriceX96 || amountRemaining < amountIn) {
      tick = tickAtSqrtRatio(sqrtPriceX96);
    }
  }

  if (amountRemaining > 0n) {
    throw new ProtectedQuoteError(
      "Insufficient executable liquidity before the configured price limit.",
    );
  }
  if (amountOut <= 0n) {
    throw new ProtectedQuoteError("Quote simulation returned no output.");
  }
  return amountOut;
}

export async function readProtectedV4Quote(
  env: NodeJS.ProcessEnv,
  chainId: number,
  pool: ProtectedPoolConfig,
  input: ProtectedQuoteInput,
  store: SharedStateStore,
): Promise<ProtectedV4Quote> {
  const rpcUrl = resolveSepoliaRpcUrl(env);
  if (!rpcUrl) {
    throw new ProtectedQuoteError(
      "SEPOLIA_RPC_URL or RPC_URL is required for a live protected-pool quote.",
    );
  }
  if (chainId !== SEPOLIA_CHAIN_ID && chainId !== LOCAL_CHAIN_ID) {
    throw new ProtectedQuoteError("Live protected-pool quotes are not enabled for this chain.");
  }
  if (!Number.isInteger(input.slippageBps) || input.slippageBps < 1 || input.slippageBps > MAX_SLIPPAGE_BPS) {
    throw new ProtectedQuoteError("Slippage tolerance must be between 1 and 1000 basis points.");
  }
  if (!/^[1-9]\d{0,77}$/.test(input.amountIn)) {
    throw new ProtectedQuoteError("Input amount must be a positive base-unit integer.");
  }

  const amountIn = BigInt(input.amountIn);
  if (amountIn > MAX_AMOUNT) {
    throw new ProtectedQuoteError(
      "Input amount exceeds the v4 int128 swap-delta range.",
    );
  }
  if (
    input.sqrtPriceLimitX96 !== undefined &&
    !/^\d{1,49}$/.test(input.sqrtPriceLimitX96)
  ) {
    throw new ProtectedQuoteError("Price limit must be an unsigned integer.");
  }
  const requestedSqrtPriceLimitX96 =
    input.sqrtPriceLimitX96 === undefined
      ? undefined
      : BigInt(input.sqrtPriceLimitX96);
  const poolManager =
    chainId === LOCAL_CHAIN_ID ? LOCAL_POOL_MANAGER : SEPOLIA_POOL_MANAGER;

  const request = new FetchRequest(rpcUrl);
  request.timeout = 10_000;
  const provider = new JsonRpcProvider(request, chainId, {
    staticNetwork: true,
  });
  try {
    const block = await readLatestQuoteBlock(provider);
    const blockNumber = block.number;

    const slots = poolStorageSlots(pool.poolId);
    const [slot0Word, liquidityWord] = await Promise.all([
      readExtsload(provider, poolManager, slots.state, blockNumber),
      readExtsload(provider, poolManager, slots.liquidity, blockNumber),
    ]);
    const snapshot = decodeV4PoolSnapshot(slot0Word, liquidityWord);
    const feePips = assertSupportedV4PoolState(pool, snapshot);
    const limitTick = Math.max(
      MIN_TICK + 1,
      Math.min(
        MAX_TICK - 1,
        snapshot.tick + (input.zeroForOne ? -599 : 599),
      ),
    );
    const sqrtPriceLimitX96 =
      requestedSqrtPriceLimitX96 ?? sqrtRatioAtTick(limitTick);
    validatePriceLimit(snapshot, input.zeroForOne, sqrtPriceLimitX96);

    const tickDataProvider = new RpcTickDataProvider(
      provider,
      poolManager,
      slots.tickBitmap,
      slots.ticks,
      blockNumber,
    );
    const amountOut = await simulateV4ExactInput(
      snapshot,
      pool.tickSpacing,
      feePips,
      amountIn,
      input.zeroForOne,
      sqrtPriceLimitX96,
      tickDataProvider,
    );
    const minAmountOut =
      (amountOut * (BPS_DENOMINATOR - BigInt(input.slippageBps))) /
      BPS_DENOMINATOR;
    if (minAmountOut <= 0n) {
      throw new ProtectedQuoteError(
        "Slippage tolerance leaves no enforceable minimum output.",
      );
    }
    const amountAfterFee =
      (amountIn * BigInt(PIPS_DENOMINATOR - feePips)) /
      BigInt(PIPS_DENOMINATOR);
    const spotAmountOut = input.zeroForOne
      ? (amountAfterFee * snapshot.sqrtPriceX96 * snapshot.sqrtPriceX96) /
        (Q96 * Q96)
      : (amountAfterFee * Q96 * Q96) /
        (snapshot.sqrtPriceX96 * snapshot.sqrtPriceX96);
    const priceImpactBps =
      spotAmountOut <= 0n || amountOut >= spotAmountOut
        ? 0
        : Number(((spotAmountOut - amountOut) * BPS_DENOMINATOR) / spotAmountOut);

    const quoteId = keccak256(
      ABI_CODER.encode(
        [
          "uint256",
          "bytes32",
          "bool",
          "uint256",
          "uint160",
          "uint256",
          "uint256",
          "uint16",
          "uint32",
          "uint64",
          "uint24",
        ],
        [
          chainId,
          pool.poolId,
          input.zeroForOne,
          amountIn,
          sqrtPriceLimitX96,
          amountOut,
          minAmountOut,
          input.slippageBps,
          blockNumber,
          block.timestamp,
          feePips,
        ],
      ),
    );
    const quote: ProtectedV4Quote = {
      chainId,
      poolId: pool.poolId,
      zeroForOne: input.zeroForOne,
      amountSpecified: (-amountIn).toString(),
      amountOut: amountOut.toString(),
      minAmountOut: minAmountOut.toString(),
      priceImpactBps,
      sqrtPriceLimitX96: sqrtPriceLimitX96.toString(),
      feePips,
      blockNumber,
      blockTimestamp: block.timestamp,
      quotedAt: new Date(block.timestamp * 1000).toISOString(),
      expiresAt: new Date((block.timestamp + 15) * 1000).toISOString(),
      quoteId,
      poolState: {
        sqrtPriceX96: snapshot.sqrtPriceX96.toString(),
        tick: snapshot.tick,
        liquidity: snapshot.liquidity.toString(),
      },
    };
    await storeProtectedQuote(quote, store);
    return quote;
  } catch (error) {
    if (error instanceof ProtectedQuoteError) {
      throw error;
    }
    if (error instanceof SharedStateUnavailableError) {
      throw error;
    }
    const detail =
      error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    throw new ProtectedQuoteError(`Live quote failed: ${detail}`);
  } finally {
    provider.destroy();
  }
}

class RpcTickDataProvider implements TickDataProvider {
  private readonly bitmapCache = new Map<number, bigint>();

  constructor(
    private readonly provider: JsonRpcProvider,
    private readonly poolManager: string,
    private readonly bitmapMappingSlot: bigint,
    private readonly ticksMappingSlot: bigint,
    private readonly blockNumber: number,
  ) {}

  async getTick(tick: number): Promise<{ liquidityNet: string }> {
    const word = await readExtsload(
      this.provider,
      this.poolManager,
      tickInfoStorageSlot(this.ticksMappingSlot, tick),
      this.blockNumber,
    );
    const liquidityNet = BigInt.asIntN(128, word >> 128n);
    return { liquidityNet: liquidityNet.toString() };
  }

  async nextInitializedTickWithinOneWord(
    tick: number,
    lte: boolean,
    tickSpacing: number,
  ): Promise<[number, boolean]> {
    const compressed = Math.floor(tick / tickSpacing);
    if (lte) {
      const wordPosition = compressed >> 8;
      const bitPosition = compressed & 0xff;
      const bitmap = await this.getBitmap(wordPosition);
      const mask = (1n << BigInt(bitPosition + 1)) - 1n;
      const masked = bitmap & mask;
      const initialized = masked !== 0n;
      const next = initialized
        ? (compressed - (bitPosition - mostSignificantBit(masked))) * tickSpacing
        : (compressed - bitPosition) * tickSpacing;
      return [next, initialized];
    }

    const nextCompressed = compressed + 1;
    const wordPosition = nextCompressed >> 8;
    const bitPosition = nextCompressed & 0xff;
    const bitmap = await this.getBitmap(wordPosition);
    const mask = ((1n << 256n) - 1n) ^ ((1n << BigInt(bitPosition)) - 1n);
    const masked = bitmap & mask;
    const initialized = masked !== 0n;
    const next = initialized
      ? (nextCompressed + leastSignificantBit(masked) - bitPosition) * tickSpacing
      : (nextCompressed + (255 - bitPosition)) * tickSpacing;
    return [next, initialized];
  }

  private async getBitmap(wordPosition: number): Promise<bigint> {
    const cached = this.bitmapCache.get(wordPosition);
    if (cached !== undefined) {
      return cached;
    }
    const slot = tickBitmapStorageSlot(this.bitmapMappingSlot, wordPosition);
    const bitmap = await readExtsload(
      this.provider,
      this.poolManager,
      slot,
      this.blockNumber,
    );
    this.bitmapCache.set(wordPosition, bitmap);
    return bitmap;
  }
}

async function readExtsload(
  provider: JsonRpcProvider,
  poolManager: string,
  slot: bigint,
  blockNumber: number,
): Promise<bigint> {
  const result = await (provider as any).call(
    {
      to: poolManager,
      data: MANAGER.encodeFunctionData("extsload", [toWord(slot)]),
    },
    blockNumber,
  );
  return BigInt(result);
}

function mostSignificantBit(value: bigint): number {
  if (value <= 0n) {
    throw new ProtectedQuoteError("Tick bitmap unexpectedly contains no initialized tick.");
  }
  return value.toString(2).length - 1;
}

function getNextSqrtPriceFromInput(
  sqrtPriceX96: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  if (liquidity <= 0n) {
    throw new ProtectedQuoteError("Cannot calculate a swap step with zero liquidity.");
  }
  if (amountIn === 0n) return sqrtPriceX96;

  if (zeroForOne) {
    const numerator = liquidity << 96n;
    const product = amountIn * sqrtPriceX96;
    const denominator = numerator + product;
    if (denominator <= MAX_UINT256 && denominator >= numerator) {
      return mulDivRoundUp(numerator, sqrtPriceX96, denominator);
    }
    const fallbackDenominator = numerator / sqrtPriceX96 + amountIn;
    return numerator / fallbackDenominator +
      (numerator % fallbackDenominator === 0n ? 0n : 1n);
  }

  const quotient = (amountIn << 96n) / liquidity;
  const next = sqrtPriceX96 + quotient;
  if (next > MAX_UINT160) {
    throw new ProtectedQuoteError("Swap step exceeds the v4 sqrt-price range.");
  }
  return next;
}

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

function maxBigInt(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function leastSignificantBit(value: bigint): number {
  if (value <= 0n) {
    throw new ProtectedQuoteError("Tick bitmap unexpectedly contains no initialized tick.");
  }
  let bit = 0;
  while ((value & 1n) === 0n) {
    value >>= 1n;
    bit += 1;
  }
  return bit;
}

function toWord(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}
