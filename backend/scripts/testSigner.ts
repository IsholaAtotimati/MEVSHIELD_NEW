/**
 * Manual EIP-712 signing smoke test.
 *
 * Single responsibility: sign a fixture policy with a deterministic throwaway
 * key and assert the recovered address and digest, using the canonical types
 * from `src/policy/eip712.ts`.
 *
 * Run with `npm run signer:test` from `backend/`. Not part of the build; this
 * is a developer check, not a server entry point.
 */
import { Wallet, TypedDataEncoder, verifyTypedData, keccak256, toUtf8Bytes } from "ethers";

import { POLICY_TYPES, policyDomain, POLICY_TYPEHASH } from "../src/policy/eip712.js";
import type { Policy } from "../src/policy/policy.js";
import { signPolicy } from "../src/signer/policySigner.js";

const signerPrivateKey =
  "0x00000000000000000000000000000000000000000000000000000000000A11CE";

const wallet = new Wallet(signerPrivateKey);

const policy: Policy = {
  // Solidity: keccak256("ETH/USDC")
  poolId: keccak256(toUtf8Bytes("ETH/USDC")),
  trader: "0x0000000000000000000000000000000000001234",
  nonce: 1n,
  // Same logical value as the Solidity test: block.timestamp + 1 hours.
  // A fixed future timestamp keeps this deterministic off-chain.
  expiry: 3601n,
  maxLoss: 100n,
  maxFee: 5n,
  zeroForOne: true,
  amountSpecified: -100000000n,
  sqrtPriceLimitX96: 79228162514264337593543950336n,
  minAmountOut: 1n,
};

const config = {
  chainId: 31337,
  verifyingContract: "0x5615dEB798BB3E4dFa0139dFa1b3D433Cc23b72f",
};

const domain = policyDomain(config);

const signature = await signPolicy(wallet, policy, config);

const digest = TypedDataEncoder.hash(domain, POLICY_TYPES, policy);
const recovered = verifyTypedData(domain, POLICY_TYPES, policy, signature);

console.log("Typehash: ", POLICY_TYPEHASH);
console.log("Signer:   ", wallet.address);
console.log("Recovered:", recovered);
console.log("Digest:   ", digest);
console.log("Signature:", signature);

if (recovered.toLowerCase() !== wallet.address.toLowerCase()) {
  throw new Error("EIP-712 signer recovery failed");
}

console.log("EIP-712 SIGNATURE VERIFIED");
