/**
 * Contract verification rows for the Network page.
 *
 * Each row answers one question: does the configured address match the address
 * that is actually deployed? That question only has an answer when the observed
 * value was read from chain, so every row either compares a configured constant
 * against an observation supplied by `useProtocol`, or states that it cannot.
 *
 * Kept as a pure function, free of React, so the invariant that a row can
 * actually report a mismatch is tested directly (see
 * `networkVerification.test.mjs`).
 */

export type VerificationState = "pass" | "mismatch" | "not-checked";

/** The expected side: the addresses this app is configured to talk to. */
export type ConfiguredContracts = {
  poolManager: string;
  mevShieldHook: string;
  policyRegistry: string;
  policyVerifier: string;
  policyAuthorization: string;
  mevShieldRouter: string;
};

/**
 * The observed side: values `useProtocol` reads from deployed contracts.
 *
 * `authorization` is the hook's `authorization()` immutable, which is the only
 * on-chain statement about which authorization contract is in use; `registry`
 * and `verifier` come from that authorization contract.
 */
export type ObservedDeployment = {
  poolManager?: string | null;
  authorization?: string | null;
  registry?: string | null;
  verifier?: string | null;
};

export type ContractVerificationRow = {
  name: string;
  expected: string;
  observed: string | null;
  state: VerificationState;
  /** Why a row is unverified, or null when the row reached a verdict. */
  reason: string | null;
};

export const VERIFICATION_STATE_LABELS: Record<VerificationState, string> = {
  pass: "Pass",
  mismatch: "Mismatch",
  "not-checked": "Not checked",
};

/** No contract we read reports this address, so there is nothing to compare. */
const NO_ON_CHAIN_SOURCE = "no on-chain source";

/** The chain read has not resolved yet. */
const AWAITING_READ = "no chain read yet";

type VerificationSpec =
  | {
      name: string;
      contract: keyof ConfiguredContracts;
      observedFrom: keyof ObservedDeployment;
    }
  | {
      name: string;
      contract: keyof ConfiguredContracts;
      uncheckedReason: string;
    };

const VERIFICATION_SPECS: readonly VerificationSpec[] = [
  {
    name: "PoolManager",
    contract: "poolManager",
    observedFrom: "poolManager",
  },
  {
    // The hook address is configuration only: no PoolManager getter exposes a
    // pool key's hook, so reading through the configured hook cannot confirm
    // that it is the hook this app intends to use.
    name: "MEVShieldHook",
    contract: "mevShieldHook",
    uncheckedReason: NO_ON_CHAIN_SOURCE,
  },
  {
    name: "PolicyRegistry",
    contract: "policyRegistry",
    observedFrom: "registry",
  },
  {
    name: "PolicyVerifier",
    contract: "policyVerifier",
    observedFrom: "verifier",
  },
  {
    name: "PolicyAuthorization",
    contract: "policyAuthorization",
    observedFrom: "authorization",
  },
  {
    // The router exposes only `poolManager()` and `executeSwap`, and neither the
    // hook nor the authorization records it. Its own getter would show which
    // PoolManager it trusts, not that it is the router we expect.
    name: "MEVShieldRouter",
    contract: "mevShieldRouter",
    uncheckedReason: NO_ON_CHAIN_SOURCE,
  },
];

function normaliseAddress(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function buildRow(
  spec: VerificationSpec,
  contracts: ConfiguredContracts,
  observed: ObservedDeployment,
): ContractVerificationRow {
  const expected = contracts[spec.contract];

  if (!("observedFrom" in spec)) {
    return {
      name: spec.name,
      expected,
      observed: null,
      state: "not-checked",
      reason: spec.uncheckedReason,
    };
  }

  const value = normaliseAddress(observed[spec.observedFrom]);
  if (value === null) {
    return {
      name: spec.name,
      expected,
      observed: null,
      state: "not-checked",
      reason: AWAITING_READ,
    };
  }

  return {
    name: spec.name,
    expected,
    observed: value,
    state: value === expected.toLowerCase() ? "pass" : "mismatch",
    reason: null,
  };
}

/**
 * Builds the verification rows from the configured addresses and the values
 * observed on chain. Rows with no observation are reported as `not-checked`
 * rather than defaulting to a verdict.
 */
export function buildVerificationRows(input: {
  contracts: ConfiguredContracts;
  observed?: ObservedDeployment;
}): ContractVerificationRow[] {
  const observed = input.observed ?? {};
  return VERIFICATION_SPECS.map((spec) =>
    buildRow(spec, input.contracts, observed),
  );
}
