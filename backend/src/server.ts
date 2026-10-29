import "dotenv/config";
import express, { type Express, type Request, type Response } from "express";
import cors from "cors";
import { z } from "zod";
import { AbiCoder, keccak256, type Wallet } from "ethers";
import { fileURLToPath } from "node:url";

import { generatePolicy } from "./policy/policyGenerator.js";
import {
  PoolStateUnavailableError,
  createProtectedPoolReader,
  type PoolStateReader,
} from "./risk/poolState.js";
import {
  previewRisk,
  RiskPreviewRequestSchema,
  RISK_MODEL,
  RISK_PREVIEW_DISCLAIMER,
} from "./risk/riskPreview.js";
import { signProtectedPolicy } from "./policy/policySigning.js";
import { PolicyRequestSchema } from "./policy/policyRequest.js";
import { httpLifecycleMiddleware } from "./middleware/httpLifecycle.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { sendApiError } from "./http/apiError.js";
import {
  startSepoliaMonitor,
  type SepoliaMonitorSnapshot,
} from "./monitor/sepolia.js";
import { logEvent } from "./observability/logger.js";
import { trackPolicyRequest } from "./observability/requestCorrelation.js";
import {
  assertConfiguredPoolId,
  EXPECTED_AUTHORIZED_SIGNER,
  EXPECTED_SEPOLIA_ROUTER,
  isLocalSepoliaDemoEnabled,
  loadBackendConfig,
  publicProtectedPoolConfig,
  type ProtectedPoolConfig,
} from "./config/runtimeConfig.js";

export type AppDependencies = {
  chainId: number;
  verifierAddress: string;
  routerAddress: string;
  protectedPool: ProtectedPoolConfig;
  policySigningEnabled: boolean;
  localDemoMode: boolean;
  signerWallet?: Wallet;
  getMonitorStatus: () => SepoliaMonitorSnapshot;
  readPoolState: PoolStateReader;
  frontendUrl?: string;
};

export function resolvePolicySigningEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const localDemo = isLocalSepoliaDemoEnabled(env);
  return env.MEVSHIELD_V2_POLICY_ENABLED === "true" || localDemo;
}

export function loadAppDependencies(
  env: NodeJS.ProcessEnv = process.env,
): AppDependencies {
  const localDemoMode = isLocalSepoliaDemoEnabled(env);
  const policySigningEnabled = resolvePolicySigningEnabled(env);
  const backendConfig = loadBackendConfig(
    env,
    EXPECTED_AUTHORIZED_SIGNER,
    EXPECTED_SEPOLIA_ROUTER,
    { requireSigner: policySigningEnabled },
  );

  return {
    chainId: backendConfig.chainId,
    verifierAddress: backendConfig.verifierAddress,
    routerAddress: backendConfig.routerAddress,
    protectedPool: backendConfig.protectedPool,
    policySigningEnabled,
    localDemoMode,
    signerWallet: backendConfig.signerWallet,
    getMonitorStatus: startSepoliaMonitor(),
    readPoolState: createProtectedPoolReader(
      env,
      backendConfig.protectedPool,
      backendConfig.chainId,
    ),
    frontendUrl: env.FRONTEND_URL,
  };
}

