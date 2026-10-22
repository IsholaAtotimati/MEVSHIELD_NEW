import assert from "node:assert/strict";
import test from "node:test";
import { verifyTypedData, Wallet } from "ethers";
import {
  EXPECTED_PROTECTED_POOL,
  type ProtectedPoolConfig,
} from "../config/runtimeConfig.js";
import type { Policy } from "./policy.js";
import { signProtectedPolicy } from "./policySigning.js";
import { signPolicy, getPolicyTypes } from "../signer/policySigner.js";

const wallet = new Wallet(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const protectedPool: ProtectedPoolConfig = { ...EXPECTED_PROTECTED_POOL };
const config = {
  chainId: 11155111,
  verifierAddress: "0x9DF6c29bD323B61f83f1D3214041bf08f1267544",
  protectedPool,
};
const policy: Policy = {
  poolId: protectedPool.poolId,
  trader: "0xE57525678cbf6417F685727b77551316a3De3bba",
  nonce: 1n,
  expiry: 2n,
  maxLoss: 3n,
  maxFee: 4n,
  zeroForOne: false,
  amountSpecified: -5n,
  sqrtPriceLimitX96: 6n,
  minAmountOut: 7n,
};

test("does not invoke the policy signer for an unconfigured pool ID", async () => {
  let signingAttempted = false;
  const mismatchedPolicy = {
    ...policy,
    poolId: `0x${"11".repeat(32)}`,
  };

  await assert.rejects(
    signProtectedPolicy(
      wallet,
      mismatchedPolicy,
      config,
      async () => {
        signingAttempted = true;
        return "0x";
      },
    ),
    /does not match the configured protected pool/,
  );
  assert.equal(signingAttempted, false);
});

test("signs a policy only for the configured pool ID", async () => {
  let signingAttempted = false;
  const signature = await signProtectedPolicy(
    wallet,
    policy,
    config,
    async () => {
      signingAttempted = true;
      return "0xsignature";
    },
  );
  assert.equal(signingAttempted, true);
  assert.equal(signature, "0xsignature");
});

test("minimum output is part of the EIP-712 signature", async () => {
  const signature = await signPolicy(wallet, policy, {
    chainId: config.chainId,
    verifyingContract: config.verifierAddress,
  });
  const domain = {
    name: "MEVShield",
    version: "1",
    chainId: config.chainId,
    verifyingContract: config.verifierAddress,
  };
  assert.equal(
    verifyTypedData(domain, getPolicyTypes(), policy, signature).toLowerCase(),
    wallet.address.toLowerCase(),
  );

  const changedBound = { ...policy, minAmountOut: policy.minAmountOut + 1n };
  assert.notEqual(
    verifyTypedData(domain, getPolicyTypes(), changedBound, signature).toLowerCase(),
    wallet.address.toLowerCase(),
  );
});
