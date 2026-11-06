import type { Hex } from "viem";

import { BACKEND_URL } from "../config/env";
import { CHAIN_ID, CONTRACTS } from "../lib/contracts";
import { createRequestId, logFrontend, safeError } from "./observability";

export { createRequestId };

export async function reportTransactionEvent(
  requestId: string,
  event:
    | "policy_registration_submitted"
    | "policy_registration_failed"
    | "swap_submitted"
    | "swap_failed",
  details: {
    txHash?: Hex;
    nonce?: string;
    error?: unknown;
  } = {},
): Promise<void> {
  const failure = details.error ? safeError(details.error) : undefined;

  try {
    const response = await fetch(`${BACKEND_URL}/observability/transaction`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-request-id": requestId,
      },
      body: JSON.stringify({
        event,
        txHash: details.txHash,
        chainId: CHAIN_ID,
        contract: event.startsWith("policy_registration")
          ? CONTRACTS.policyAuthorization
          : undefined,
        router: event.startsWith("swap_") ? CONTRACTS.mevShieldRouter : undefined,
        nonce: details.nonce,
        ...failure,
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Backend rejected transaction telemetry (${response.status}).`,
      );
    }
  } catch (error) {
    logFrontend("telemetry_delivery_failed", {
      requestId,
      event,
      ...safeError(error),
    });
  }
}
