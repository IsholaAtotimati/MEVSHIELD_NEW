import assert from "node:assert/strict";
import test from "node:test";

import { resolveTradeActionReadiness } from "./tradeActionReadiness.ts";

const ready = {
  primaryStep: "sign",
  inputAmountValid: true,
  directionValid: true,
  isBusy: false,
  readOnlyDemo: false,
  demoMode: false,
  canCheckRisk: true,
  readinessReasons: [],
  backendHealthState: "ok",
  backendHealthError: null,
  backendPolicySigningEnabled: true,
  backendChainId: 11155111,
  backendDemoMode: false,
  walletConnected: true,
  walletChainId: 11155111,
  requiredChainId: 11155111,
  policyRegistered: true,
  canExecute: true,
  executionReasons: [],
};

test("signing remains disabled with actionable reasons until backend and wallet are ready", () => {
  const backend = resolveTradeActionReadiness({
    ...ready,
    backendPolicySigningEnabled: false,
  });
  assert.equal(backend.primaryDisabled, true);
  assert.match(backend.primaryReasons.join(" "), /policy signing is disabled/i);

  const wallet = resolveTradeActionReadiness({
    ...ready,
    walletConnected: false,
  });
  assert.equal(wallet.primaryDisabled, true);
  assert.match(wallet.primaryReasons.join(" "), /Connect your wallet/);

  const chain = resolveTradeActionReadiness({
    ...ready,
    walletChainId: 1,
  });
  assert.equal(chain.primaryDisabled, true);
  assert.match(chain.primaryReasons.join(" "), /Switch your wallet to Sepolia/);
});

test("quote, deployment, and backend failures are surfaced as signing blockers", () => {
  const result = resolveTradeActionReadiness({
    ...ready,
    canCheckRisk: false,
    readinessReasons: [
      "A fresh quote for the protected pool is unavailable.",
      "The signed-minimum-output v2 contracts are not deployed and verified.",
    ],
  });
  assert.equal(result.primaryDisabled, true);
  assert.match(result.primaryReasons.join(" "), /fresh quote/);
  assert.match(result.primaryReasons.join(" "), /v2 contracts/);

  const offline = resolveTradeActionReadiness({
    ...ready,
    backendHealthState: "failed",
    backendHealthError: "VITE_API_URL is not configured.",
  });
  assert.equal(offline.primaryDisabled, true);
  assert.match(offline.primaryReasons.join(" "), /VITE_API_URL/);
});

test("execution requires fresh readiness, a registered policy, and Sepolia wallet", () => {
  const expired = resolveTradeActionReadiness({
    ...ready,
    executionReasons: ["Policy expired. Create and register a new policy."],
  });
  assert.equal(expired.executionDisabled, true);
  assert.match(expired.executionReasons.join(" "), /Policy expired/);

  const unregistered = resolveTradeActionReadiness({
    ...ready,
    policyRegistered: false,
  });
  assert.equal(unregistered.executionDisabled, true);
  assert.match(unregistered.executionReasons.join(" "), /registration is not confirmed/);

  assert.equal(
    resolveTradeActionReadiness(ready).executionDisabled,
    false,
  );
});
