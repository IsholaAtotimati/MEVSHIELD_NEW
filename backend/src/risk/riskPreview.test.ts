import assert from "node:assert/strict";
import test from "node:test";
import { RiskPreviewRequestSchema, previewRisk } from "./riskPreview.js";

test("accepts a valid risk-preview request", () => {
  assert.equal(
    RiskPreviewRequestSchema.safeParse({
      amountSpecified: "1000000000000000000",
      zeroForOne: true,
    }).success,
    true,
  );
});

test("rejects malformed, missing, or invalid fields", () => {
  const invalidRequests = [
    { amountSpecified: "abc", zeroForOne: true },
    { amountSpecified: "1.2", zeroForOne: true },
    { amountSpecified: "1" },
    { zeroForOne: true },
    { amountSpecified: "1", zeroForOne: "true" },
  ];

  for (const request of invalidRequests) {
    assert.equal(RiskPreviewRequestSchema.safeParse(request).success, false);
  }
});

test("rejects zero amount", () => {
  const result = previewRisk({ amountSpecified: "0", zeroForOne: true });
  assert.deepEqual(result, {
    ok: false,
    error: "amountSpecified must not be zero",
  });
});

test("returns deterministic estimates for a valid amount", () => {
  const result = previewRisk({
    amountSpecified: "1000000000000000000",
    zeroForOne: true,
  });

  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.data.estimatedLoss, "1000000000000000");
  assert.equal(result.data.estimatedFee, "100000000000000");
  assert.equal(result.data.maxLoss, "2000000000000000");
  assert.equal(result.data.maxFee, "200000000000000");
  assert.equal(result.data.riskLevel, "LOW");
  assert.equal(result.data.model, "deterministic-mvp");
  assert.match(result.data.disclaimer, /Not a live market-risk measurement/);
});

test("negative amounts produce the same absolute-amount estimates", () => {
  const positive = previewRisk({
    amountSpecified: "1000000",
    zeroForOne: true,
  });
  const negative = previewRisk({
    amountSpecified: "-1000000",
    zeroForOne: false,
  });

  assert.equal(positive.ok, true);
  assert.equal(negative.ok, true);
  if (positive.ok && negative.ok) {
    assert.equal(positive.data.estimatedLoss, negative.data.estimatedLoss);
    assert.equal(positive.data.estimatedFee, negative.data.estimatedFee);
  }
});
