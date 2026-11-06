import assert from "node:assert/strict";
import test from "node:test";

import { LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../config/chainEnv.ts";
import {
  firstDeploymentMismatch,
  parseLocalDeploymentRecord,
  resolveMinimumOutputVerification,
} from "./minimumOutputVerification.ts";

/**
 * The addresses `script/DeployLocal.s.sol` produces from a fresh anvil, which
 * are also the compiled-in local defaults in `lib/contracts.ts`.
 */
const expected = {
  poolManager: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  policyRegistry: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  policyVerifier: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  policyAuthorization: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
  mevShieldHook: "0x1e2F391574556815aE705895F2728543A7AD4080",
  mevShieldRouter: "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
  authorizedSigner: "0xe05fcC23807536bEe418f142D19fa0d21BB0cfF7",
};

/** The record as written by the deploy script: lower-cased addresses. */
const recordJson = JSON.stringify({
  chainId: LOCAL_CHAIN_ID,
  deployedAt: "2026-10-28T10:00:58Z",
  poolManager: expected.poolManager.toLowerCase(),
  policyRegistry: expected.policyRegistry.toLowerCase(),
  policyVerifier: expected.policyVerifier.toLowerCase(),
  policyAuthorization: expected.policyAuthorization.toLowerCase(),
  mevShieldHook: expected.mevShieldHook.toLowerCase(),
  mevShieldRouter: expected.mevShieldRouter.toLowerCase(),
  authorizedSigner: expected.authorizedSigner,
  protectedPool: {
    currency0: "0x610178da211fef7d417bc0e6fed39f05609ad788",
    currency1: "0xb7f8bc63bbcad18155201308c8f3540b07f84f5e",
    fee: 3000,
    tickSpacing: 60,
    hooks: expected.mevShieldHook.toLowerCase(),
    poolId: "0x8d754c8c3f0e991efb877b18bf00b8d0718c2cd8af8f31a35c61de1415e19bf0",
  },
});

// ---------------------------------------------------------------------------
// The local branch
// ---------------------------------------------------------------------------

test("local chain with a matching deployment record verifies the deployment", () => {
  const result = resolveMinimumOutputVerification({
    chainId: LOCAL_CHAIN_ID,
    buildFlagValue: undefined,
    deploymentRecord: recordJson,
    expected,
  });
  assert.deepEqual(result, {
    status: "verified",
    source: "local-deployment-record",
  });
});

test("local chain verifies despite address casing differences", () => {
  // The deploy script lower-cases; lib/contracts.ts uses checksum casing. A
  // case-sensitive comparison would close the gate on a perfectly good deploy.
  const mixedCase = JSON.stringify({
    ...JSON.parse(recordJson),
    poolManager: "0x5FbDB2315678aFecb367f032d93f642F64180aa3",
  });
  assert.equal(
    resolveMinimumOutputVerification({
      chainId: LOCAL_CHAIN_ID,
      buildFlagValue: undefined,
      deploymentRecord: mixedCase,
      expected,
    }).status,
    "verified",
  );
});

test("local chain with no deployment record stays unverified", () => {
  for (const deploymentRecord of [undefined, "", "   "]) {
    const result = resolveMinimumOutputVerification({
      chainId: LOCAL_CHAIN_ID,
      buildFlagValue: undefined,
      deploymentRecord,
      expected,
    });
    assert.equal(result.status, "unverified", `record ${JSON.stringify(deploymentRecord)}`);
  }
});

test("local chain with an unreadable deployment record stays unverified", () => {
  for (const deploymentRecord of ["{", "null", "[]", '"local.json"']) {
    const result = resolveMinimumOutputVerification({
      chainId: LOCAL_CHAIN_ID,
      buildFlagValue: undefined,
      deploymentRecord,
      expected,
    });
    assert.equal(result.status, "unverified", `record ${deploymentRecord}`);
  }
});

test("local chain with one mismatched address stays unverified and names it", () => {
  const drifted = JSON.stringify({
    ...JSON.parse(recordJson),
    mevShieldRouter: "0x0000000000000000000000000000000000000001",
  });
  const result = resolveMinimumOutputVerification({
    chainId: LOCAL_CHAIN_ID,
    buildFlagValue: undefined,
    deploymentRecord: drifted,
    expected,
  });
  assert.equal(result.status, "unverified");
  assert.match(result.reason, /mevShieldRouter/);
});

test("local chain with an incomplete record stays unverified", () => {
  const partial = JSON.parse(recordJson);
  delete partial.policyAuthorization;
  const result = resolveMinimumOutputVerification({
    chainId: LOCAL_CHAIN_ID,
    buildFlagValue: undefined,
    deploymentRecord: JSON.stringify(partial),
    expected,
  });
  assert.equal(result.status, "unverified");
});

test("local chain record for another chain id stays unverified", () => {
  const foreign = JSON.stringify({
    ...JSON.parse(recordJson),
    chainId: SEPOLIA_CHAIN_ID,
  });
  const result = resolveMinimumOutputVerification({
    chainId: LOCAL_CHAIN_ID,
    buildFlagValue: undefined,
    deploymentRecord: foreign,
    expected,
  });
  assert.equal(result.status, "unverified");
});

test("unset or false flags never verify, even with a matching record off-chain", () => {
  for (const buildFlagValue of [undefined, "", "false", "TRUE", "1", "yes"]) {
    assert.equal(
      resolveMinimumOutputVerification({
        chainId: LOCAL_CHAIN_ID,
        buildFlagValue,
        deploymentRecord: recordJson,
        expected,
      }).status,
      "verified",
      "the record alone should still verify locally",
    );
    // ...but never on Sepolia, whatever the record says.
    assert.equal(
      resolveMinimumOutputVerification({
        chainId: SEPOLIA_CHAIN_ID,
        buildFlagValue,
        deploymentRecord: recordJson,
        expected,
      }).status,
      "unverified",
      `flag ${JSON.stringify(buildFlagValue)} must not open Sepolia`,
    );
  }
});

// ---------------------------------------------------------------------------
// Sepolia is unchanged: flag-gated, fail-closed
// ---------------------------------------------------------------------------

test("Sepolia without the flag is unverified", () => {
  const result = resolveMinimumOutputVerification({
    chainId: SEPOLIA_CHAIN_ID,
    buildFlagValue: undefined,
    deploymentRecord: undefined,
    expected,
  });
  assert.equal(result.status, "unverified");
});

test("Sepolia needs the literal true, exactly as before", () => {
  for (const buildFlagValue of ["false", "TRUE", "True", "1", "yes", " true!"]) {
    assert.equal(
      resolveMinimumOutputVerification({
        chainId: SEPOLIA_CHAIN_ID,
        buildFlagValue,
        deploymentRecord: undefined,
        expected,
      }).status,
      "unverified",
      `flag ${buildFlagValue} must not verify`,
    );
  }
  assert.deepEqual(
    resolveMinimumOutputVerification({
      chainId: SEPOLIA_CHAIN_ID,
      buildFlagValue: "true",
      deploymentRecord: undefined,
      expected,
    }),
    { status: "verified", source: "build-flag" },
  );
});

test("a local deployment record can never satisfy a Sepolia build", () => {
  // This is the property that keeps the Sepolia path exactly as strict as it
  // was: the new rule must not become a second way in.
  const result = resolveMinimumOutputVerification({
    chainId: SEPOLIA_CHAIN_ID,
    buildFlagValue: undefined,
    deploymentRecord: recordJson,
    expected,
  });
  assert.equal(result.status, "unverified");
  assert.match(result.reason, /VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true/);
});

test("an arbitrary non-local chain is flag-gated too", () => {
  assert.equal(
    resolveMinimumOutputVerification({
      chainId: 8453,
      buildFlagValue: undefined,
      deploymentRecord: recordJson,
      expected,
    }).status,
    "unverified",
  );
});

test("the explicit flag wins on the local chain as well", () => {
  assert.deepEqual(
    resolveMinimumOutputVerification({
      chainId: LOCAL_CHAIN_ID,
      buildFlagValue: "true",
      deploymentRecord: undefined,
      expected,
    }),
    { status: "verified", source: "build-flag" },
  );
});

// ---------------------------------------------------------------------------
// Record parsing and comparison in isolation
// ---------------------------------------------------------------------------

test("parses a complete record and rejects a field that is not an address", () => {
  const parsed = parseLocalDeploymentRecord(recordJson);
  assert.equal(parsed?.mevShieldHook, expected.mevShieldHook.toLowerCase());
  assert.equal(
    parseLocalDeploymentRecord(
      JSON.stringify({ ...JSON.parse(recordJson), mevShieldHook: "not-an-address" }),
    ),
    null,
  );
});

test("reports the first mismatched field in declaration order", () => {
  assert.equal(
    firstDeploymentMismatch(parseLocalDeploymentRecord(recordJson), expected),
    null,
  );
  const drifted = parseLocalDeploymentRecord(
    JSON.stringify({ ...JSON.parse(recordJson), poolManager: "0x" + "1".repeat(40) }),
  );
  assert.equal(firstDeploymentMismatch(drifted, expected), "poolManager");
});
