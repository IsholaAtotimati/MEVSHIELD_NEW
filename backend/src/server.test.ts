import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";

import {
  EXPECTED_PROTECTED_POOL,
  EXPECTED_SEPOLIA_ROUTER,
} from "./config/runtimeConfig.js";
import {
  MAX_SQRT_PRICE_LIMIT_X96,
  MIN_SQRT_PRICE_LIMIT_X96,
} from "./policy/policyRequest.js";
import { createApp, type AppDependencies } from "./server.js";

function futureExpiry(secondsFromNow = 300): string {
  return String(Math.floor(Date.now() / 1000) + secondsFromNow);
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

test("POST /risk-preview returns deterministic MVP metadata", async () => {
  const response = await requestJson(createApp(baseDeps()), "POST", "/risk-preview", {
    amountSpecified: "1000000",
    zeroForOne: true,
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.riskLevel, "LOW");
  assert.equal(response.json.model, "deterministic-mvp");
  assert.match(String(response.json.disclaimer), /Not a live market-risk measurement/);
});

test("POST /policy returns 503 when signing is disabled", async () => {
  const response = await requestJson(createApp(baseDeps()), "POST", "/policy", {});

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

test("POST /policy rejects demo minimum output outside local demo mode", async () => {
  const response = await requestJson(
    createApp(
      baseDeps({
        policySigningEnabled: true,
        localDemoMode: false,
        signerWallet: undefined,
      }),
    ),
    "POST",
    "/policy",
    {
      poolId: EXPECTED_PROTECTED_POOL.poolId,
      trader: EXPECTED_SEPOLIA_ROUTER,
      nonce: "1",
      expiry: futureExpiry(),
      amountSpecified: "-1000000",
      zeroForOne: true,
      sqrtPriceLimitX96: String(MIN_SQRT_PRICE_LIMIT_X96 + 1n),
      minAmountOut: "1",
    },
  );

  assert.equal(response.status, 400);
  assert.match(String(response.json.error), /Invalid minimum output/);
});

test("POST /policy rejects out-of-range sqrt price before signing", async () => {
  const response = await requestJson(
    createApp(
      baseDeps({
        policySigningEnabled: true,
        localDemoMode: false,
        signerWallet: undefined,
      }),
    ),
    "POST",
    "/policy",
    {
      poolId: EXPECTED_PROTECTED_POOL.poolId,
      trader: EXPECTED_SEPOLIA_ROUTER,
      nonce: "1",
      expiry: futureExpiry(),
      amountSpecified: "-1000000",
      zeroForOne: true,
      sqrtPriceLimitX96: String(MAX_SQRT_PRICE_LIMIT_X96),
      minAmountOut: "100",
    },
  );

  assert.equal(response.status, 400);
  assert.equal(response.json.error, "Invalid request");
});
