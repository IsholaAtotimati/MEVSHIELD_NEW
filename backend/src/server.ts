import "dotenv/config";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { AbiCoder, Wallet, keccak256 } from "ethers";

import { generatePolicy } from "./policy/policyGenerator.js";
import { signPolicy } from "./signer/policySigner.js";
import { httpLifecycleMiddleware } from "./middleware/httpLifecycle.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { startSepoliaMonitor } from "./monitor/sepolia.js";
import { logEvent } from "./observability/logger.js";
import { trackPolicyRequest } from "./observability/requestCorrelation.js";

const app = express();

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
app.use(requestIdMiddleware);
app.use(httpLifecycleMiddleware);
app.use(cors({ origin: FRONTEND_URL, exposedHeaders: ["x-request-id"] }));
app.use(express.json());

const PORT = Number(process.env.PORT ?? 4000);

const SIGNER_PRIVATE_KEY =
  process.env.SIGNER_PRIVATE_KEY?.trim() ||
  "0x00000000000000000000000000000000000000000000000000000000000A11CE";

const CHAIN_ID = Number(process.env.CHAIN_ID ?? 31337);

const VERIFIER_ADDRESS =
  process.env.POLICY_VERIFIER_ADDRESS ??
  process.env.VERIFIER_ADDRESS ??
  process.env.POLICY_VERIFIER ??
  "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0";

const wallet = new Wallet(SIGNER_PRIVATE_KEY);

const PolicyRequestSchema = z.object({
  poolId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  trader: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  nonce: z.string(),
  expiry: z.string(),
  amountSpecified: z.string(),
  zeroForOne: z.boolean(),
  sqrtPriceLimitX96: z.string()
});

const TransactionEventSchema = z.object({
  event: z.enum([
    "policy_registration_submitted",
    "policy_registration_failed",
    "swap_submitted",
    "swap_failed",
  ]),
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
  chainId: z.number().int(),
  contract: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  router: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  nonce: z.string().optional(),
  errorName: z.string().max(100).optional(),
  errorMessage: z.string().max(300).optional(),
});

const MEVSHIELD_ROUTER =
  (process.env.ROUTER_ADDRESS ?? process.env.MEVSHIELD_ROUTER)?.trim();

if (!MEVSHIELD_ROUTER) {
  throw new Error("MEVSHIELD_ROUTER is not set");
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "mevshield-backend",
    environment: process.env.NODE_ENV ?? "development",
    chainId: CHAIN_ID,
    sepoliaMonitor: getSepoliaMonitorStatus(),
  });
});

app.post("/policy", async (req, res) => {
  try {
    const input = PolicyRequestSchema.parse(req.body);
    const requestId = String(res.locals.requestId);

    if (input.trader.toLowerCase() !== MEVSHIELD_ROUTER.toLowerCase()) {
      return res.status(400).json({
        error: "Invalid policy trader",
        details: "The policy trader must be the configured MEVShield router."
      });
    }

    logEvent("info", "risk_analysis_started", {
      requestId,
      trader: input.trader,
      poolId: input.poolId,
      amountSpecified: input.amountSpecified,
      zeroForOne: input.zeroForOne,
    });

    const result = generatePolicy({
      poolId: input.poolId,
      trader: input.trader,
      nonce: BigInt(input.nonce),
      expiry: BigInt(input.expiry),
      amountSpecified: BigInt(input.amountSpecified),
      zeroForOne: input.zeroForOne,
      sqrtPriceLimitX96: BigInt(input.sqrtPriceLimitX96)
    });

    logEvent("info", "risk_analysis_completed", {
      requestId,
      riskLevel: result.riskLevel,
      maxLoss: result.policy.maxLoss.toString(),
      maxFee: result.policy.maxFee.toString(),
      estimatedLoss: result.actualLoss.toString(),
      estimatedFee: result.actualFee.toString(),
    });

    logEvent("info", "policy_created", {
      requestId,
      poolId: result.policy.poolId,
      trader: result.policy.trader,
      nonce: result.policy.nonce.toString(),
      expiry: result.policy.expiry.toString(),
      maxLoss: result.policy.maxLoss.toString(),
      maxFee: result.policy.maxFee.toString(),
      zeroForOne: result.policy.zeroForOne,
      amountSpecified: result.policy.amountSpecified.toString(),
      sqrtPriceLimitX96: result.policy.sqrtPriceLimitX96.toString(),
    });

    const signature = await signPolicy(
      wallet,
      result.policy,
      {
        chainId: CHAIN_ID,
        verifyingContract: VERIFIER_ADDRESS
      }
    );
    logEvent("info", "policy_signed", {
      requestId,
      signer: wallet.address,
      nonce: result.policy.nonce.toString(),
      expiry: result.policy.expiry.toString(),
    });

    const policyId = keccak256(
      AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "address", "uint256"],
        [
          result.policy.poolId,
          result.policy.trader,
          result.policy.nonce
        ]
      )
    );
    trackPolicyRequest(policyId, requestId);

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
      requestId,
    });
  } catch (error) {
    logEvent("error", "policy_request_failed", {
      requestId: String(res.locals.requestId),
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : String(error),
    });

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

app.post("/observability/transaction", (req, res) => {
  const parsed = TransactionEventSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Invalid transaction event",
      details: parsed.error.issues,
    });
  }

  const requestId = String(res.locals.requestId);
  const level = parsed.data.event.endsWith("_failed") ? "error" : "info";
  logEvent(level, parsed.data.event, {
    requestId,
    ...parsed.data,
  });
  res.status(202).json({ accepted: true, requestId });
});

const getSepoliaMonitorStatus = startSepoliaMonitor();

app.listen(PORT, "0.0.0.0", () => {
  logEvent("info", "backend_started", {
    port: PORT,
    chainId: CHAIN_ID,
    verifier: VERIFIER_ADDRESS,
  });
});
