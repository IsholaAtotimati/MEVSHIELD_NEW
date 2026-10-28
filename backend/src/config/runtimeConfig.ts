import { AbiCoder, Wallet, getAddress, isAddress, keccak256 } from "ethers";

import {
  firstConfigured,
  resolveRouterAddress,
  resolveVerifierAddress,
} from "./env.js";

export const SEPOLIA_CHAIN_ID = 11155111;
export const EXPECTED_AUTHORIZED_SIGNER =
  "0x016B78a30CE176EF0B90c122e8677e13aAB2A815";
export const EXPECTED_SEPOLIA_VERIFIER =
  "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f";
export const EXPECTED_SEPOLIA_ROUTER =
  "0x633282608B2fc66cD7572f5eF58e804063aa150D";

/**
 * Local Docker chain (anvil). Only reachable when `isLocalChainEnabled` is
 * true, which requires an explicit opt-in flag plus a non-production runtime.
 * See `docs/runbook/local-docker.md`.
 */
export const LOCAL_CHAIN_ID = 31337;

/**
 * Deterministic addresses produced by `script/DeployLocal.s.sol` from a fresh
 * anvil state. Pinning them keeps the local path fail-closed: a deploy that
 * drifts from this expectation stops the stack instead of silently pointing
 * the backend at a different contract.
 */
export const EXPECTED_LOCAL_SIGNER =
  "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7";
export const EXPECTED_LOCAL_VERIFIER =
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";
export const EXPECTED_LOCAL_ROUTER =
  "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318";

export const EXPECTED_PROTECTED_POOL = {
  currency0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  currency1: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
  fee: 3000,
  tickSpacing: 60,
  hooks: "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080",
  poolId: "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602",
} as const;

export type ProtectedPoolConfig = {
  currency0: string;
  currency1: string;
  fee: number;
  tickSpacing: number;
  hooks: string;
  poolId: string;
};

export type ProtectedPoolValidationOptions = {
  /**
   * Accept a structurally valid pool on the local chain instead of requiring
   * the pinned Sepolia WETH/USDC pool. Only ever set by `loadBackendConfig`
   * after the local chain gate has already passed.
   */
  allowUnpinnedPool?: boolean;
};

const PROTECTED_POOL_KEY_ABI =
  "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";

function requiredValue(value: string | undefined, name: string): string {
  const configured = value?.trim();
  if (!configured) {
    throw new Error(`${name} is required for protected-pool configuration.`);
  }
  return configured;
}

function configuredAddress(value: string | undefined, name: string): string {
  const configured = requiredValue(value, name);
  if (!isAddress(configured)) {
    throw new Error(`${name} must be a valid Ethereum address.`);
  }
  return getAddress(configured);
}

