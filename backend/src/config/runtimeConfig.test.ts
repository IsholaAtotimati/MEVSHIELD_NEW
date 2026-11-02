import assert from "node:assert/strict";
import test from "node:test";
import { Wallet } from "ethers";

import {
  EXPECTED_AUTHORIZED_SIGNER,
  EXPECTED_LOCAL_ROUTER,
  EXPECTED_LOCAL_SIGNER,
  EXPECTED_LOCAL_VERIFIER,
  EXPECTED_PROTECTED_POOL,
  EXPECTED_SEPOLIA_ROUTER,
  EXPECTED_SEPOLIA_VERIFIER,
  SEPOLIA_CHAIN_ID,
  assertConfiguredPoolId,
  isLocalChainEnabled,
  isLocalSepoliaDemoEnabled,
  loadBackendConfig,
  publicProtectedPoolConfig,
  validateProtectedPoolConfig,
} from "./runtimeConfig.js";

test("Sepolia demo signing is explicit and limited to local non-production backends", () => {
  assert.equal(
    isLocalSepoliaDemoEnabled({
      NODE_ENV: "development",
      MEVSHIELD_SEPOLIA_DEMO_ENABLED: "true",
    }),
    true,
  );
  assert.equal(
    isLocalSepoliaDemoEnabled({
      NODE_ENV: "production",
      MEVSHIELD_SEPOLIA_DEMO_ENABLED: "true",
    }),
    false,
  );
  assert.equal(
    isLocalSepoliaDemoEnabled({
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
      MEVSHIELD_SEPOLIA_DEMO_ENABLED: "true",
    }),
    false,
  );
  assert.equal(
    isLocalSepoliaDemoEnabled({
      NODE_ENV: "development",
      MEVSHIELD_SEPOLIA_DEMO_ENABLED: "false",
    }),
    false,
  );
});

test("local demo signing requires its explicit flag", () => {
  assert.equal(
    isLocalSepoliaDemoEnabled({
      NODE_ENV: "development",
    }),
    false,
  );
});

function makeBaseEnv() {
  const signerWallet = new Wallet("0x1111111111111111111111111111111111111111111111111111111111111111");
  const verifierAddress = "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f";
  const routerAddress = FIXTURE_ROUTER_ADDRESS;

  return {
    signerWallet,
    env: {
      CHAIN_ID: "11155111",
      SIGNER_PRIVATE_KEY: signerWallet.privateKey,
      POLICY_VERIFIER_ADDRESS: verifierAddress,
      ROUTER_ADDRESS: routerAddress,
      PROTECTED_POOL_CURRENCY0: EXPECTED_PROTECTED_POOL.currency0,
      PROTECTED_POOL_CURRENCY1: EXPECTED_PROTECTED_POOL.currency1,
      PROTECTED_POOL_FEE: String(EXPECTED_PROTECTED_POOL.fee),
      PROTECTED_POOL_TICK_SPACING: String(EXPECTED_PROTECTED_POOL.tickSpacing),
      PROTECTED_POOL_HOOK: EXPECTED_PROTECTED_POOL.hooks,
      PROTECTED_POOL_ID: EXPECTED_PROTECTED_POOL.poolId,
    },
  };
}

const FIXTURE_ROUTER_ADDRESS = "0xE57525678cbf6417F685727b77551316a3De3bba";

test("valid Sepolia config passes", () => {
  const { signerWallet, env } = makeBaseEnv();
  const config = loadBackendConfig(env, signerWallet.address, FIXTURE_ROUTER_ADDRESS);

  assert.equal(config.chainId, 11155111);
  assert.equal(config.verifierAddress.toLowerCase(), env.POLICY_VERIFIER_ADDRESS.toLowerCase());
  assert.equal(config.signerAddress.toLowerCase(), signerWallet.address.toLowerCase());
  assert.equal(config.routerAddress.toLowerCase(), env.ROUTER_ADDRESS.toLowerCase());
  assert.equal(
    config.protectedPool.currency0.toLowerCase(),
    EXPECTED_PROTECTED_POOL.currency0.toLowerCase(),
  );
  assert.equal(
    config.protectedPool.currency1.toLowerCase(),
    EXPECTED_PROTECTED_POOL.currency1.toLowerCase(),
  );
  assert.equal(config.protectedPool.fee, EXPECTED_PROTECTED_POOL.fee);
  assert.equal(config.protectedPool.tickSpacing, EXPECTED_PROTECTED_POOL.tickSpacing);
  assert.equal(
    config.protectedPool.hooks.toLowerCase(),
    EXPECTED_PROTECTED_POOL.hooks.toLowerCase(),
  );
  assert.equal(
    config.protectedPool.poolId.toLowerCase(),
    EXPECTED_PROTECTED_POOL.poolId.toLowerCase(),
  );
});

