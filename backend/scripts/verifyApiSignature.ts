/**
 * EIP-712 drift guard for the policy signature shape.
 *
 * Single responsibility: recover the signer of one fixed fixture and fail if the
 * recovered address changes. It exists to catch an accidental edit to the domain,
 * field order, or field types in `src/policy/eip712.ts`; it is not a captured
 * production signature and proves nothing about a live backend.
 *
 * Run with `npm run signer:verify` from `backend/`. Not part of the build.
 */
import { verifyTypedData } from "ethers";

import { POLICY_TYPES, policyDomain } from "../src/policy/eip712.js";

const domain = policyDomain({
  chainId: 31337,
  verifyingContract: "0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f",
});

const policy = {
  poolId:
    "0x7ea41243798f304c9efd5c2e0c82a273090146c4718014ecc8570eb373df2b78",
  trader: "0x0000000000000000000000000000000000001234",
  nonce: 1n,
  expiry: 3601n,
  maxLoss: 200000n,
  maxFee: 20000n,
  zeroForOne: true,
  amountSpecified: -100000000n,
  sqrtPriceLimitX96: 79228162514264337593543950336n,
  minAmountOut: 1n,
};

/**
 * Produced by signing `policy` with the deterministic key `0x00..0011` over the
 * canonical types above. The previous fixture in this script predated the
 * `minAmountOut` field, so it recovered a different address and the check had
 * been failing before this module existed.
 */
const signature =
  "0xb6bf3dfbc56c7fd1e7b239e60bd16c31ab17b2cea0a0c17999940b4d8f54681416cc1022447bcf6dff99d5e8e5280f1e4a0fc18872eb263b8db9e78ff75dd6eb1b";

const expected = "0x252Dae0A4b9d9b80F504F6418acd2d364C0c59cD";

const recovered = verifyTypedData(domain, POLICY_TYPES, policy, signature);

console.log("Recovered:", recovered);
console.log("Expected: ", expected);

if (recovered.toLowerCase() !== expected.toLowerCase()) {
  throw new Error(
    "EIP-712 shape drifted: the fixture no longer recovers the expected signer.",
  );
}

console.log("EIP-712 SHAPE UNCHANGED");
