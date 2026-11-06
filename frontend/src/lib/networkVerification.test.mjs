/**
 * Tests for the Network page contract-verification rows.
 *
 * The rows exist to answer "does the deployed address match the configured
 * one?" That answer is only worth showing if a row can say "no", so the main
 * invariant here is that no row compares a constant with itself: for every row,
 * `expected !== observed` must be able to become true by changing the observed
 * value. Rows with no on-chain source must say so instead of reporting a pass.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVerificationRows,
  VERIFICATION_STATE_LABELS,
} from "./networkVerification.ts";

const CONTRACTS = {
  poolManager: "0xE03A1074c86CFeDd5C142C4F04F1a1536e203543",
  mevShieldHook: "0xd15e4fdd391a68c2f1c385d1a819117a3ad40080",
  policyRegistry: "0xB2897da1CfC0c73C3983221a87C27586D1cE1c9E",
  policyVerifier: "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f",
  policyAuthorization: "0xefC9bc21f1ab3564232a3216f0e45d5caE3Bd7c5",
  mevShieldRouter: "0x633282608B2fc66cD7572f5eF58e804063aa150D",
};

const MATCHING_OBSERVATION = {
  poolManager: CONTRACTS.poolManager,
  authorization: CONTRACTS.policyAuthorization,
  registry: CONTRACTS.policyRegistry,
  verifier: CONTRACTS.policyVerifier,
};

const DRIFTED_OBSERVATION = {
  poolManager: "0x1111111111111111111111111111111111111111",
  authorization: "0x2222222222222222222222222222222222222222",
  registry: "0x3333333333333333333333333333333333333333",
  verifier: "0x4444444444444444444444444444444444444444",
};

function rowNamed(rows, name) {
  const row = rows.find((candidate) => candidate.name === name);
  assert.ok(row, `expected a verification row named ${name}`);
  return row;
}

test("matching observations pass and drifted observations report a mismatch", () => {
  const matched = buildVerificationRows({
    contracts: CONTRACTS,
    observed: MATCHING_OBSERVATION,
  });
  const drifted = buildVerificationRows({
    contracts: CONTRACTS,
    observed: DRIFTED_OBSERVATION,
  });

  for (const name of [
    "PoolManager",
    "PolicyRegistry",
    "PolicyVerifier",
    "PolicyAuthorization",
  ]) {
    assert.equal(rowNamed(matched, name).state, "pass", `${name} should pass`);
    assert.equal(
      rowNamed(drifted, name).state,
      "mismatch",
      `${name} must be able to report a mismatch`,
    );
  }
});

test("no row compares a configured constant with itself", () => {
  // Every row must either hold an observation that is independent of the
  // configured value, or declare itself unchecked. A tautological row would
  // pass here only by accident, so drift must move every observable row.
  const drifted = buildVerificationRows({
    contracts: CONTRACTS,
    observed: DRIFTED_OBSERVATION,
  });
  const observable = drifted.filter((row) => row.observed !== null);

  assert.ok(observable.length > 0, "at least one row must be observable");
  for (const row of observable) {
    assert.notEqual(
      row.observed?.toLowerCase(),
      row.expected.toLowerCase(),
      `${row.name} compared a constant to itself`,
    );
    assert.equal(row.state, "mismatch", `${row.name} should report drift`);
  }
});

test("a row with no observation reports not checked with a reason", () => {
  const rows = buildVerificationRows({
    contracts: CONTRACTS,
    observed: MATCHING_OBSERVATION,
  });

  for (const name of ["MEVShieldHook", "MEVShieldRouter"]) {
    const row = rowNamed(rows, name);
    assert.equal(row.observed, null, `${name} must not invent an observation`);
    assert.equal(row.state, "not-checked", `${name} must not claim a verdict`);
    assert.equal(row.reason, "no on-chain source");
  }
});

test("every state has a text label so the verdict is not colour alone", () => {
  assert.equal(VERIFICATION_STATE_LABELS.pass, "Pass");
  assert.equal(VERIFICATION_STATE_LABELS.mismatch, "Mismatch");
  assert.equal(VERIFICATION_STATE_LABELS["not-checked"], "Not checked");
});

test("policy authorization is compared against the hook's own authorization", () => {
  // The wrong pairing compared policyAuthorization with poolAuthorization, a
  // second config key holding the same literal, so it could never disagree.
  const rows = buildVerificationRows({
    contracts: CONTRACTS,
    observed: { authorization: "0x5555555555555555555555555555555555555555" },
  });

  const row = rowNamed(rows, "PolicyAuthorization");
  assert.equal(row.expected, CONTRACTS.policyAuthorization);
  assert.equal(row.observed, "0x5555555555555555555555555555555555555555");
  assert.equal(row.state, "mismatch");
});

test("an unresolved chain read is not checked rather than a verdict", () => {
  const rows = buildVerificationRows({ contracts: CONTRACTS, observed: {} });

  for (const row of rows) {
    assert.equal(row.state, "not-checked", `${row.name} must wait for a read`);
    assert.ok(row.reason, `${row.name} must explain why it is unchecked`);
  }
});
