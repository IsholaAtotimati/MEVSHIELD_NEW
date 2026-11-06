/**
 * Policy lifetime constants.
 *
 * The backend is the source of truth for the ceiling: `POLICY_MAX_TTL_SECONDS`
 * in `backend/src/policy/policyRequest.ts` rejects any `expiry` more than 30
 * minutes past the server clock. That value is mirrored here only so the
 * frontend can assert its own requests stay inside it; raising it here changes
 * nothing on the server.
 */
export const POLICY_MAX_TTL_SECONDS = 30 * 60;

/**
 * Lifetime the UI requests for a new policy.
 *
 * Deliberately well inside the backend ceiling rather than at it. A policy is
 * a signed authorization that can be replayed until it expires, so a short
 * lifetime bounds the replay window; the extra headroom against the 30-minute
 * limit absorbs the wallet approval, registration transaction, and confirmation
 * latency, plus clock skew between the browser and the backend. Ten minutes is
 * enough for a user to approve, register, and execute one swap without pushing
 * the request against the ceiling.
 */
export const POLICY_TTL_SECONDS = 10 * 60;

/**
 * Derives the absolute expiry timestamp sent to the backend.
 *
 * Pure by design: taking `nowSeconds` as an argument lets tests prove the
 * derived expiry stays inside `POLICY_MAX_TTL_SECONDS` and in the future
 * without touching the clock.
 */
export function buildPolicyExpiry(nowSeconds: number): number {
  return Math.floor(nowSeconds) + POLICY_TTL_SECONDS;
}
