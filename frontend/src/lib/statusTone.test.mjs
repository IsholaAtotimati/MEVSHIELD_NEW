import assert from "node:assert/strict";
import test from "node:test";

import { activityStatusTone, verificationTone } from "./statusTone.ts";

test("only reverted and failed activity reads as a bad outcome", () => {
  assert.equal(activityStatusTone("reverted"), "no");
  assert.equal(activityStatusTone("failed"), "no");
  assert.equal(activityStatusTone("registered"), "ok");
  assert.equal(activityStatusTone("executed"), "ok");
  assert.equal(activityStatusTone("enforced"), "ok");
});

test("a matching contract address verifies", () => {
  assert.equal(
    verificationTone(
      "0xAbC0000000000000000000000000000000000001",
      "0xabc0000000000000000000000000000000000001",
    ),
    "ok",
  );
});

test("a missing or different address does not verify", () => {
  assert.equal(
    verificationTone(
      "0xAbC0000000000000000000000000000000000002",
      "0xabc0000000000000000000000000000000000001",
    ),
    "no",
  );
  assert.equal(verificationTone(null, "0xabc"), "no");
});