function configuredInteger(value: string | undefined, name: string): number {
  const configured = requiredValue(value, name);
  if (!/^\d+$/.test(configured)) {
    throw new Error(`${name} must be a non-negative integer.`);
  }
  const parsed = Number(configured);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${name} must be a safe integer.`);
  }
  return parsed;
}

export function validateProtectedPoolConfig(
  env: NodeJS.ProcessEnv,
  chainId: number,
  options: ProtectedPoolValidationOptions = {},
): ProtectedPoolConfig {
  const allowUnpinnedPool = options.allowUnpinnedPool === true;
  const currency0 = configuredAddress(env.PROTECTED_POOL_CURRENCY0, "PROTECTED_POOL_CURRENCY0");
  const currency1 = configuredAddress(env.PROTECTED_POOL_CURRENCY1, "PROTECTED_POOL_CURRENCY1");
  const fee = configuredInteger(env.PROTECTED_POOL_FEE, "PROTECTED_POOL_FEE");
  const tickSpacing = configuredInteger(
    env.PROTECTED_POOL_TICK_SPACING,
    "PROTECTED_POOL_TICK_SPACING",
  );
  const hooks = configuredAddress(env.PROTECTED_POOL_HOOK, "PROTECTED_POOL_HOOK");
  const configuredPoolId = requiredValue(env.PROTECTED_POOL_ID, "PROTECTED_POOL_ID");

  if (allowUnpinnedPool) {
    // The local chain is a structural check only. The Sepolia identity pin is
    // deliberately not applied, but every internal consistency rule still is.
    if (chainId !== LOCAL_CHAIN_ID) {
      throw new Error(
        "Unpinned protected-pool configuration is only valid for the local chain ID 31337.",
      );
    }
  } else if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Protected-pool configuration is only valid for Sepolia chain ID 11155111.");
  }
  if (BigInt(currency0) >= BigInt(currency1)) {
    throw new Error("Protected-pool currencies must be in ascending address order.");
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(configuredPoolId)) {
    throw new Error("PROTECTED_POOL_ID must be a 32-byte hexadecimal pool ID.");
  }

  const poolKey = { currency0, currency1, fee, tickSpacing, hooks };
  const derivedPoolId = keccak256(
    AbiCoder.defaultAbiCoder().encode([PROTECTED_POOL_KEY_ABI], [poolKey]),
  );
  if (derivedPoolId.toLowerCase() !== configuredPoolId.toLowerCase()) {
    throw new Error("PROTECTED_POOL_ID does not match the configured protected-pool key.");
  }

  if (allowUnpinnedPool) {
    return { ...poolKey, poolId: derivedPoolId };
  }

  const matchesExpected =
    currency0.toLowerCase() === EXPECTED_PROTECTED_POOL.currency0.toLowerCase() &&
    currency1.toLowerCase() === EXPECTED_PROTECTED_POOL.currency1.toLowerCase() &&
    fee === EXPECTED_PROTECTED_POOL.fee &&
    tickSpacing === EXPECTED_PROTECTED_POOL.tickSpacing &&
    hooks.toLowerCase() === EXPECTED_PROTECTED_POOL.hooks.toLowerCase() &&
    derivedPoolId.toLowerCase() === EXPECTED_PROTECTED_POOL.poolId.toLowerCase();
  if (!matchesExpected) {
    throw new Error("Protected-pool configuration does not match the approved Sepolia WETH/USDC pool.");
  }

  return { ...poolKey, poolId: derivedPoolId };
}

export function assertConfiguredPoolId(
  requestedPoolId: string,
  protectedPool: ProtectedPoolConfig,
): void {
  if (requestedPoolId.toLowerCase() !== protectedPool.poolId.toLowerCase()) {
    throw new Error("Requested pool ID does not match the configured protected pool.");
  }
}

export function publicProtectedPoolConfig(
  chainId: number,
  protectedPool: ProtectedPoolConfig,
) {
  return {
    configurationStatus: "valid" as const,
    poolReadiness: "not-checked" as const,
    chainId,
    poolKey: {
      currency0: protectedPool.currency0,
      currency1: protectedPool.currency1,
      fee: protectedPool.fee,
      tickSpacing: protectedPool.tickSpacing,
      hooks: protectedPool.hooks,
    },
    poolId: protectedPool.poolId,
  };
}

/**
 * Re-exported so the historic import path keeps working.
 * @deprecated Import from `./env.js` instead.
 */
export { firstConfigured };

export function isLocalSepoliaDemoEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.MEVSHIELD_SEPOLIA_DEMO_ENABLED === "true" &&
    env.NODE_ENV !== "production" &&
    !env.RAILWAY_ENVIRONMENT_NAME
  );
}

/**
 * Local-chain gate for the Docker stack.
 *
 * Three independent conditions must hold, and the production pin is never
 * widened: `MEVSHIELD_LOCAL_CHAIN_ENABLED` must be the literal `"true"`,
 * `NODE_ENV` must not be `production`, and no Railway environment marker may be
 * present. Railway deploys therefore cannot reach this path even if the flag
 * were set by mistake, and the production image defaults to `NODE_ENV=production`.
 */
export function isLocalChainEnabled(env: NodeJS.ProcessEnv): boolean {
  return (
    env.MEVSHIELD_LOCAL_CHAIN_ENABLED === "true" &&
    env.NODE_ENV !== "production" &&
    !env.RAILWAY_ENVIRONMENT_NAME
  );
}

export type BackendChainExpectations = {
  signer: string;
  verifier: string;
  router: string;
  isLocal: boolean;
};

/**
 * Resolves which deployment the backend is pinned to. Sepolia stays the
 * default; the local set is only returned when the explicit gate is open.
 */
export function resolveChainExpectations(
  env: NodeJS.ProcessEnv,
): BackendChainExpectations {
  if (isLocalChainEnabled(env)) {
    return {
      signer: EXPECTED_LOCAL_SIGNER,
      verifier: EXPECTED_LOCAL_VERIFIER,
      router: EXPECTED_LOCAL_ROUTER,
      isLocal: true,
    };
  }
  return {
    signer: EXPECTED_AUTHORIZED_SIGNER,
    verifier: EXPECTED_SEPOLIA_VERIFIER,
    router: EXPECTED_SEPOLIA_ROUTER,
    isLocal: false,
  };
}

export type LoadBackendConfigOptions = {
  requireSigner?: boolean;
};

export function loadBackendConfig(
  env: NodeJS.ProcessEnv = process.env,
  expectedSignerAddress = EXPECTED_AUTHORIZED_SIGNER,
  expectedRouterAddress = EXPECTED_SEPOLIA_ROUTER,
  options: LoadBackendConfigOptions = {},
) {
  const requireSigner = options.requireSigner ?? true;
  const localChain = isLocalChainEnabled(env);
  const chainExpectations = resolveChainExpectations(env);
  const effectiveSigner = localChain
    ? EXPECTED_LOCAL_SIGNER
    : expectedSignerAddress;
  const effectiveRouter = localChain
    ? EXPECTED_LOCAL_ROUTER
    : expectedRouterAddress;
  const chainIdValue = Number(firstConfigured(env.CHAIN_ID));

  if (Number.isNaN(chainIdValue)) {
    throw new Error(
      localChain
        ? "CHAIN_ID must be set to 31337 for the local Docker deployment."
        : "CHAIN_ID must be set to 11155111 for the Sepolia deployment.",
    );
  }

  if (localChain) {
    if (chainIdValue !== LOCAL_CHAIN_ID) {
      throw new Error(
        "CHAIN_ID must be 31337 when MEVSHIELD_LOCAL_CHAIN_ENABLED=true.",
      );
    }
  } else if (chainIdValue !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      "CHAIN_ID must be 11155111 for the Sepolia deployment.",
    );
  }

  const protectedPool = validateProtectedPoolConfig(env, chainIdValue, {
    allowUnpinnedPool: localChain,
  });

  const verifierAddress = resolveVerifierAddress(env);

  const verifierExpectation = chainExpectations.verifier;

  if (!verifierAddress || !isAddress(verifierAddress)) {
    throw new Error(
      `Invalid verifier configuration. Expected ${localChain ? "local" : "Sepolia"} PolicyVerifier ${verifierExpectation}.`,
    );
  }

  if (getAddress(verifierAddress).toLowerCase() !== verifierExpectation.toLowerCase()) {
    throw new Error(
      `Invalid verifier configuration. Expected ${localChain ? "local" : "Sepolia"} PolicyVerifier ${verifierExpectation}.`,
    );
  }

  let signerWallet: Wallet | undefined;
  if (requireSigner) {
    const signerPrivateKey = env.SIGNER_PRIVATE_KEY?.trim();
    if (!signerPrivateKey) {
      throw new Error("SIGNER_PRIVATE_KEY is required for policy signing.");
    }

    try {
      signerWallet = new Wallet(signerPrivateKey);
    } catch {
      throw new Error("SIGNER_PRIVATE_KEY is invalid.");
    }
    const signerAddress = signerWallet.address.toLowerCase();
    const expectedSigner = effectiveSigner.toLowerCase();

    if (signerAddress !== expectedSigner) {
      throw new Error(
        `Configured SIGNER_PRIVATE_KEY does not match the authorized signer ${effectiveSigner}.`,
      );
    }
  }

  const routerAddress = resolveRouterAddress(env);

  if (!routerAddress || !isAddress(routerAddress)) {
    throw new Error("MEVSHIELD_ROUTER is not configured or is not a valid address.");
  }
  const normalizedRouterAddress = getAddress(routerAddress);
  if (normalizedRouterAddress.toLowerCase() !== effectiveRouter.toLowerCase()) {
    throw new Error(
      `Configured router does not match the approved ${localChain ? "local" : "Sepolia"} router ${effectiveRouter}.`,
    );
  }

  return {
    chainId: chainIdValue,
    verifierAddress: getAddress(verifierAddress),
    signerWallet,
    signerAddress: signerWallet
      ? getAddress(signerWallet.address)
      : undefined,
    routerAddress: normalizedRouterAddress,
    protectedPool,
  };
}