test("approved Sepolia router is accepted and normalized by default", () => {
  const { signerWallet, env } = makeBaseEnv();
  const config = loadBackendConfig({
    ...env,
    ROUTER_ADDRESS: EXPECTED_SEPOLIA_ROUTER.toLowerCase(),
  }, signerWallet.address);

  assert.equal(config.routerAddress, EXPECTED_SEPOLIA_ROUTER);
});

test("a different syntactically valid router is rejected by default", () => {
  const { signerWallet, env } = makeBaseEnv();

  assert.throws(
    () => loadBackendConfig(env, signerWallet.address),
    /does not match the approved Sepolia router/,
  );
});

test("ROUTER_ADDRESS alias accepts the approved router", () => {
  const { signerWallet, env } = makeBaseEnv();
  const config = loadBackendConfig({
    ...env,
    ROUTER_ADDRESS: EXPECTED_SEPOLIA_ROUTER,
    MEVSHIELD_ROUTER: undefined,
  }, signerWallet.address);

  assert.equal(config.routerAddress, EXPECTED_SEPOLIA_ROUTER);
});

test("MEVSHIELD_ROUTER fallback accepts the approved router", () => {
  const { signerWallet, env } = makeBaseEnv();
  const config = loadBackendConfig({
    ...env,
    ROUTER_ADDRESS: undefined,
    MEVSHIELD_ROUTER: EXPECTED_SEPOLIA_ROUTER,
  }, signerWallet.address);

  assert.equal(config.routerAddress, EXPECTED_SEPOLIA_ROUTER);
});

test("ROUTER_ADDRESS keeps precedence over the legacy alias", () => {
  const { signerWallet, env } = makeBaseEnv();
  const config = loadBackendConfig({
    ...env,
    ROUTER_ADDRESS: EXPECTED_SEPOLIA_ROUTER,
    MEVSHIELD_ROUTER: FIXTURE_ROUTER_ADDRESS,
  }, signerWallet.address);

  assert.equal(config.routerAddress, EXPECTED_SEPOLIA_ROUTER);
  assert.throws(
    () => loadBackendConfig({
      ...env,
      ROUTER_ADDRESS: FIXTURE_ROUTER_ADDRESS,
      MEVSHIELD_ROUTER: EXPECTED_SEPOLIA_ROUTER,
    }, signerWallet.address),
    /does not match the approved Sepolia router/,
  );
});

test("the exact protected pool configuration derives the expected Uniswap v4 pool ID", () => {
  const { env } = makeBaseEnv();
  const pool = validateProtectedPoolConfig(env, 11155111);
  assert.deepEqual(
    {
      ...pool,
      currency0: pool.currency0.toLowerCase(),
      currency1: pool.currency1.toLowerCase(),
      hooks: pool.hooks.toLowerCase(),
    },
    {
      ...EXPECTED_PROTECTED_POOL,
      currency0: EXPECTED_PROTECTED_POOL.currency0.toLowerCase(),
      currency1: EXPECTED_PROTECTED_POOL.currency1.toLowerCase(),
      hooks: EXPECTED_PROTECTED_POOL.hooks.toLowerCase(),
    },
  );
});

test("correct configured pool ID is accepted and a mismatched request pool ID is rejected", () => {
  const { env } = makeBaseEnv();
  const pool = validateProtectedPoolConfig(env, 11155111);
  assert.doesNotThrow(() => assertConfiguredPoolId(pool.poolId, pool));
  assert.throws(
    () => assertConfiguredPoolId(`0x${"11".repeat(32)}`, pool),
    /does not match the configured protected pool/,
  );
});

