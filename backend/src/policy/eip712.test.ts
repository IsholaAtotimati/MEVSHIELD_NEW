import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { keccak256, toUtf8Bytes } from "ethers";

import {
  POLICY_DOMAIN_NAME,
  POLICY_DOMAIN_VERSION,
  POLICY_TYPEHASH,
  POLICY_TYPE_STRING,
  POLICY_TYPES,
  policyDomain,
} from "./eip712.js";

const verifierSourcePath = fileURLToPath(
  new URL("../../../src/PolicyVerifier.sol", import.meta.url),
);

/**
 * Read the `POLICY_TYPEHASH = keccak256("...")` string literal straight out of
 * the Solidity source so this test fails if either side drifts.
 */
function solidityTypeString(): string {
  const source = readFileSync(verifierSourcePath, "utf8");
  const match = source.match(/POLICY_TYPEHASH\s*=\s*keccak256\(\s*"([^"]+)"/);
  assert.ok(
    match,
    "Could not find the POLICY_TYPEHASH keccak256 string in src/PolicyVerifier.sol",
  );
  return match[1];
}

test("off-chain Policy type string matches the Solidity POLICY_TYPEHASH literal", () => {
  assert.equal(POLICY_TYPE_STRING, solidityTypeString());
});

test("derived POLICY_TYPEHASH equals keccak256 of the Solidity constant", () => {
  const solidityHash = keccak256(toUtf8Bytes(solidityTypeString()));
  assert.equal(POLICY_TYPEHASH, solidityHash);
});

/**
 * Hash pinned from `src/PolicyVerifier.sol`, where POLICY_TYPEHASH is declared
 * as keccak256("Policy(bytes32 poolId,address trader,uint256 nonce,uint256
 * expiry,uint256 maxLoss,uint256 maxFee,bool zeroForOne,int256 amountSpecified,
 * uint160 sqrtPriceLimitX96,uint256 minAmountOut)"). Hardcoded so a refactor of
 * both the test parser and the type list cannot mask a real change.
 */
test("POLICY_TYPEHASH is pinned to the deployed verifier constant", () => {
  assert.equal(
    POLICY_TYPEHASH,
    "0x274faee7fd43329c5c5ae4722f876248b6c299b0cde79a77d1d78f3f49af60c1",
  );
});

test("field order and types are exactly the Solidity struct order", () => {
  assert.deepEqual(
    POLICY_TYPES.Policy.map(({ name, type }) => `${type} ${name}`),
    [
      "bytes32 poolId",
      "address trader",
      "uint256 nonce",
      "uint256 expiry",
      "uint256 maxLoss",
      "uint256 maxFee",
      "bool zeroForOne",
      "int256 amountSpecified",
      "uint160 sqrtPriceLimitX96",
      "uint256 minAmountOut",
    ],
  );
});

test("domain name and version match the PolicyVerifier EIP712 constructor", () => {
  const source = readFileSync(verifierSourcePath, "utf8");
  assert.match(
    source,
    new RegExp(`EIP712\\("${POLICY_DOMAIN_NAME}", "${POLICY_DOMAIN_VERSION}"\\)`),
  );
});

test("policyDomain carries the chain ID and verifying contract through", () => {
  const domain = policyDomain({
    chainId: 11155111,
    verifyingContract: "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f",
  });

  assert.deepEqual(domain, {
    name: "MEVShield",
    version: "1",
    chainId: 11155111,
    verifyingContract: "0x716f9315BC9c2AB98a82DDE78ca86887Ab61b79f",
  });
});
