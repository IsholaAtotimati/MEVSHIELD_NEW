import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const backendDirectory = fileURLToPath(new URL("../../", import.meta.url));

function runMonitorScenario(
  chainId: string,
  routerMode: "valid" | "missing" | "malformed" = "valid",
  extraEnv: Record<string, string> = {},
) {
  const scenario = `
    import assert from "node:assert/strict";
    import { createServer } from "node:http";
    import { once } from "node:events";

    const requests = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      const respond = (item) => {
        requests.push(item);
        const result = item.method === "eth_chainId"
          ? process.env.TEST_CHAIN_ID
          : item.method === "eth_blockNumber"
            ? "0x2a"
            : item.method === "eth_getLogs"
              ? []
              : null;
        return { jsonrpc: "2.0", id: item.id, result };
      };
      const result = Array.isArray(payload) ? payload.map(respond) : respond(payload);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(result));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    process.env.SEPOLIA_RPC_URL = \`http://127.0.0.1:\${server.address().port}\`;
    process.env.POLICY_REGISTRY_ADDRESS = "0x1111111111111111111111111111111111111111";
    process.env.HOOK_ADDRESS = "0x2222222222222222222222222222222222222222";
    delete process.env.MEVSHIELD_ROUTER;
    if (process.env.TEST_ROUTER_MODE === "missing") {
      delete process.env.ROUTER_ADDRESS;
    } else {
      process.env.ROUTER_ADDRESS = process.env.TEST_ROUTER_MODE === "malformed"
        ? "not-an-address"
        : "0x3333333333333333333333333333333333333333";
    }

    const { startSepoliaMonitor } = await import("./src/monitor/sepolia.ts");
    let getStatus;
    let configurationError;
    try {
      getStatus = startSepoliaMonitor();
    } catch (error) {
      configurationError = error instanceof Error ? error.message : String(error);
    }
    if (!configurationError) {
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const methods = requests.map(({ method }) => method);
        const snapshot = getStatus?.();
        const monitorStatus = typeof snapshot === "string" ? snapshot : snapshot?.status;
        if (
          (process.env.TEST_CHAIN_ID !== "0xaa36a7" && monitorStatus === "error") ||
          (process.env.TEST_CHAIN_ID === "0xaa36a7" && methods.includes("eth_getLogs"))
        ) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }

    const methodsBeforeWait = requests.map(({ method }) => method);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const snapshot = getStatus?.();
    const result = {
      status: typeof snapshot === "string" ? snapshot : snapshot?.status,
      lastCheckedBlock:
        typeof snapshot === "object" ? snapshot?.lastCheckedBlock : undefined,
      configurationError,
      requests,
      methodsBeforeWait,
      methodsAfterWait: requests.map(({ method }) => method),
    };
    await new Promise((resolve) => server.close(resolve));
    console.log("MONITOR_RESULT=" + JSON.stringify(result));
    process.exit(0);
  `;

  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", scenario],
    {
      cwd: backendDirectory,
      encoding: "utf8",
      env: {
        ...process.env,
        TEST_CHAIN_ID: chainId,
        TEST_ROUTER_MODE: routerMode,
        ...extraEnv,
      },
      timeout: 20_000,
    },
  );

  assert.equal(
    child.status,
    0,
    `Monitor scenario failed.\nstdout:\n${child.stdout}\nstderr:\n${child.stderr}`,
  );
  const resultLine = child.stdout
    .split("\n")
    .find((line) => line.startsWith("MONITOR_RESULT="));
  assert.ok(resultLine, `Monitor result missing.\n${child.stdout}`);
  return JSON.parse(resultLine.slice("MONITOR_RESULT=".length)) as {
    status?: string;
    configurationError?: string;
    requests: Array<{ method: string; params?: unknown[] }>;
    methodsBeforeWait: string[];
    methodsAfterWait: string[];
  };
}

test("malformed optional router fails before making an RPC request", () => {
  const result = runMonitorScenario("0xaa36a7", "malformed");

  assert.equal(result.configurationError, "Sepolia monitor router address is invalid");
  assert.deepEqual(result.requests, []);
});

test("missing optional router still allows Sepolia monitor scanning", () => {
  const result = runMonitorScenario("0xaa36a7", "missing");

  assert.equal(result.status, "connected");
  const methods = result.requests.map(({ method }) => method);
  assert.ok(methods.indexOf("eth_chainId") < methods.indexOf("eth_blockNumber"));
  assert.ok(methods.includes("eth_getLogs"));
});

test("wrong RPC chain stops the monitor before requesting blocks or logs", () => {
  const result = runMonitorScenario("0x1");

  assert.equal(result.status, "error");
  assert.deepEqual(result.methodsBeforeWait, ["eth_chainId"]);
  assert.deepEqual(result.methodsAfterWait, ["eth_chainId"]);
});

test("Sepolia RPC chain continues scanning configured registry and hook logs", () => {
  const result = runMonitorScenario("0xaa36a7");

  assert.equal(result.status, "connected");
  const methods = result.requests.map(({ method }) => method);
  assert.ok(methods.indexOf("eth_chainId") < methods.indexOf("eth_blockNumber"));
  assert.ok(methods.includes("eth_getLogs"));

  const logRequest = result.requests.find(({ method }) => method === "eth_getLogs");
  assert.ok(logRequest);
  const filter = logRequest.params?.[0] as {
    address?: string[];
    topics?: Array<string | string[]>;
  };
  assert.deepEqual(filter.address, [
    "0x1111111111111111111111111111111111111111",
    "0x2222222222222222222222222222222222222222",
  ]);
  assert.equal(Array.isArray(filter.topics?.[0]), true);
  assert.equal((filter.topics?.[0] as string[]).length, 2);
});

test("the local chain gate moves the monitor to chain 31337", () => {
  const result = runMonitorScenario("0x7a69", "valid", {
    MEVSHIELD_LOCAL_CHAIN_ENABLED: "true",
    NODE_ENV: "development",
  });

  assert.equal(result.status, "connected");
  const methods = result.requests.map(({ method }) => method);
  assert.ok(methods.includes("eth_getLogs"));
});

test("without the local gate an anvil RPC is still rejected as the wrong chain", () => {
  const result = runMonitorScenario("0x7a69", "valid", {
    MEVSHIELD_LOCAL_CHAIN_ENABLED: "false",
    NODE_ENV: "development",
  });

  assert.equal(result.status, "error");
  assert.deepEqual(result.methodsAfterWait, ["eth_chainId"]);
});

test("a production runtime cannot monitor the local chain", () => {
  const result = runMonitorScenario("0x7a69", "valid", {
    MEVSHIELD_LOCAL_CHAIN_ENABLED: "true",
    NODE_ENV: "production",
  });

  assert.equal(result.status, "error");
  assert.deepEqual(result.methodsAfterWait, ["eth_chainId"]);
});
