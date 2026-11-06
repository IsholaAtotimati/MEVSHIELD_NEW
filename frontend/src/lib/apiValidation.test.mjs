import assert from "node:assert/strict";
import test from "node:test";

import { parseHealthBody } from "./apiValidation.ts";
import { formatTokenAmount } from "./format.ts";

test("parses the monitor status and last checked block from /health", () => {
  const parsed = parseHealthBody({
    status: "ok",
    service: "mevshield-backend",
    chainId: 11155111,
    policySigningEnabled: true,
    localDemoMode: false,
    sepoliaMonitor: { status: "connected", lastCheckedBlock: 6_123_456 },
  });

  assert.deepEqual(parsed?.sepoliaMonitor, {
    status: "connected",
    lastCheckedBlock: 6_123_456,
  });
  assert.equal(parsed?.policySigningEnabled, true);
});

test("keeps a monitor that has not scanned a block yet", () => {
  const parsed = parseHealthBody({
    status: "ok",
    sepoliaMonitor: { status: "starting" },
  });

  assert.deepEqual(parsed?.sepoliaMonitor, { status: "starting" });
  assert.equal(parsed?.sepoliaMonitor?.lastCheckedBlock, undefined);
});

test("drops a malformed monitor instead of rendering it", () => {
  for (const monitor of [
    { status: "unknown-state", lastCheckedBlock: 10 },
    { status: "connected", lastCheckedBlock: "10" },
    { status: "connected", lastCheckedBlock: -1 },
    { status: "connected", lastCheckedBlock: 1.5 },
    "connected",
    null,
  ]) {
    const parsed = parseHealthBody({ status: "ok", sepoliaMonitor: monitor });
    assert.equal(parsed?.sepoliaMonitor, undefined);
    assert.equal(parsed?.status, "ok");
  }
});

test("rejects bodies that are not health payloads", () => {
  assert.equal(parseHealthBody(null), null);
  assert.equal(parseHealthBody("ok"), null);
  assert.equal(parseHealthBody({ service: "mevshield-backend" }), null);
});

test("formats base units without rounding up a balance", () => {
  assert.equal(formatTokenAmount(null, 18), "—");
  assert.equal(formatTokenAmount(0n, 18), "0");
  assert.equal(formatTokenAmount(1_500_000n, 6), "1.5");
  assert.equal(formatTokenAmount(10n ** 18n, 18), "1");
  assert.equal(formatTokenAmount(1_234_567_890_123_456_789n, 18), "1.234567");
  assert.equal(formatTokenAmount(1n, 18), "<0.000001");
  assert.equal(formatTokenAmount(123_456n, 6), "0.123456");
});
