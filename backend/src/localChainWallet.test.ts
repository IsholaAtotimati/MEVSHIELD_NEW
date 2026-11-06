import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import test from "node:test";
import { verifyTypedData } from "ethers";

import {
  EXPECTED_LOCAL_ROUTER,
  EXPECTED_LOCAL_VERIFIER,
  LOCAL_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  loadBackendConfig,
} from "./config/runtimeConfig.js";
import { POLICY_TYPES, policyDomain } from "./policy/eip712.js";
import { MIN_SQRT_PRICE_LIMIT_X96 } from "./policy/policyRequest.js";
import {
  allowedFrontendOrigins,
  createApp,
  resolvePolicySigningEnabled,
  type AppDependencies,
} from "./server.js";

/**
 * The env block `script/local-test-flow.sh` passes to the demo-signing
 * backend. The connected anvil account talks to this process, not to the
 * published Sepolia backend.
 */
const LOCAL_SCRIPT_ENV = {
  NODE_ENV: "development",
  MEVSHIELD_LOCAL_CHAIN_ENABLED: "true",
  MEVSHIELD_V2_POLICY_ENABLED: "true",
  MEVSHIELD_SEPOLIA_DEMO_ENABLED: "true",
  CHAIN_ID: "31337",
  SIGNER_PRIVATE_KEY:
    "0x00000000000000000000000000000000000000000000000000000000000a11ce",
  POLICY_VERIFIER_ADDRESS: EXPECTED_LOCAL_VERIFIER,
  ROUTER_ADDRESS: EXPECTED_LOCAL_ROUTER,
  PROTECTED_POOL_CURRENCY0: "0x610178da211fef7d417bc0e6fed39f05609ad788",
  PROTECTED_POOL_CURRENCY1: "0xb7f8bc63bbcad18155201308c8f3540b07f84f5e",
  PROTECTED_POOL_FEE: "3000",
  PROTECTED_POOL_TICK_SPACING: "60",
  PROTECTED_POOL_HOOK: "0x1e2f391574556815ae705895f2728543a7ad4080",
  PROTECTED_POOL_ID:
    "0x8d754c8c3f0e991efb877b18bf00b8d0718c2cd8af8f31a35c61de1415e19bf0",
  FRONTEND_URL: "http://localhost:5402",
} as const;

const ANVIL_ACCOUNT_0 = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function futureExpiry(secondsFromNow = 300): string {
  return String(Math.floor(Date.now() / 1000) + secondsFromNow);
}

function localApp(): {
  app: ReturnType<typeof createApp>;
  deps: AppDependencies;
} {
  const config = loadBackendConfig({ ...LOCAL_SCRIPT_ENV });
  assert.ok(config.signerWallet);
  const deps: AppDependencies = {
    chainId: config.chainId,
    verifierAddress: config.verifierAddress,
    routerAddress: config.routerAddress,
    protectedPool: config.protectedPool,
    policySigningEnabled: resolvePolicySigningEnabled({ ...LOCAL_SCRIPT_ENV }),
    localDemoMode: true,
    signerWallet: config.signerWallet,
    getMonitorStatus: () => ({ status: "disabled", lastCheckedBlock: 0 }),
    readPoolState: async () => ({
      sqrtPriceX96: 1n << 96n,
      liquidity: 10n ** 30n,
      feePips: 3000n,
    }),
    frontendUrl: LOCAL_SCRIPT_ENV.FRONTEND_URL,
  };
  return { app: createApp(deps), deps };
}

function localPolicyBody(
  deps: AppDependencies,
  overrides: Record<string, unknown> = {},
) {
  return {
    poolId: deps.protectedPool.poolId,
    trader: deps.routerAddress,
    nonce: "1",
    expiry: futureExpiry(),
    amountSpecified: "-1000000",
    zeroForOne: true,
    sqrtPriceLimitX96: String(MIN_SQRT_PRICE_LIMIT_X96 + 1n),
    minAmountOut: "1",
    ...overrides,
  };
}

