import type { Address } from "viem";

import { BACKEND_URL } from "../config/env";

type AuthResponse = {
  token: string;
  address: string;
  expiresAt: string;
};

let cachedSession: { address: string; token: string; expiresAtMs: number } | null =
  null;

export async function authenticateWallet(
  walletClient: {
    signMessage(args: { account: Address; message: string }): Promise<`0x${string}`>;
  },
  address: Address,
): Promise<string> {
  if (
    cachedSession &&
    cachedSession.address.toLowerCase() === address.toLowerCase() &&
    cachedSession.expiresAtMs > Date.now() + 30_000
  ) {
    return cachedSession.token;
  }

  const nonceResponse = await fetch(`${BACKEND_URL}/auth/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });
  const nonceBody = (await nonceResponse.json()) as {
    message?: unknown;
    error?: unknown;
  };
  if (!nonceResponse.ok || typeof nonceBody.message !== "string") {
    throw new Error(
      typeof nonceBody.error === "string"
        ? nonceBody.error
        : "Authentication nonce request failed.",
    );
  }

  const signature = await walletClient.signMessage({
    account: address,
    message: nonceBody.message,
  });
  const verifyResponse = await fetch(`${BACKEND_URL}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: nonceBody.message, signature }),
  });
  const verifyBody = (await verifyResponse.json()) as Partial<AuthResponse> & {
    error?: unknown;
  };
  if (
    !verifyResponse.ok ||
    typeof verifyBody.token !== "string" ||
    typeof verifyBody.address !== "string" ||
    typeof verifyBody.expiresAt !== "string" ||
    verifyBody.address.toLowerCase() !== address.toLowerCase()
  ) {
    throw new Error(
      typeof verifyBody.error === "string"
        ? verifyBody.error
        : "Wallet authentication failed.",
    );
  }

  const expiresAtMs = Date.parse(verifyBody.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    throw new Error("Backend returned an invalid authentication session.");
  }
  cachedSession = {
    address,
    token: verifyBody.token,
    expiresAtMs,
  };
  return verifyBody.token;
}

export function clearAuthenticatedWallet(address?: Address): void {
  if (!address || cachedSession?.address.toLowerCase() === address.toLowerCase()) {
    cachedSession = null;
  }
}
