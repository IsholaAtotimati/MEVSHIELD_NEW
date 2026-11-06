/**
 * Whether the signed-minimum-output v2 deployment may be treated as verified.
 *
 * ## Why this is not just a build flag any more
 *
 * The v2 minimum-output path (hook + router + policy authorization) is only
 * trusted after its *deployed bytecode* has been checked against a recorded
 * execution. On Sepolia that deployment was produced by someone else and the
 * app cannot audit it, so the only honest answer is a human-supplied assertion
 * in the build: `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true`, defaulting
 * to false. That stays exactly as it was, and nothing here can open it.
 *
 * The local chain is a different situation. There, the contract addresses the
 * app reads are the ones `script/DeployLocal.s.sol` wrote into this machine's
 * own anvil state minutes earlier, and the deployment record in the stack
 * volume (`/deployments/local.json`) is that deploy's output. Comparing the
 * configuration the build was compiled with against that record is a real
 * check of the same claim the Sepolia flag stands for, not an assertion of
 * faith: if the record is absent, unreadable, for another chain, or names even
 * one address the build is not configured for, the gate stays closed.
 *
 * ## Scope, deliberately narrow
 *
 * - Only chain 31337 can be verified this way. Every other chain is flag-gated.
 * - The flag still works everywhere, including locally.
 * - Pool token addresses are not part of the comparison: they have no compiled
 *   local default (the mock pair is deployed per stack), so they are supplied
 *   by the same environment that supplies the record and could not disagree
 *   with it in a meaningful way.
 * - This function only decides trust in the *deployment*. It does not check a
 *   quote, a pool, a policy, or anything about the swap itself.
 *
 * Pure: no `import.meta`, no `process.env`, no I/O, so it can be unit tested
 * directly under `node --test` and called from `config/env.ts`.
 */

// Extension included so this module also loads under `node --test` with type
// stripping, which resolves relative paths literally. `allowImportingTsExtensions`
// is on, and the bundler resolves it the same way.
import { LOCAL_CHAIN_ID } from "../config/chainEnv.ts";

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * The shape the deploy scripts write to `/deployments/local.json`, restricted to
 * the fields this rule reads. Unknown fields are ignored; missing required
 * fields make the record unusable rather than defaulting to a match.
 */
export type LocalDeploymentRecord = {
  chainId: number;
  poolManager: string;
  policyRegistry: string;
  policyVerifier: string;
  policyAuthorization: string;
  mevShieldHook: string;
  mevShieldRouter: string;
  authorizedSigner: string;
};

/** Addresses the build was compiled against, from `lib/contracts.ts`. */
export type ExpectedLocalDeployment = {
  poolManager: string;
  policyRegistry: string;
  policyVerifier: string;
  policyAuthorization: string;
  mevShieldHook: string;
  mevShieldRouter: string;
  authorizedSigner: string;
};

export type MinimumOutputVerification =
  | {
      status: "verified";
      /** Which input carried the trust: the build flag, or a matching record. */
      source: "build-flag" | "local-deployment-record";
    }
  | {
      status: "unverified";
      /** Why, in words an operator can act on. Never rendered as a success. */
      reason: string;
    };

const RECORD_FIELDS = [
  "poolManager",
  "policyRegistry",
  "policyVerifier",
  "policyAuthorization",
  "mevShieldHook",
  "mevShieldRouter",
  "authorizedSigner",
] as const;

/**
 * Parses the deployment record JSON.
 *
 * Returns null for anything that is not a complete record for the local chain:
 * a truncated volume write, an empty variable, a record from another network,
 * or a field that is not an address. A partially valid record must never be
 * usable, because the point of the check is that every address agrees.
 */
export function parseLocalDeploymentRecord(
  value: string | undefined,
): LocalDeploymentRecord | null {
  const raw = value?.trim();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const record = parsed as Record<string, unknown>;
  if (record.chainId !== LOCAL_CHAIN_ID) return null;

  for (const field of RECORD_FIELDS) {
    const address = record[field];
    if (typeof address !== "string" || !ADDRESS_PATTERN.test(address)) {
      return null;
    }
  }

  return {
    chainId: LOCAL_CHAIN_ID,
    poolManager: record.poolManager as string,
    policyRegistry: record.policyRegistry as string,
    policyVerifier: record.policyVerifier as string,
    policyAuthorization: record.policyAuthorization as string,
    mevShieldHook: record.mevShieldHook as string,
    mevShieldRouter: record.mevShieldRouter as string,
    authorizedSigner: record.authorizedSigner as string,
  };
}

/**
 * The first record field whose address disagrees with the build configuration,
 * or null when every one agrees. Address comparison is case-insensitive because
 * the deploy script lower-cases and `lib/contracts.ts` uses checksum casing.
 */
export function firstDeploymentMismatch(
  record: LocalDeploymentRecord,
  expected: ExpectedLocalDeployment,
): (typeof RECORD_FIELDS)[number] | null {
  for (const field of RECORD_FIELDS) {
    if (record[field].toLowerCase() !== expected[field].toLowerCase()) {
      return field;
    }
  }
  return null;
}

/**
 * Resolves whether the signed-minimum-output v2 deployment is verified.
 *
 * Order matters:
 *  1. An explicit `VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true` wins on any
 *     chain. This is the only way a Sepolia build can ever be verified.
 *  2. Off the local chain, nothing else applies. A deployment record cannot
 *     substitute for the flag, so the Sepolia path stays fail-closed and
 *     exactly as strict as it was.
 *  3. On the local chain, a complete record from this chain that matches every
 *     configured address counts as verified. No record, a broken record, or a
 *     single mismatched address keeps the gate shut.
 */
export function resolveMinimumOutputVerification(input: {
  chainId: number;
  buildFlagValue: string | undefined;
  deploymentRecord: string | undefined;
  expected: ExpectedLocalDeployment;
}): MinimumOutputVerification {
  if (input.buildFlagValue?.trim() === "true") {
    return { status: "verified", source: "build-flag" };
  }

  if (input.chainId !== LOCAL_CHAIN_ID) {
    return {
      status: "unverified",
      reason:
        `Chain ${input.chainId} requires ` +
        "VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED=true; a local deployment " +
        "record never opens the gate on another chain.",
    };
  }

  const record = parseLocalDeploymentRecord(input.deploymentRecord);
  if (!record) {
    return {
      status: "unverified",
      reason:
        "No usable local deployment record was compiled in " +
        "(VITE_LOCAL_DEPLOYMENT_RECORD must be the JSON from the running " +
        `stack's /deployments/local.json for chain ${LOCAL_CHAIN_ID}).`,
    };
  }

  const mismatch = firstDeploymentMismatch(record, input.expected);
  if (mismatch) {
    return {
      status: "unverified",
      reason:
        `The local deployment record's ${mismatch} ` +
        `(${record[mismatch]}) does not match the configured ` +
        `${input.expected[mismatch]}.`,
    };
  }

  return { status: "verified", source: "local-deployment-record" };
}
