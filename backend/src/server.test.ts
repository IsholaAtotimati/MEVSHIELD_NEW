import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { Wallet } from "ethers";

import {
  EXPECTED_PROTECTED_POOL,
  EXPECTED_SEPOLIA_ROUTER,
} from "./config/runtimeConfig.js";
import {
  MAX_SQRT_PRICE_LIMIT_X96,
  MIN_SQRT_PRICE_LIMIT_X96,
} from "./policy/policyRequest.js";
import { PoolStateUnavailableError } from "./risk/poolState.js";
import { createApp, type AppDependencies } from "./server.js";

const UNIT_SQRT_PRICE_X96 = 1n << 96n;

/** Deep unit-price pool. A 1e6 input is far below a 10 bps impact. */
function deepPoolReader(): AppDependencies["readPoolState"] {
  return async () => ({
    sqrtPriceX96: UNIT_SQRT_PRICE_X96,
    liquidity: 10n ** 30n,
    feePips: 3000n,
  });
}

function futureExpiry(secondsFromNow = 300): string {
  return String(Math.floor(Date.now() / 1000) + secondsFromNow);
}

const TEST_SIGNER_WALLET = new Wallet(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);

function validPolicyBody(minAmountOut = "100") {
  return {
    poolId: EXPECTED_PROTECTED_POOL.poolId,
    trader: EXPECTED_SEPOLIA_ROUTER,
    nonce: "1",
    expiry: futureExpiry(),
    amountSpecified: "-1000000",
    zeroForOne: true,
    sqrtPriceLimitX96: String(MIN_SQRT_PRICE_LIMIT_X96 + 1n),
    minAmountOut,
  };
}

/** Signing on, local demo off — exercises policy rules after the 503 feature gate. */
function v2SigningDeps(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  return baseDeps({
    policySigningEnabled: true,
    localDemoMode: false,
    signerWallet: TEST_SIGNER_WALLET,
    ...overrides,
  });
}

/** Signing on, local demo on — exercises the demo minimum-output rule. */
function demoSigningDeps(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  return baseDeps({
    policySigningEnabled: true,
    localDemoMode: true,
    signerWallet: TEST_SIGNER_WALLET,
    ...overrides,
  });
}

function baseDeps(
  overrides: Partial<AppDependencies> = {},
): AppDependencies {
  return {
    chainId: 11155111,
    verifierAddress: "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f",
    routerAddress: EXPECTED_SEPOLIA_ROUTER,
    protectedPool: { ...EXPECTED_PROTECTED_POOL },
    policySigningEnabled: false,
    localDemoMode: false,
    getMonitorStatus: () => ({
      status: "disabled",
      lastCheckedBlock: 42,
    }),
    readPoolState: deepPoolReader(),
    ...overrides,
  };
}

