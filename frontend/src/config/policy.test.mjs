import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPolicyExpiry,
  POLICY_MAX_TTL_SECONDS,
  POLICY_TTL_SECONDS,
} from "./policy.ts";

const now = 1_767_000_000;

test("requests a TTL inside the backend ceiling", () => {
  assert.ok(
    POLICY_TTL_SECONDS < POLICY_MAX_TTL_SECONDS,
    `POLICY_TTL_SECONDS (${POLICY_TTL_SECONDS}) must stay below the backend ceiling (${POLICY_MAX_TTL_SECONDS})`,
  );
});

test("derives an expiry that the backend accepts", () => {
  const expiry = buildPolicyExpiry(now);

  assert.ok(expiry > now, "expiry must be in the future");
  assert.ok(
    expiry - now <= POLICY_MAX_TTL_SECONDS,
    `expiry ${expiry} exceeds the backend ceiling of now + ${POLICY_MAX_TTL_SECONDS}`,
  );
});

test("derives the same expiry for a fractional clock reading", () => {
  assert.equal(buildPolicyExpiry(now + 0.9), now + POLICY_TTL_SECONDS);
});

test("derives expiry purely from the supplied clock", () => {
  assert.equal(buildPolicyExpiry(now) - buildPolicyExpiry(0), now);
});
