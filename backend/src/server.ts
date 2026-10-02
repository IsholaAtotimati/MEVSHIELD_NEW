import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { AbiCoder, Wallet } from "ethers";

import { generatePolicy } from "./policy/policyGenerator.js";
import { signPolicy } from "./signer/policySigner.js";
import { MEVShieldClient } from "./chain/mevShieldClient.js";

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
app.use(cors({ origin: FRONTEND_URL }));
app.use(express.json());

const PORT = Number(process.env.PORT ?? 4000);

const SIGNER_PRIVATE_KEY =
  process.env.SIGNER_PRIVATE_KEY?.trim() ||
  "0x00000000000000000000000000000000000000000000000000000000000A11CE";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

const VERIFIER_ADDRESS =
  process.env.VERIFIER_ADDRESS ??
  process.env.POLICY_VERIFIER ??
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

const wallet = new Wallet(SIGNER_PRIVATE_KEY);
const chainClient = new MEVShieldClient();

const PolicyRequestSchema = z.object({
  poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.string(),
  expiry: z.string(),
  amountSpecified: z.string(),
  zeroForOne: z.boolean(),
  sqrtPriceLimitX96: z.string()
});

const PoolKeySchema = z.object({
  currency0: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  currency1: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  fee: z.number().int().nonnegative(),
  tickSpacing: z.number().int(),
  hooks: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
});

const SwapParamsSchema = z.object({
  zeroForOne: z.boolean(),
  amountSpecified: z.string(),
  sqrtPriceLimitX96: z.string()
});

const ExecuteSwapSchema = z.object({
  policy: PolicyRequestSchema.extend({
    maxLoss: z.string(),
    maxFee: z.string()
  }),
  signature: z.string().regex(/^0x[0-9a-fA-F]*$/),
  actualLoss: z.string(),
  actualFee: z.string(),
  poolKey: PoolKeySchema,
  swapParams: SwapParamsSchema,
  recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/)
});

const MEVSHIELD_ROUTER =
  process.env.MEVSHIELD_ROUTER?.trim();

if (!MEVSHIELD_ROUTER) {
  throw new Error("MEVSHIELD_ROUTER is not set");
}

const hookDataCoder = AbiCoder.defaultAbiCoder();

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    signer: wallet.address,
    chainId: CHAIN_ID,
    verifier: VERIFIER_ADDRESS
  });
});

app.post("/policy", async (req, res) => {
  try {
    const input = PolicyRequestSchema.parse(req.body);

    const result = generatePolicy({
      poolId: input.poolId,
      trader: input.trader,
      nonce: BigInt(input.nonce),
      expiry: BigInt(input.expiry),
      amountSpecified: BigInt(input.amountSpecified),
      zeroForOne: input.zeroForOne,
      sqrtPriceLimitX96: BigInt(input.sqrtPriceLimitX96)
    });

    const signature = await signPolicy(
      wallet,
      result.policy,
      {
        chainId: CHAIN_ID,
        verifyingContract: VERIFIER_ADDRESS
      }
    );

    const policyId = MEVShieldClient.policyId(
      result.policy.poolId,
      result.policy.trader,
      result.policy.nonce
    );

    const txHash = await chainClient.registerPolicy(
      result.policy.poolId,
      result.policy.trader,
      result.policy.nonce,
      result.policy.expiry,
      result.policy.maxLoss,
      result.policy.maxFee
    );

    const registered = await chainClient.isRegistered(
      result.policy.trader,
      result.policy.nonce
    );

    res.json({
      policy: {
        ...result.policy,
        nonce: result.policy.nonce.toString(),
        expiry: result.policy.expiry.toString(),
        maxLoss: result.policy.maxLoss.toString(),
        maxFee: result.policy.maxFee.toString(),
        amountSpecified: result.policy.amountSpecified.toString(),
        sqrtPriceLimitX96:
          result.policy.sqrtPriceLimitX96.toString()
      },
      actualLoss: result.actualLoss.toString(),
      actualFee: result.actualFee.toString(),
      riskLevel: result.riskLevel,
      signature,
      policyId,
      txHash,
      registered
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request",
        details: error.issues
      });
    }

    return res.status(500).json({
      error: error instanceof Error
        ? error.message
        : "Unknown error"
    });
  }
});

