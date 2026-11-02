import { CHAIN_ID } from "./chain";
import { CONTRACTS } from "../lib/contracts";
import { resolveMinimumOutputVerification } from "../lib/minimumOutputVerification";
import { resolveDemoMode } from "./chainEnv";

export const BACKEND_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Deterministic demo estimate path.
 *
 * Requires `VITE_SEPOLIA_DEMO_MODE=true`. On Sepolia it additionally requires
 * the Vite dev server, so a production bundle stays off the demo path exactly
 * as before. On the local anvil chain (31337) a production bundle is allowed,
 * because the only way to serve that chain is a built bundle and the tokens on
 * it are mock tokens with no value. See `resolveDemoMode` for the rule and
 * `docs/runbook/local-test-flow.md` for how the local build sets it.
 */
export const SEPOLIA_DEMO_MODE = resolveDemoMode({
  chainId: CHAIN_ID,
  devBuild: import.meta.env.DEV,
  flagValue: import.meta.env.VITE_SEPOLIA_DEMO_MODE,
});

/**
 * Whether the signed-minimum-output v2 deployment is trusted.
 *
 * Two ways to be true, both narrow:
 *
 *  - `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true`. The only path on
 *    Sepolia, unchanged and still defaulting to false.
 *  - The local chain (31337) with a compiled-in deployment record that matches
 *    every configured contract address. Local means this machine's own anvil
 *    and its own deploy output, so the claim is checkable rather than assumed.
 *
 * Everything else is false. See `lib/minimumOutputVerification.ts` for the rule
 * and why the local chain is different.
 */
const minimumOutputVerification = resolveMinimumOutputVerification({
  chainId: CHAIN_ID,
  buildFlagValue: import.meta.env.VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED,
  deploymentRecord: import.meta.env.VITE_LOCAL_DEPLOYMENT_RECORD,
  expected: CONTRACTS,
});

export const MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED =
  minimumOutputVerification.status === "verified";

/**
 * Why the deployment is or is not verified, for the Network page and the
 * runbook. `null` when verified.
 */
export const MINIMUM_OUTPUT_V2_DEPLOYMENT_UNVERIFIED_REASON =
  minimumOutputVerification.status === "verified"
    ? null
    : minimumOutputVerification.reason;

export function isLocalBackendUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(value).hostname,
    );
  } catch {
    return false;
  }
}
