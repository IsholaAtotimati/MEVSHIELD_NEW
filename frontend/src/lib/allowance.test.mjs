import assert from "node:assert/strict";
import test from "node:test";

import { hasSufficientAllowance } from "./allowance.ts";

test("allowance readiness requires a known balance covering the exact input", () => {
  assert.equal(hasSufficientAllowance(null, 10n), false);
  assert.equal(hasSufficientAllowance(10n, null), false);
  assert.equal(hasSufficientAllowance(9n, 10n), false);
  assert.equal(hasSufficientAllowance(10n, 10n), true);
  assert.equal(hasSufficientAllowance(11n, 10n), true);
});