app.post("/execute-swap", async (req, res) => {
  try {
    const input = ExecuteSwapSchema.parse(req.body);

    if (input.policy.trader.toLowerCase() !== MEVSHIELD_ROUTER.toLowerCase()) {
      return res.status(400).json({
        error: "Invalid policy trader",
        details:
          "For MEVShieldRouter execution, policy.trader must equal MEVSHIELD_ROUTER."
      });
    }

    if (input.policy.zeroForOne !== input.swapParams.zeroForOne) {
      return res.status(400).json({
        error: "Policy/swap mismatch",
        details: "zeroForOne does not match the signed policy."
      });
    }

    if (
      BigInt(input.policy.amountSpecified) !==
      BigInt(input.swapParams.amountSpecified)
    ) {
      return res.status(400).json({
        error: "Policy/swap mismatch",
        details: "amountSpecified does not match the signed policy."
      });
    }

    if (
      BigInt(input.policy.sqrtPriceLimitX96) !==
      BigInt(input.swapParams.sqrtPriceLimitX96)
    ) {
      return res.status(400).json({
        error: "Policy/swap mismatch",
        details: "sqrtPriceLimitX96 does not match the signed policy."
      });
    }

    const registered = await chainClient.isRegistered(
      input.policy.trader,
      BigInt(input.policy.nonce)
    );

    if (!registered) {
      return res.status(400).json({
        error: "Policy is not registered"
      });
    }

    const consumed = await chainClient.isConsumed(
      input.policy.trader,
      BigInt(input.policy.nonce)
    );

    if (consumed) {
      return res.status(400).json({
        error: "Policy has already been consumed"
      });
    }

    const hookData = hookDataCoder.encode(
      [
        "tuple(bytes32 poolId,address trader,uint256 nonce,uint256 expiry,uint256 maxLoss,uint256 maxFee,bool zeroForOne,int256 amountSpecified,uint160 sqrtPriceLimitX96)",
        "bytes",
        "uint256",
        "uint256"
      ],
      [
        [
          input.policy.poolId,
          input.policy.trader,
          BigInt(input.policy.nonce),
          BigInt(input.policy.expiry),
          BigInt(input.policy.maxLoss),
          BigInt(input.policy.maxFee),
          input.policy.zeroForOne,
          BigInt(input.policy.amountSpecified),
          BigInt(input.policy.sqrtPriceLimitX96)
        ],
        input.signature,
        BigInt(input.actualLoss),
        BigInt(input.actualFee)
      ]
    );

    const result = await chainClient.executeSwap(
      input.poolKey,
      {
        zeroForOne: input.swapParams.zeroForOne,
        amountSpecified: BigInt(input.swapParams.amountSpecified),
        sqrtPriceLimitX96: BigInt(input.swapParams.sqrtPriceLimitX96)
      },
      hookData,
      input.recipient
    );

    res.json({
      success: true,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      policyId: MEVShieldClient.policyId(
        input.policy.poolId,
        input.policy.trader,
        BigInt(input.policy.nonce)
      ),
      payer: "backend deployer wallet",
      router: MEVSHIELD_ROUTER,
      recipient: input.recipient
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request",
        details: error.issues
      });
    }

    return res.status(500).json({
      error: error instanceof Error
        ? error.message
        : "Unknown error"
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MEVShield backend listening on port ${PORT}`);
  console.log(`Signer: ${wallet.address}`);
  console.log(`Chain ID: ${CHAIN_ID}`);
  console.log(`Verifier: ${VERIFIER_ADDRESS}`);
});