async function requestJson(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown>; headers: Headers }> {
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const url = `http://127.0.0.1:${address.port}${path}`;

  try {
    const response = await fetch(url, {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
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

test("GET /health exposes monitor last checked block", async () => {
  const response = await requestJson(createApp(baseDeps()), "GET", "/health");

  assert.equal(response.status, 200);
  assert.equal(response.json.status, "ok");
  const monitor = response.json.sepoliaMonitor as {
    status: string;
    lastCheckedBlock?: number;
  };
  assert.equal(monitor.status, "disabled");
  assert.equal(monitor.lastCheckedBlock, 42);
});

test("POST /risk-preview estimates price impact for a small trade as LOW", async () => {
  const response = await requestJson(createApp(baseDeps()), "POST", "/risk-preview", {
    amountSpecified: "1000000",
    zeroForOne: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.estimatedLoss, "7");
  assert.equal(response.json.estimatedFee, "3000");
  assert.equal(response.json.maxLoss, "14");
  assert.equal(response.json.maxFee, "6000");
  assert.equal(response.json.riskLevel, "LOW");
  assert.equal(response.json.model, "active-liquidity-impact");
  assert.match(String(response.json.disclaimer), /current pool state for this trade size/);
  assert.doesNotMatch(String(response.json.disclaimer), /amount\/1000|sandwich-attack probability/);
});

test("POST /risk-preview returns MEDIUM when impact is between 10 and 50 bps", async () => {
  const response = await requestJson(
    createApp(
      baseDeps({
        readPoolState: async () => ({
          sqrtPriceX96: UNIT_SQRT_PRICE_X96,
          liquidity: 10_000_000n,
          feePips: 0n,
        }),
      }),
    ),
    "POST",
    "/risk-preview",
    { amountSpecified: "30501", zeroForOne: true },
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.estimatedLoss, "93");
  assert.equal(response.json.riskLevel, "MEDIUM");
});

test("POST /risk-preview returns HIGH when active liquidity cannot support the trade", async () => {
  const response = await requestJson(
    createApp(
      baseDeps({
        readPoolState: async () => ({
          sqrtPriceX96: UNIT_SQRT_PRICE_X96,
          liquidity: 1_000n,
          feePips: 0n,
        }),
      }),
    ),
    "POST",
    "/risk-preview",
    { amountSpecified: "5000", zeroForOne: true },
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.estimatedLoss, "5000");
  assert.equal(response.json.riskLevel, "HIGH");
  assert.notEqual(response.json.estimatedLoss, "5");
});

test("POST /risk-preview fails closed when the pool read fails", async () => {
  const response = await requestJson(
    createApp(
      baseDeps({
        readPoolState: async () => {
          throw new PoolStateUnavailableError(
            "Protected pool slot0 could not be read.",
          );
        },
      }),
    ),
    "POST",
    "/risk-preview",
    { amountSpecified: "1000000", zeroForOne: true },
  );

  assert.equal(response.status, 503);
  assert.equal(response.json.code, "pool_state_unavailable");
  assert.equal(response.json.estimatedLoss, undefined);
  assert.match(String(response.json.error), /could not be read/);
});

test("POST /policy fails closed when the pool read fails and does not sign", async () => {
  const response = await requestJson(
    createApp(
      v2SigningDeps({
        readPoolState: async () => {
          throw new PoolStateUnavailableError(
            "Protected pool slot0 could not be read.",
          );
        },
      }),
    ),
    "POST",
    "/policy",
    validPolicyBody("100"),
  );

  assert.equal(response.status, 503);
  assert.equal(response.json.code, "pool_state_unavailable");
  assert.equal(response.json.signature, undefined);
});

test("POST /policy returns 503 when signing is disabled", async () => {
  const response = await requestJson(createApp(baseDeps()), "POST", "/policy", {});

  assert.equal(response.status, 503);
  assert.match(String(response.json.error), /Policy signing is disabled/);
});

test("POST /policy returns 503 when signing is disabled regardless of request body", async () => {
  const response = await requestJson(
    createApp(baseDeps({ policySigningEnabled: false, localDemoMode: false })),
    "POST",
    "/policy",
    validPolicyBody("1"),
  );

  assert.equal(response.status, 503);
  assert.match(String(response.json.error), /Policy signing is disabled/);
});

test("POST /policy rejects invalid JSON with 400", async () => {
  const app = createApp(
    baseDeps({
      policySigningEnabled: true,
      signerWallet: undefined,
    }),
  );
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/policy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    const json = (await response.json()) as { error: string };
    assert.equal(json.error, "Invalid JSON body");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("POST /policy validates request bodies before signing", async () => {
  const response = await requestJson(
    createApp(
      baseDeps({
        policySigningEnabled: true,
        signerWallet: undefined,
      }),
    ),
    "POST",
    "/policy",
    { trader: "not-an-address" },
  );

  assert.equal(response.status, 400);
  assert.equal(response.json.error, "Invalid request");
});

test("POST /policy rejects minAmountOut of 1 when signing enabled without local demo", async () => {
  const response = await requestJson(
    createApp(v2SigningDeps()),
    "POST",
    "/policy",
    validPolicyBody("1"),
  );

  assert.equal(response.status, 400);
  assert.match(String(response.json.error), /Invalid minimum output/);
});

test("POST /policy accepts minAmountOut of 1 when local demo mode is enabled", async () => {
  const response = await requestJson(
    createApp(demoSigningDeps()),
    "POST",
    "/policy",
    validPolicyBody("1"),
  );

  assert.equal(response.status, 200);
  const policy = response.json.policy as { minAmountOut: string };
  assert.equal(policy.minAmountOut, "1");
  assert.match(String(response.json.signature), /^0x[0-9a-f]{130}$/);
  assert.equal(response.json.demoMode, true);
});

test("POST /policy rejects a demo minimum output other than 1 in local demo mode", async () => {
  for (const minAmountOut of ["2", "100"]) {
    const response = await requestJson(
      createApp(demoSigningDeps()),
      "POST",
      "/policy",
      validPolicyBody(minAmountOut),
    );

    assert.equal(response.status, 400);
    assert.equal(response.json.error, "Invalid demo minimum output");
    assert.match(
      String(response.json.details),
      /must use a minimum output of exactly 1 base unit/,
    );
  }
});

test("POST /policy rejects out-of-range sqrt price before signing", async () => {
  const response = await requestJson(
    createApp(v2SigningDeps({ signerWallet: undefined })),
    "POST",
    "/policy",
    {
      ...validPolicyBody("100"),
      sqrtPriceLimitX96: String(MAX_SQRT_PRICE_LIMIT_X96),
    },
  );

  assert.equal(response.status, 400);
  assert.equal(response.json.error, "Invalid request");
});

test("error responses carry a stable code, message, and request ID", async () => {
  const response = await requestJson(createApp(baseDeps()), "POST", "/policy", {});

  assert.equal(response.status, 503);
  assert.equal(response.json.code, "policy_signing_disabled");
  assert.equal(
    response.json.error,
    "Policy signing is disabled until the v2 minimum-output contracts are deployed and verified.",
  );
  assert.equal(typeof response.json.requestId, "string");
  assert.equal(response.json.requestId, response.headers.get("x-request-id"));
});

test("validation errors keep the error string and add details plus code", async () => {
  const response = await requestJson(
    createApp(v2SigningDeps({ signerWallet: undefined })),
    "POST",
    "/policy",
    { trader: "not-an-address" },
  );

  assert.equal(response.status, 400);
  assert.equal(response.json.error, "Invalid request");
  assert.equal(response.json.code, "invalid_request");
  assert.ok(Array.isArray(response.json.details));
});

test("invalid JSON body uses the invalid_json code without leaking details", async () => {
  const app = createApp(baseDeps());
  const server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/policy`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });
    const json = (await response.json()) as Record<string, unknown>;
    assert.equal(response.status, 400);
    assert.equal(json.error, "Invalid JSON body");
    assert.equal(json.code, "invalid_json");
    assert.equal(json.details, undefined);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("unknown routes answer with the typed 404 body", async () => {
  const response = await requestJson(createApp(baseDeps()), "GET", "/no-such-route");

  assert.equal(response.status, 404);
  assert.equal(response.json.code, "not_found");
  assert.match(String(response.json.error), /No route for GET \/no-such-route/);
});

test("successful responses keep their existing body shape", async () => {
  const response = await requestJson(createApp(baseDeps()), "GET", "/health");

  assert.equal(response.status, 200);
  assert.equal(response.json.code, undefined);
  assert.equal(response.json.error, undefined);
  assert.equal(response.json.requestId, undefined);
});
