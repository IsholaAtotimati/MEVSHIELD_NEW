#!/usr/bin/env node
/**
 * Compare Sepolia MEVShieldRouter runtime bytecode against local forge artifacts.
 *
 * Usage:
 *   node script/compare-router-bytecode.mjs [deployed.hex] [artifact.json...]
 *
 * Default deployed path: docs/reviews/deployed-router-6332.hex
 * Default artifact: out/MEVShieldRouter.sol/MEVShieldRouter.json
 *
 * Strips Solidity CBOR metadata tail and masks immutable slots from the artifact.
 */

import fs from "node:fs";
import path from "node:path";

const SELECTORS = {
  protectedPoolId: "f976fd28",
  protectedHook: "3ff8d5e4",
  poolManager: "dc4c90d3",
};

function normalizeHex(raw) {
  return raw.trim().replace(/^0x/i, "").toLowerCase();
}

/** Remove trailing CBOR metadata (starts with a2646970667358). */
function stripCborMetadata(hex) {
  const marker = "a2646970667358";
  const idx = hex.lastIndexOf(marker);
  if (idx === -1) return { hex, stripped: false };
  return { hex: hex.slice(0, idx), stripped: true };
}

function maskImmutables(hex, immutableReferences) {
  if (!immutableReferences || typeof immutableReferences !== "object") {
    return { hex, maskedSlots: 0 };
  }
  const chars = hex.split("");
  let maskedSlots = 0;
  for (const offsets of Object.values(immutableReferences)) {
    for (const { start, length } of offsets) {
      const byteStart = start * 2;
      const byteLen = length * 2;
      for (let i = byteStart; i < byteStart + byteLen && i < chars.length; i++) {
        chars[i] = "0";
      }
      maskedSlots += 1;
    }
  }
  return { hex: chars.join(""), maskedSlots };
}

function selectorReport(hex) {
  const report = {};
  for (const [name, sel] of Object.entries(SELECTORS)) {
    report[name] = hex.includes(sel) ? "present" : "absent";
  }
  return report;
}

function firstDiff(a, b) {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 2) {
    if (a.slice(i, i + 2) !== b.slice(i, i + 2)) {
      return { byteOffset: i / 2, local: a.slice(i, i + 2), deployed: b.slice(i, i + 2) };
    }
  }
  if (a.length !== b.length) {
    return { byteOffset: len / 2, local: `(len ${a.length / 2})`, deployed: `(len ${b.length / 2})` };
  }
  return null;
}

function compareArtifact(deployedNorm, artifactPath, label) {
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const localRaw = normalizeHex(artifact.deployedBytecode.object);
  const depStripped = stripCborMetadata(deployedNorm);
  const localStripped = stripCborMetadata(localRaw);
  const depMasked = maskImmutables(depStripped.hex, artifact.deployedBytecode.immutableReferences);
  const localMasked = maskImmutables(localStripped.hex, artifact.deployedBytecode.immutableReferences);

  const rawMatch = localRaw === deployedNorm;
  const normalizedMatch = localMasked.hex === depMasked.hex;

  return {
    label: label ?? path.basename(path.dirname(artifactPath)),
    artifactPath,
    localByteLen: localRaw.length / 2,
    deployedByteLen: deployedNorm.length / 2,
    rawMatch,
    normalizedMatch,
    firstDiffNormalized: normalizedMatch ? null : firstDiff(localMasked.hex, depMasked.hex),
    immutableSlotsMasked: localMasked.maskedSlots,
    cborStripped: { local: localStripped.stripped, deployed: depStripped.stripped },
    selectorsOnDeployed: selectorReport(deployedNorm),
    selectorsOnLocal: selectorReport(localRaw),
  };
}

function main() {
  const deployedPath = process.argv[2] ?? "docs/reviews/deployed-router-6332.hex";
  const artifactPaths = process.argv.slice(3);
  if (artifactPaths.length === 0) {
    artifactPaths.push("out/MEVShieldRouter.sol/MEVShieldRouter.json");
  }

  const deployedNorm = normalizeHex(fs.readFileSync(deployedPath, "utf8"));
  const results = artifactPaths.map((p, i) =>
    compareArtifact(deployedNorm, p, process.env[`LABEL_${i}`] ?? undefined)
  );

  const out = {
    router: "0x633282608B2fc66cD7572f5eF58e804063aa150D",
    deployedHexFile: deployedPath,
    deployedByteLen: deployedNorm.length / 2,
    selectorsOnDeployed: selectorReport(deployedNorm),
    comparisons: results,
    generatedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