test("mismatched pool hook is rejected", () => {
  const { env } = makeBaseEnv();
  assert.throws(
    () => validateProtectedPoolConfig({ ...env, PROTECTED_POOL_HOOK: "0x1111111111111111111111111111111111111111" }, 11155111),
    /does not match the configured protected-pool key/,
  );
});

test("incorrect currency ordering is rejected", () => {
  const { env } = makeBaseEnv();
  assert.throws(
    () => validateProtectedPoolConfig({
      ...env,
      PROTECTED_POOL_CURRENCY0: EXPECTED_PROTECTED_POOL.currency1,
      PROTECTED_POOL_CURRENCY1: EXPECTED_PROTECTED_POOL.currency0,
    }, 11155111),
    /ascending address order/,
  );
});

test("incorrect fee and tick spacing are rejected", () => {
  const { env } = makeBaseEnv();
  assert.throws(
    () => validateProtectedPoolConfig({ ...env, PROTECTED_POOL_FEE: "500" }, 11155111),
    /does not match the configured protected-pool key/,
  );
  assert.throws(
    () => validateProtectedPoolConfig({ ...env, PROTECTED_POOL_TICK_SPACING: "10" }, 11155111),
    /does not match the configured protected-pool key/,
  );
});

test("invalid, missing, and wrong-chain protected pool configurations are rejected", () => {
  const { env } = makeBaseEnv();
  assert.throws(
    () => validateProtectedPoolConfig({ ...env, PROTECTED_POOL_HOOK: "not-an-address" }, 11155111),
    /valid Ethereum address/,
  );
  const missingPoolId: NodeJS.ProcessEnv = { ...env };
  delete missingPoolId.PROTECTED_POOL_ID;
  assert.throws(
    () => validateProtectedPoolConfig(missingPoolId, 11155111),
    /PROTECTED_POOL_ID is required/,
  );
  assert.throws(
    () => validateProtectedPoolConfig(env, 1),
    /only valid for Sepolia/,
  );
});

test("valid configuration does not claim the pool is initialized or liquid", () => {
  const { env } = makeBaseEnv();
  const pool = validateProtectedPoolConfig(env, 11155111);
  const publicConfig = publicProtectedPoolConfig(11155111, pool);
  assert.equal(publicConfig.configurationStatus, "valid");
  assert.equal(publicConfig.poolReadiness, "not-checked");
  assert.equal("initialized" in publicConfig, false);
  assert.equal("liquidity" in publicConfig, false);
});

test("malformed verifier address is rejected", () => {
  const { env } = makeBaseEnv();
  const invalidEnv = { ...env, POLICY_VERIFIER_ADDRESS: "x9DF6c29bD323B61f83f1D3214041bf08f1267544" };

  assert.throws(
    () => loadBackendConfig(invalidEnv, EXPECTED_AUTHORIZED_SIGNER, FIXTURE_ROUTER_ADDRESS),
    /Invalid verifier configuration/,
  );
});

test("incorrect but syntactically valid verifier address is rejected in production", () => {
  const { env } = makeBaseEnv();
  const otherValid = "0x1111111111111111111111111111111111111111";
  const invalidEnv = { ...env, POLICY_VERIFIER_ADDRESS: otherValid };

  assert.throws(
    () => loadBackendConfig(invalidEnv, EXPECTED_AUTHORIZED_SIGNER, FIXTURE_ROUTER_ADDRESS),
    /Expected Sepolia PolicyVerifier/,
  );
});

test("incorrect chain ID is rejected in Sepolia production mode", () => {
  const { env } = makeBaseEnv();
  const invalidEnv = { ...env, CHAIN_ID: "1" };

  assert.throws(
    () => loadBackendConfig(invalidEnv, EXPECTED_AUTHORIZED_SIGNER, FIXTURE_ROUTER_ADDRESS),
    /CHAIN_ID must be 11155111/,
  );
});

test("signer key is optional when signing is disabled", () => {
  const { env } = makeBaseEnv();
  const envWithoutSigner: NodeJS.ProcessEnv = { ...env };
  delete envWithoutSigner.SIGNER_PRIVATE_KEY;

  const config = loadBackendConfig(
    envWithoutSigner,
    EXPECTED_AUTHORIZED_SIGNER,
    FIXTURE_ROUTER_ADDRESS,
    { requireSigner: false },
  );

  assert.equal(config.signerWallet, undefined);
  assert.equal(config.signerAddress, undefined);
  assert.equal(config.chainId, 11155111);
});