export function createApp(deps: AppDependencies): Express {
  const app = express();
  const frontendUrl = deps.frontendUrl ?? "http://localhost:5173";

  app.use(requestIdMiddleware);
  app.use(httpLifecycleMiddleware);
  app.use(cors({ origin: frontendUrl, exposedHeaders: ["x-request-id"] }));
  app.use(express.json());

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

  app.get("/health", (_req, res) => {
    const monitor = deps.getMonitorStatus();
    res.json({
      status: "ok",
      service: "mevshield-backend",
      environment: process.env.NODE_ENV ?? "development",
      chainId: deps.chainId,
      policySigningEnabled: deps.policySigningEnabled,
      localDemoMode: deps.localDemoMode,
      sepoliaMonitor: monitor,
    });
  });

  app.get("/config/protected-pool", (_req, res) => {
    res.json(publicProtectedPoolConfig(deps.chainId, deps.protectedPool));
  });

  app.post("/risk-preview", async (req, res) => {
    const parsed = RiskPreviewRequestSchema.safeParse(req.body);

    if (!parsed.success) {
      return sendApiError(
        res,
        400,
        "invalid_preview",
        "Invalid risk-preview request",
        { details: parsed.error.issues },
      );
    }

    if (BigInt(parsed.data.amountSpecified) === 0n) {
      return sendApiError(
        res,
        400,
        "invalid_preview",
        "amountSpecified must not be zero",
      );
    }

    try {
      const pool = await deps.readPoolState();
      const result = previewRisk(parsed.data, pool);

      if (!result.ok) {
        return sendApiError(res, 400, "invalid_preview", result.error);
      }

      return res.json(result.data);
    } catch (error) {
      if (error instanceof PoolStateUnavailableError) {
        return sendApiError(res, 503, "pool_state_unavailable", error.message);
      }
      return sendApiError(res, 500, "internal_error", "Internal error");
    }
  });

  app.post("/policy", async (req, res) => {
    // Feature gate first: when signing is off, the route is unavailable and we do
    // not validate policy fields (avoids misleading 400s on a disabled endpoint).
    if (!deps.policySigningEnabled) {
      return sendApiError(
        res,
        503,
        "policy_signing_disabled",
        "Policy signing is disabled until the v2 minimum-output contracts are deployed and verified.",
      );
    }

    try {
      const input = PolicyRequestSchema.parse(req.body);
      const requestId = String(res.locals.requestId);

      if (deps.localDemoMode && input.minAmountOut !== "1") {
        return sendApiError(
          res,
          400,
          "invalid_minimum_output",
          "Invalid demo minimum output",
          {
            details:
              "Local Sepolia demo policies must use a minimum output of exactly 1 base unit.",
          },
        );
      }

      if (!deps.localDemoMode && input.minAmountOut === "1") {
        return sendApiError(
          res,
          400,
          "invalid_minimum_output",
          "Invalid minimum output",
          {
            details:
              "A minimum output of 1 base unit is only allowed in local Sepolia demo mode.",
          },
        );
      }

      if (!deps.signerWallet) {
        return sendApiError(
          res,
          503,
          "signer_unavailable",
          "Policy signing is enabled but no signer wallet is configured.",
        );
      }

      const wallet = deps.signerWallet;

      try {
        assertConfiguredPoolId(input.poolId, deps.protectedPool);
      } catch {
        return sendApiError(
          res,
          400,
          "invalid_pool",
          "Invalid protected pool",
          {
            details:
              "The requested pool ID does not match the configured Sepolia WETH/USDC pool.",
          },
        );
      }

      if (input.trader.toLowerCase() !== deps.routerAddress.toLowerCase()) {
        return sendApiError(
          res,
          400,
          "invalid_trader",
          "Invalid policy trader",
          { details: "The policy trader must be the configured MEVShield router." },
        );
      }

      logEvent("info", "risk_analysis_started", {
        requestId,
        trader: input.trader,
        poolId: input.poolId,
        amountSpecified: input.amountSpecified,
        zeroForOne: input.zeroForOne,
      });

      const pool = await deps.readPoolState();
      const result = generatePolicy(
        {
          poolId: input.poolId,
          trader: input.trader,
          nonce: BigInt(input.nonce),
          expiry: BigInt(input.expiry),
          amountSpecified: BigInt(input.amountSpecified),
          zeroForOne: input.zeroForOne,
          sqrtPriceLimitX96: BigInt(input.sqrtPriceLimitX96),
          minAmountOut: BigInt(input.minAmountOut),
        },
        pool,
      );

      logEvent("info", "risk_analysis_completed", {
        requestId,
        riskLevel: result.riskLevel,
        maxLoss: result.policy.maxLoss.toString(),
        maxFee: result.policy.maxFee.toString(),
        estimatedLoss: result.estimatedLoss.toString(),
        estimatedFee: result.estimatedFee.toString(),
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
        minAmountOut: result.policy.minAmountOut.toString(),
      });

      const signature = await signProtectedPolicy(wallet, result.policy, {
        chainId: deps.chainId,
        verifierAddress: deps.verifierAddress,
        protectedPool: deps.protectedPool,
      });
      logEvent("info", "policy_signed", {
        requestId,
        signer: wallet.address,
        nonce: result.policy.nonce.toString(),
        expiry: result.policy.expiry.toString(),
      });

      const policyId = keccak256(
        AbiCoder.defaultAbiCoder().encode(
          ["bytes32", "address", "uint256"],
          [result.policy.poolId, result.policy.trader, result.policy.nonce],
        ),
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
          sqrtPriceLimitX96: result.policy.sqrtPriceLimitX96.toString(),
          minAmountOut: result.policy.minAmountOut.toString(),
        },
        estimatedLoss: result.estimatedLoss.toString(),
        estimatedFee: result.estimatedFee.toString(),
        riskLevel: result.riskLevel,
        model: RISK_MODEL,
        disclaimer: RISK_PREVIEW_DISCLAIMER,
        signature,
        policyId,
        requestId,
        demoMode: deps.localDemoMode,
      });
    } catch (error) {
      logEvent("error", "policy_request_failed", {
        requestId: String(res.locals.requestId),
        errorName: error instanceof Error ? error.name : "UnknownError",
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      if (error instanceof PoolStateUnavailableError) {
        return sendApiError(res, 503, "pool_state_unavailable", error.message);
      }

      if (error instanceof z.ZodError) {
        return sendApiError(res, 400, "invalid_request", "Invalid request", {
          details: error.issues,
        });
      }

      return sendApiError(res, 500, "internal_error", "Internal error");

    }
  });

  app.post("/observability/transaction", (req, res) => {
    const parsed = TransactionEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return sendApiError(
        res,
        400,
        "invalid_request",
        "Invalid transaction event",
        { details: parsed.error.issues },
      );
    }

    const requestId = String(res.locals.requestId);
    const level = parsed.data.event.endsWith("_failed") ? "error" : "info";
    logEvent(level, parsed.data.event, {
      requestId,
      ...parsed.data,
    });
    res.status(202).json({ accepted: true, requestId });
  });

  // Unknown routes answer with the same JSON error shape as every other
  // failure instead of Express's default HTML page.
  app.use((req, res) => {
    sendApiError(
      res,
      404,
      "not_found",
      `No route for ${req.method} ${req.path}`,
    );
  });

  app.use(
    (
      error: unknown,
      req: Request,
      res: Response,
      next: express.NextFunction,
    ) => {
      if (error instanceof SyntaxError) {
        return sendApiError(res, 400, "invalid_json", "Invalid JSON body");
      }
      return next(error);
    },
  );

  return app;
}

const PORT = Number(process.env.PORT ?? 4000);

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return fileURLToPath(import.meta.url) === entry;
}

export function startServer(
  deps: AppDependencies = loadAppDependencies(),
): Express {
  const app = createApp(deps);

  if (deps.localDemoMode) {
    logEvent("warn", "local_sepolia_demo_signing_enabled", {
      minimumOutputBaseUnits: "1",
      warning: "This demo minimum is not meaningful slippage protection.",
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    logEvent("info", "backend_started", {
      port: PORT,
      chainId: deps.chainId,
      verifier: deps.verifierAddress,
    });
  });

  return app;
}

if (isDirectExecution()) {
  startServer();
}
