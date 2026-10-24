import { AbiCoder, Wallet, getAddress, isAddress, keccak256 } from "ethers";
export const SEPOLIA_CHAIN_ID = 11155111;
export const EXPECTED_AUTHORIZED_SIGNER = "0x016B78a30CE176EF0B90c122e8677e13aAB2A815";
export const EXPECTED_SEPOLIA_VERIFIER = "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f";
export const EXPECTED_SEPOLIA_ROUTER = "0x633282608B2fc66cD7572f5eF58e804063aa150D";
export const EXPECTED_PROTECTED_POOL = {
    currency0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    currency1: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    fee: 3000,
    tickSpacing: 60,
    hooks: "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080",
    poolId: "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602",
};
const PROTECTED_POOL_KEY_ABI = "tuple(address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks)";
function requiredValue(value, name) {
    const configured = value?.trim();
    if (!configured) {
        throw new Error(`${name} is required for protected-pool configuration.`);
    }
    return configured;
}
function configuredAddress(value, name) {
    const configured = requiredValue(value, name);
    if (!isAddress(configured)) {
        throw new Error(`${name} must be a valid Ethereum address.`);
    }
    return getAddress(configured);
}
function configuredInteger(value, name) {
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
export function validateProtectedPoolConfig(env, chainId) {
    const currency0 = configuredAddress(env.PROTECTED_POOL_CURRENCY0, "PROTECTED_POOL_CURRENCY0");
    const currency1 = configuredAddress(env.PROTECTED_POOL_CURRENCY1, "PROTECTED_POOL_CURRENCY1");
    const fee = configuredInteger(env.PROTECTED_POOL_FEE, "PROTECTED_POOL_FEE");
    const tickSpacing = configuredInteger(env.PROTECTED_POOL_TICK_SPACING, "PROTECTED_POOL_TICK_SPACING");
    const hooks = configuredAddress(env.PROTECTED_POOL_HOOK, "PROTECTED_POOL_HOOK");
    const configuredPoolId = requiredValue(env.PROTECTED_POOL_ID, "PROTECTED_POOL_ID");
    if (chainId !== SEPOLIA_CHAIN_ID) {
        throw new Error("Protected-pool configuration is only valid for Sepolia chain ID 11155111.");
    }
    if (BigInt(currency0) >= BigInt(currency1)) {
        throw new Error("Protected-pool currencies must be in ascending address order.");
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(configuredPoolId)) {
        throw new Error("PROTECTED_POOL_ID must be a 32-byte hexadecimal pool ID.");
    }
    const poolKey = { currency0, currency1, fee, tickSpacing, hooks };
    const derivedPoolId = keccak256(AbiCoder.defaultAbiCoder().encode([PROTECTED_POOL_KEY_ABI], [poolKey]));
    if (derivedPoolId.toLowerCase() !== configuredPoolId.toLowerCase()) {
        throw new Error("PROTECTED_POOL_ID does not match the configured protected-pool key.");
    }
    const matchesExpected = currency0.toLowerCase() === EXPECTED_PROTECTED_POOL.currency0.toLowerCase() &&
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
export function assertConfiguredPoolId(requestedPoolId, protectedPool) {
    if (requestedPoolId.toLowerCase() !== protectedPool.poolId.toLowerCase()) {
        throw new Error("Requested pool ID does not match the configured protected pool.");
    }
}
export function publicProtectedPoolConfig(chainId, protectedPool) {
    return {
        configurationStatus: "valid",
        poolReadiness: "not-checked",
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
export function firstConfigured(...values) {
    return values.find((value) => value && value.trim())?.trim();
}
export function isLocalSepoliaDemoEnabled(env) {
    return (env.MEVSHIELD_SEPOLIA_DEMO_ENABLED === "true" &&
        env.NODE_ENV !== "production" &&
        !env.RAILWAY_ENVIRONMENT_NAME);
}
export function loadBackendConfig(env = process.env, expectedSignerAddress = EXPECTED_AUTHORIZED_SIGNER, expectedRouterAddress = EXPECTED_SEPOLIA_ROUTER) {
    const chainIdValue = Number(firstConfigured(env.CHAIN_ID));
    if (Number.isNaN(chainIdValue)) {
        throw new Error("CHAIN_ID must be set to 11155111 for the Sepolia deployment.");
    }
    if (chainIdValue !== SEPOLIA_CHAIN_ID) {
        throw new Error("CHAIN_ID must be 11155111 for the Sepolia deployment.");
    }
    const protectedPool = validateProtectedPoolConfig(env, chainIdValue);
    const verifierAddress = firstConfigured(env.POLICY_VERIFIER_ADDRESS, env.VERIFIER_ADDRESS, env.POLICY_VERIFIER);
    if (!verifierAddress || !isAddress(verifierAddress)) {
        throw new Error(`Invalid verifier configuration. Expected Sepolia PolicyVerifier ${EXPECTED_SEPOLIA_VERIFIER}.`);
    }
    if (getAddress(verifierAddress).toLowerCase() !== EXPECTED_SEPOLIA_VERIFIER.toLowerCase()) {
        throw new Error(`Invalid verifier configuration. Expected Sepolia PolicyVerifier ${EXPECTED_SEPOLIA_VERIFIER}.`);
    }
    const signerPrivateKey = env.SIGNER_PRIVATE_KEY?.trim();
    if (!signerPrivateKey) {
        throw new Error("SIGNER_PRIVATE_KEY is required for policy signing.");
    }
    let signerWallet;
    try {
        signerWallet = new Wallet(signerPrivateKey);
    }
    catch {
        throw new Error("SIGNER_PRIVATE_KEY is invalid.");
    }
    const signerAddress = signerWallet.address.toLowerCase();
    const expectedSigner = expectedSignerAddress.toLowerCase();
    if (signerAddress !== expectedSigner) {
        throw new Error(`Configured SIGNER_PRIVATE_KEY does not match the authorized signer ${expectedSignerAddress}.`);
    }
    const routerAddress = firstConfigured(env.ROUTER_ADDRESS, env.MEVSHIELD_ROUTER);
    if (!routerAddress || !isAddress(routerAddress)) {
        throw new Error("MEVSHIELD_ROUTER is not configured or is not a valid address.");
    }
    const normalizedRouterAddress = getAddress(routerAddress);
    if (normalizedRouterAddress.toLowerCase() !== expectedRouterAddress.toLowerCase()) {
        throw new Error(`Configured router does not match the approved Sepolia router ${expectedRouterAddress}.`);
    }
    return {
        chainId: chainIdValue,
        verifierAddress: getAddress(verifierAddress),
        signerWallet,
        signerAddress: getAddress(signerWallet.address),
        routerAddress: normalizedRouterAddress,
        protectedPool,
    };
}