async function requestJson(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = (await response.json()) as Record<string, unknown>;
    return { status: response.status, json, headers: response.headers };
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function typedPolicy(policy: Record<string, unknown>) {
  return {
    poolId: String(policy.poolId),
    trader: String(policy.trader),
    nonce: BigInt(String(policy.nonce)),
    expiry: BigInt(String(policy.expiry)),
    maxLoss: BigInt(String(policy.maxLoss)),
    maxFee: BigInt(String(policy.maxFee)),
    zeroForOne: policy.zeroForOne === true,
    amountSpecified: BigInt(String(policy.amountSpecified)),
    sqrtPriceLimitX96: BigInt(String(policy.sqrtPriceLimitX96)),
    minAmountOut: BigInt(String(policy.minAmountOut)),
  };
}

test("the local-test backend env is chain 31337 and will not start as Sepolia or chain 1", () => {
  const config = loadBackendConfig({ ...LOCAL_SCRIPT_ENV });
  assert.equal(config.chainId, LOCAL_CHAIN_ID);
  assert.equal(config.routerAddress, EXPECTED_LOCAL_ROUTER);
  assert.equal(config.verifierAddress, EXPECTED_LOCAL_VERIFIER);
  assert.equal(resolvePolicySigningEnabled({ ...LOCAL_SCRIPT_ENV }), true);
  // The v2 flag still enables signing in production. The demo flag does not.
  assert.equal(
    resolvePolicySigningEnabled({
      NODE_ENV: "production",
      MEVSHIELD_SEPOLIA_DEMO_ENABLED: "true",
    }),
    false,
  );

  for (const chainId of ["1", "11155111", "", "31337x"]) {
    assert.throws(
      () => loadBackendConfig({ ...LOCAL_SCRIPT_ENV, CHAIN_ID: chainId }),
      /31337/,
      `CHAIN_ID=${JSON.stringify(chainId)} must not boot the local backend`,
    );
  }

});

test("GET /health for the local demo backend reports chain 31337 and localDemoMode", async () => {
  const { app } = localApp();
  const response = await requestJson(app, "GET", "/health");

  assert.equal(response.status, 200);
  assert.equal(response.json.status, "ok");
  assert.equal(response.json.chainId, 31337);
  assert.equal(response.json.localDemoMode, true);
  assert.equal(response.json.policySigningEnabled, true);
  assert.notEqual(response.json.chainId, SEPOLIA_CHAIN_ID);
  assert.notEqual(response.json.chainId, 1);
});

test("GET /config/protected-pool on the local backend advertises chain 31337", async () => {
  const { app, deps } = localApp();
  const response = await requestJson(app, "GET", "/config/protected-pool");

  assert.equal(response.status, 200);
  assert.equal(response.json.chainId, 31337);
  assert.equal(response.json.poolId, deps.protectedPool.poolId);
});

test("a local demo policy is signed for chain 31337 and not for Sepolia or chain 1", async () => {
  const { app, deps } = localApp();
  const response = await requestJson(
    app,
    "POST",
    "/policy",
    localPolicyBody(deps),
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.demoMode, true);
  const policy = typedPolicy(response.json.policy as Record<string, unknown>);
  assert.equal(policy.minAmountOut, 1n);
  assert.equal(policy.trader.toLowerCase(), EXPECTED_LOCAL_ROUTER.toLowerCase());
  const signature = String(response.json.signature);
  const signer = deps.signerWallet?.address;
  assert.ok(signer);

  const recovered = (chainId: number) =>
    verifyTypedData(
      policyDomain({ chainId, verifyingContract: deps.verifierAddress }),
      POLICY_TYPES,
      policy,
      signature,
    ).toLowerCase();

  assert.equal(recovered(31337), signer.toLowerCase());
  assert.notEqual(recovered(SEPOLIA_CHAIN_ID), signer.toLowerCase());
  assert.notEqual(recovered(1), signer.toLowerCase());
});

test("the client cannot retarget a local policy onto another chain", async () => {
  const { app, deps } = localApp();
  for (const chainId of [1, 11155111, 31337]) {
    const response = await requestJson(
      app,
      "POST",
      "/policy",
      localPolicyBody(deps, { chainId }),
    );
    assert.equal(response.status, 400, `chainId ${chainId}`);
    assert.equal(response.json.code, "invalid_request");
    assert.equal(response.json.signature, undefined);
  }
});

test("the connected anvil account is not the policy trader", async () => {
  const { app, deps } = localApp();
  const response = await requestJson(
    app,
    "POST",
    "/policy",
    localPolicyBody(deps, { trader: ANVIL_ACCOUNT_0 }),
  );

  assert.equal(response.status, 400);
  assert.equal(response.json.code, "invalid_trader");
  assert.match(String(response.json.details), /must be the configured MEVShield router/);
  assert.equal(response.json.signature, undefined);
});

test("a Sepolia backend does not sign the local anvil pool", async () => {
  const { deps } = localApp();
  const sepolia = createApp({
    ...deps,
    chainId: SEPOLIA_CHAIN_ID,
    localDemoMode: false,
    routerAddress: "0x633282608B2fc66cD7572f5eF58e804063aa150D",
    protectedPool: {
      currency0: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      currency1: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
      fee: 3000,
      tickSpacing: 60,
      hooks: "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080",
      poolId:
        "0x9275e922143fd87aa42dea59b14fedae2df09098cf62ef0fc60a3799f903b602",
    },
  });
  const health = await requestJson(sepolia, "GET", "/health");
  assert.equal(health.json.chainId, 11155111);
  assert.equal(health.json.localDemoMode, false);

  const demoFloor = await requestJson(
    sepolia,
    "POST",
    "/policy",
    localPolicyBody(deps),
  );
  assert.equal(demoFloor.status, 400);
  assert.equal(demoFloor.json.code, "invalid_minimum_output");
  assert.equal(demoFloor.json.signature, undefined);

  const localPool = await requestJson(
    sepolia,
    "POST",
    "/policy",
    localPolicyBody(deps, { minAmountOut: "100" }),
  );
  assert.equal(localPool.status, 400);
  assert.equal(localPool.json.code, "invalid_pool");
  assert.equal(localPool.json.signature, undefined);
});

test("the local test page origin is allowed on both localhost spellings", () => {
  const origins = allowedFrontendOrigins("http://localhost:5402");
  assert.ok(origins.includes("http://localhost:5402"));
  assert.ok(origins.includes("http://127.0.0.1:5402"));
  assert.equal(origins.includes("http://localhost:5173"), false);
});

test("CORS for the local test page does not accept the published frontend origin", async () => {
  const { app } = localApp();
  const allowed = await requestJson(app, "GET", "/health", undefined, {
    origin: "http://localhost:5402",
  });
  assert.equal(
    allowed.headers.get("access-control-allow-origin"),
    "http://localhost:5402",
  );

  const other = await requestJson(app, "GET", "/health", undefined, {
    origin: "http://localhost:5173",
  });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});

test("the backend test script names this file", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { scripts: { test: string } };
  assert.match(pkg.scripts.test, /src\/localChainWallet\.test\.ts/);
});
