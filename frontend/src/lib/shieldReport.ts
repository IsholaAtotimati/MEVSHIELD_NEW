/**
 * Which face the Shield report panel is showing.
 *
 * The Trade page already decides these states for its own logic; this module
 * only names the ordering so the panel and its test agree on one place. It
 * does not gate anything: the readiness checks and the execute gate live in
 * `protectedQuote.ts` and the hooks, and are not consulted here.
 */
export type ShieldPhase = "idle" | "risk" | "sign" | "receipt";

export type ShieldPhaseInput = {
  /** An execution result exists, so the swap already filled. */
  hasReceipt: boolean;
  /** A registered policy exists for the current swap. */
  hasPolicy: boolean;
  /** A risk preview exists and still matches the current inputs. */
  riskMatchesInputs: boolean;
};

/**
 * A receipt outranks a policy, and a policy outranks a risk preview, because
 * each later stage already implies the earlier one happened.
 */
export function resolveShieldPhase(input: ShieldPhaseInput): ShieldPhase {
  if (input.hasReceipt) return "receipt";
  if (input.hasPolicy) return "sign";
  if (input.riskMatchesInputs) return "risk";
  return "idle";
}

/**
 * Panel heading per phase. The wording follows the extension panel, which
 * changes its title as the swap advances rather than keeping one label.
 */
export const SHIELD_PHASE_TITLE: Record<ShieldPhase, string> = {
  idle: "Shield report",
  risk: "Before you sign",
  sign: "Policy registered",
  receipt: "This swap is protected",
};
