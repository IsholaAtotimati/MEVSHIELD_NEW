/**
 * Tests for the shared display and response-parsing helpers.
 *
 * Covers the two things a refactor like this can silently break: the exact
 * string a base-unit value renders as, and the error message a failed backend
 * call surfaces.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { apiErrorMessage } from "./apiValidation.ts";
import {
  formatBaseUnits,
  formatBaseUnitsWithSymbol,
  formatTokenAmount,
  shortAddress,
} from "./format.ts";

test("formatBaseUnits renders backend decimal strings at full precision", () => {
  assert.equal(formatBaseUnits("1500000", 6), "1.5");
  assert.equal(formatBaseUnits("200000", 6), "0.2");
  assert.equal(formatBaseUnits("1", 18), "0.000000000000000001");
  assert.equal(formatBaseUnits(0n, 18), "0");
});

test("formatBaseUnits keeps an exact bound instead of truncating it", () => {
  // 1.234567890123456789 must not be shortened the way formatTokenAmount does.
  assert.equal(
    formatBaseUnits("1234567890123456789", 18),
    "1.234567890123456789",
  );
});

test("formatBaseUnits returns a dash for missing or malformed values", () => {
  assert.equal(formatBaseUnits(null, 18), "—");
  assert.equal(formatBaseUnits(undefined, 18), "—");
  assert.equal(formatBaseUnits("not-a-number", 18), "—");
});

test("formatBaseUnitsWithSymbol appends the pool symbol only for real amounts", () => {
  assert.equal(formatBaseUnitsWithSymbol("1000000", 6, "USDC"), "1 USDC");
  assert.equal(formatBaseUnitsWithSymbol(null, 6, "USDC"), "—");
});

test("formatTokenAmount still truncates and dashes missing balances", () => {
  assert.equal(formatTokenAmount(null, 18), "—");
  assert.equal(formatTokenAmount(1_234_567_890_123_456_789n, 18), "1.234567");
  assert.equal(formatTokenAmount(1n, 18), "<0.000001");
});

test("shortAddress dashes an empty address and shortens a real one", () => {
  assert.equal(shortAddress(undefined), "—");
  assert.equal(shortAddress(null), "—");
  assert.equal(
    shortAddress("0xE57525678cbf6417F685727b77551316a3De3bba"),
    "0xE575...3bba",
  );
});

test("apiErrorMessage reads the backend error string", () => {
  assert.equal(
    apiErrorMessage({ error: "Invalid policy trader", code: "invalid_trader" }, "fallback"),
    "Invalid policy trader",
  );
});

test("apiErrorMessage falls back when the body is not an error envelope", () => {
  assert.equal(apiErrorMessage(null, "Risk preview failed"), "Risk preview failed");
  assert.equal(apiErrorMessage("<html>502</html>", "fallback"), "fallback");
  assert.equal(apiErrorMessage({}, "fallback"), "fallback");
  assert.equal(apiErrorMessage({ error: 42 }, "fallback"), "fallback");
});
