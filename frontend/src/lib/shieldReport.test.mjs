import assert from "node:assert/strict";
import test from "node:test";

import { resolveShieldPhase, SHIELD_PHASE_TITLE } from "./shieldReport.ts";

test("a receipt outranks a policy and a risk preview", () => {
  assert.equal(
    resolveShieldPhase({
      hasReceipt: true,
      hasPolicy: true,
      riskMatchesInputs: true,
    }),
    "receipt",
  );
});

test("a policy shows the sign phase even with a stale preview", () => {
  assert.equal(
    resolveShieldPhase({
      hasReceipt: false,
      hasPolicy: true,
      riskMatchesInputs: false,
    }),
    "sign",
  );
});

test("a preview that matches the inputs shows the risk phase", () => {
  assert.equal(
    resolveShieldPhase({
      hasReceipt: false,
      hasPolicy: false,
      riskMatchesInputs: true,
    }),
    "risk",
  );
});

test("a preview for different inputs falls back to the idle report", () => {
  assert.equal(
    resolveShieldPhase({
      hasReceipt: false,
      hasPolicy: false,
      riskMatchesInputs: false,
    }),
    "idle",
  );
});

test("every phase has its own heading", () => {
  const titles = Object.values(SHIELD_PHASE_TITLE);
  assert.equal(titles.length, 4);
  assert.equal(new Set(titles).size, 4);
  for (const title of titles) {
    assert.ok(title.length > 0);
  }
});
