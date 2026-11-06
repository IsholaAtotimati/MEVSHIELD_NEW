import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const policySource = readFileSync(new URL("./usePolicy.ts", import.meta.url), "utf8");
const executionSource = readFileSync(
  new URL("./useExecution.ts", import.meta.url),
  "utf8",
);

function position(source, fragment) {
  const index = source.indexOf(fragment);
  assert.notEqual(index, -1, `Expected source fragment: ${fragment}`);
  return index;
}

test("policy lifecycle refreshes the quote after approval and before signing", () => {
  const approvalRead = position(policySource, 'functionName: "allowance"');
  const approvalWrite = position(policySource, 'functionName: "approve"');
  const approvalReceipt = position(policySource, "approvalReceipt.status !== \"success\"");
  const quoteRefresh = position(policySource, "await refreshLiveQuote(");
  const policyRequest = position(policySource, 'fetch(`${BACKEND_URL}/policy`');
  const registration = position(policySource, 'functionName: "registerPolicy"');

  assert.ok(approvalRead < approvalWrite);
  assert.ok(approvalWrite < approvalReceipt);
  assert.ok(approvalReceipt < quoteRefresh);
  assert.ok(quoteRefresh < policyRequest);
  assert.ok(policyRequest < registration);
  assert.match(policySource, /quoteId: signingQuote\.quoteId/);
  assert.match(policySource, /signingQuote = refreshedQuote/);
});

test("failed approval and registration stop before later lifecycle steps", () => {
  const approvalFailure = position(
    policySource,
    'throw new Error("Input-token approval transaction failed.")',
  );
  const quoteRefresh = position(policySource, "await refreshLiveQuote(");
  const registrationFailure = position(
    policySource,
    'throw new Error("Policy registration transaction failed.")',
  );
  const policyState = position(policySource, "setPolicy({");

  assert.ok(approvalFailure < quoteRefresh);
  assert.ok(registrationFailure < policyState);
});

test("execution never submits approval and fails closed before swap estimation", () => {
  assert.equal(executionSource.includes('functionName: "approve"'), false);
  const allowance = position(executionSource, 'functionName: "allowance"');
  const allowanceFailure = position(
    executionSource,
    "Input-token approval is required before policy creation.",
  );
  const quoteExpiry = position(
    executionSource,
    "The live quote expired before execution.",
  );
  const estimate = position(executionSource, "estimateContractGas");

  assert.ok(allowance < allowanceFailure);
  assert.ok(allowanceFailure < quoteExpiry);
  assert.ok(quoteExpiry < estimate);
});

test("frontend lifecycle contains no Deployment A address or fallback", () => {
  assert.doesNotMatch(policySource, /Deployment A|DEPLOYMENT_A|fallback/i);
  assert.doesNotMatch(executionSource, /Deployment A|DEPLOYMENT_A|fallback/i);
});