test("signer mismatch is rejected before signing", () => {
  const { env } = makeBaseEnv();
  const otherWallet = new Wallet("0x2222222222222222222222222222222222222222222222222222222222222222");
  const invalidEnv = { ...env, SIGNER_PRIVATE_KEY: otherWallet.privateKey };

  assert.throws(
    () => loadBackendConfig(invalidEnv, EXPECTED_AUTHORIZED_SIGNER, FIXTURE_ROUTER_ADDRESS),
    /authorized signer/i,
  );
});

test("validation errors do not echo the signer private key", () => {
  const { env } = makeBaseEnv();
  const secretKey = "0x" + "3".repeat(64);
  const invalidEnv = { ...env, SIGNER_PRIVATE_KEY: secretKey };

  assert.throws(
    () => loadBackendConfig(invalidEnv, EXPECTED_AUTHORIZED_SIGNER, FIXTURE_ROUTER_ADDRESS),
    (error: unknown) => {
      const message = String(error);
      return message.includes("authorized signer") && !message.includes(secretKey);
    },
  );
});

// ---------------------------------------------------------------------------
// Local Docker chain (anvil, 31337)
//
// The local allowance must never be reachable from a production configuration,
// and the Sepolia pin must keep rejecting a local chain when the gate is shut.
// ---------------------------------------------------------------------------

const LOCAL_ENV_BASE = {
  NODE_ENV: "development",
  MEVSHIELD_LOCAL_CHAIN_ENABLED: "true",
  CHAIN_ID: "31337",
  // DeployLocal installs signer 0xA11CE on the local verifier.
  SIGNER_PRIVATE_KEY:
    "0x00000000000000000000000000000000000000000000000000000000000a11ce",
  POLICY_VERIFIER_ADDRESS: EXPECTED_LOCAL_VERIFIER,
  ROUTER_ADDRESS: EXPECTED_LOCAL_ROUTER,
  // Locally deployed mock tokens from SetupBackendSwap; addresses sort ascending.
  PROTECTED_POOL_CURRENCY0: "0x610178da211fef7d417bc0e6fed39f05609ad788",
  PROTECTED_POOL_CURRENCY1: "0xb7f8bc63bbcad18155201308c8f3540b07f84f5e",
  PROTECTED_POOL_FEE: "3000",
  PROTECTED_POOL_TICK_SPACING: "60",
  PROTECTED_POOL_HOOK: "0x1e2f391574556815ae705895f2728543a7ad4080",
  PROTECTED_POOL_ID:
    "0x8d754c8c3f0e991efb877b18bf00b8d0718c2cd8af8f31a35c61de1415e19bf0",
} as const;

test("local chain gate requires the explicit flag, non-production, and no Railway marker", () => {
  assert.equal(
    isLocalChainEnabled({ MEVSHIELD_LOCAL_CHAIN_ENABLED: "true", NODE_ENV: "development" }),
    true,
  );
  assert.equal(
    isLocalChainEnabled({ MEVSHIELD_LOCAL_CHAIN_ENABLED: "true", NODE_ENV: "production" }),
    false,
  );
  assert.equal(
    isLocalChainEnabled({
      MEVSHIELD_LOCAL_CHAIN_ENABLED: "true",
      NODE_ENV: "development",
      RAILWAY_ENVIRONMENT_NAME: "production",
    }),
    false,
  );
  assert.equal(isLocalChainEnabled({ NODE_ENV: "development" }), false);
  assert.equal(
    isLocalChainEnabled({ MEVSHIELD_LOCAL_CHAIN_ENABLED: "1", NODE_ENV: "development" }),
    false,
  );
});

