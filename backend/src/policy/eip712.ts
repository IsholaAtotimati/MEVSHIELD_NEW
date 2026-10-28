/**
 * Canonical EIP-712 declaration for a MEVShield `Policy`.
 *
 * Single responsibility: own the signing domain name/version, the `Policy`
 * field list, and the derived `POLICY_TYPEHASH`, so the off-chain types can
 * never drift from `src/PolicyVerifier.sol`.
 *
 * Consumers: `src/signer/policySigner.ts`, `scripts/testSigner.ts`,
 * `scripts/verifyApiSignature.ts`, and `src/policy/policySigning.test.ts`.
 * Import from here instead of re-declaring the field list.
 */
import {
  TypedDataEncoder,
  keccak256,
  toUtf8Bytes,
  type TypedDataDomain,
  type TypedDataField,
} from "ethers";

/** Must match the `EIP712("MEVShield", "1")` constructor in PolicyVerifier.sol. */
export const POLICY_DOMAIN_NAME = "MEVShield";
export const POLICY_DOMAIN_VERSION = "1";

/**
 * Field order is part of the hash. It mirrors the `Policy` struct in
 * `src/PolicyVerifier.sol` and the `POLICY_TYPEHASH` string constant there.
 */
export const POLICY_TYPES: Record<"Policy", TypedDataField[]> = {
  Policy: [
    { name: "poolId", type: "bytes32" },
    { name: "trader", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "maxLoss", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "zeroForOne", type: "bool" },
    { name: "amountSpecified", type: "int256" },
    { name: "sqrtPriceLimitX96", type: "uint160" },
    { name: "minAmountOut", type: "uint256" },
  ],
};

export type PolicyDomainConfig = {
  chainId: number;
  verifyingContract: string;
};

/** The EIP-712 domain every policy signature is scoped to. */
export function policyDomain(
  config: PolicyDomainConfig,
): TypedDataDomain {
  return {
    name: POLICY_DOMAIN_NAME,
    version: POLICY_DOMAIN_VERSION,
    chainId: config.chainId,
    verifyingContract: config.verifyingContract,
  };
}

/** Canonical type string, identical to the literal hashed on-chain. */
export const POLICY_TYPE_STRING = TypedDataEncoder.from(POLICY_TYPES).encodeType(
  "Policy",
);

/** `keccak256(POLICY_TYPE_STRING)` — equals `PolicyVerifier.POLICY_TYPEHASH`. */
export const POLICY_TYPEHASH = keccak256(toUtf8Bytes(POLICY_TYPE_STRING));
