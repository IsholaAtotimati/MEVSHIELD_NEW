/**
 * Status colouring shared by the tables, so a page never decides for itself
 * whether a word is good or bad.
 *
 * `ok` renders mint, `no` renders bad. Anything that is neither a success nor
 * a failure gets `null` and keeps the normal text colour.
 */
export type StatusTone = "ok" | "no";

export type ActivityStatus =
  | "registered"
  | "executed"
  | "reverted"
  | "failed"
  | "enforced";

const FAILED_STATUSES: ActivityStatus[] = ["reverted", "failed"];

/**
 * A reverted or failed record is the only outcome that counted against the
 * trader. Registered, executed and enforced all mean the policy did its job.
 */
export function activityStatusTone(status: ActivityStatus): StatusTone {
  return FAILED_STATUSES.includes(status) ? "no" : "ok";
}

/**
 * Address verification: the observed on-chain address must equal the expected
 * build-time address. Comparison ignores case because addresses are hex.
 */
export function verificationTone(
  observed: string | null,
  expected: string,
): StatusTone {
  return observed?.toLowerCase() === expected.toLowerCase() ? "ok" : "no";
}