test("a local chain 31337 configuration is accepted only with the gate open", () => {
  const config = loadBackendConfig({ ...LOCAL_ENV_BASE });

  assert.equal(config.chainId, 31337);
  assert.equal(config.verifierAddress, EXPECTED_LOCAL_VERIFIER);
  assert.equal(config.routerAddress, EXPECTED_LOCAL_ROUTER);
  assert.equal(config.signerAddress, EXPECTED_LOCAL_SIGNER);
  assert.equal(
    config.protectedPool.poolId,
    LOCAL_ENV_BASE.PROTECTED_POOL_ID,
  );

  // Same values with the gate shut must still be rejected by the Sepolia pin.
  assert.throws(
    () => loadBackendConfig({ ...LOCAL_ENV_BASE, MEVSHIELD_LOCAL_CHAIN_ENABLED: "false" }),
    /CHAIN_ID must be 11155111/,
  );
  assert.throws(
    () => loadBackendConfig({ ...LOCAL_ENV_BASE, NODE_ENV: "production" }),
    /CHAIN_ID must be 11155111/,
  );
});

test("the local chain rejects the Sepolia deployment addresses", () => {
  assert.throws(
    () => loadBackendConfig({ ...LOCAL_ENV_BASE, POLICY_VERIFIER_ADDRESS: EXPECTED_SEPOLIA_VERIFIER }),
    /Expected local PolicyVerifier/,
  );
  assert.throws(
    () => loadBackendConfig({ ...LOCAL_ENV_BASE, ROUTER_ADDRESS: EXPECTED_SEPOLIA_ROUTER }),
    /does not match the approved local router/,
  );
});

test("the local chain rejects an arbitrary signer key", () => {
  const otherKey = "0x2222222222222222222222222222222222222222222222222222222222222222";
  assert.throws(
    () => loadBackendConfig({ ...LOCAL_ENV_BASE, SIGNER_PRIVATE_KEY: otherKey }),
    /authorized signer/,
  );
});

test("the local chain rejects a pool id that does not match its pool key", () => {
  assert.throws(
    () => loadBackendConfig({
      ...LOCAL_ENV_BASE,
      PROTECTED_POOL_ID: `0x${"22".repeat(32)}`,
    }),
    /does not match the configured protected-pool key/,
  );
});

test("the local chain still requires ascending currency order", () => {
  assert.throws(
    () => loadBackendConfig({
      ...LOCAL_ENV_BASE,
      PROTECTED_POOL_CURRENCY0: LOCAL_ENV_BASE.PROTECTED_POOL_CURRENCY1,
      PROTECTED_POOL_CURRENCY1: LOCAL_ENV_BASE.PROTECTED_POOL_CURRENCY0,
    }),
    /ascending address order/,
  );
});

test("unpinned pool validation cannot be opened for a non-local chain", () => {
  assert.throws(
    () => validateProtectedPoolConfig(
      {
        PROTECTED_POOL_CURRENCY0: LOCAL_ENV_BASE.PROTECTED_POOL_CURRENCY0,
        PROTECTED_POOL_CURRENCY1: LOCAL_ENV_BASE.PROTECTED_POOL_CURRENCY1,
        PROTECTED_POOL_FEE: LOCAL_ENV_BASE.PROTECTED_POOL_FEE,
        PROTECTED_POOL_TICK_SPACING: LOCAL_ENV_BASE.PROTECTED_POOL_TICK_SPACING,
        PROTECTED_POOL_HOOK: LOCAL_ENV_BASE.PROTECTED_POOL_HOOK,
        PROTECTED_POOL_ID: LOCAL_ENV_BASE.PROTECTED_POOL_ID,
      },
      SEPOLIA_CHAIN_ID,
      { allowUnpinnedPool: true },
    ),
    /only valid for the local chain ID 31337/,
  );
});

test("the Sepolia pin is unchanged when the local gate is closed", () => {
  const { signerWallet, env } = makeBaseEnv();
  const config = loadBackendConfig(env, signerWallet.address, FIXTURE_ROUTER_ADDRESS);
  assert.equal(config.chainId, SEPOLIA_CHAIN_ID);
  assert.equal(config.routerAddress.toLowerCase(), FIXTURE_ROUTER_ADDRESS.toLowerCase());

  // A local deployment address in a Sepolia configuration is still refused.
  assert.throws(
    () => loadBackendConfig({ ...env, POLICY_VERIFIER_ADDRESS: EXPECTED_LOCAL_VERIFIER }),
    /Expected Sepolia PolicyVerifier/,
  );
});
