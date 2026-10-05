import assert from "node:assert/strict";
import test from "node:test";
import { clearPolicyRequest, requestIdForPolicy, trackPolicyRequest, } from "./requestCorrelation.js";
test("policy event correlation is case-insensitive and can be cleared", () => {
    const policyId = `0x${"a".repeat(64)}`;
    trackPolicyRequest(policyId, "swap-request-1");
    assert.equal(requestIdForPolicy(policyId.toUpperCase()), "swap-request-1");
    clearPolicyRequest(policyId);
    assert.equal(requestIdForPolicy(policyId), undefined);
});
