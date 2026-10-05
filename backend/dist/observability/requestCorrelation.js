const POLICY_CORRELATION_TTL_MS = 60 * 60 * 1000;
const MAX_POLICY_CORRELATIONS = 10_000;
const requestIdsByPolicy = new Map();
export function trackPolicyRequest(policyId, requestId) {
    const now = Date.now();
    for (const [key, entry] of requestIdsByPolicy) {
        if (entry.expiresAt <= now) {
            requestIdsByPolicy.delete(key);
        }
    }
    if (requestIdsByPolicy.size >= MAX_POLICY_CORRELATIONS &&
        !requestIdsByPolicy.has(policyId.toLowerCase())) {
        const oldestKey = requestIdsByPolicy.keys().next().value;
        if (oldestKey) {
            requestIdsByPolicy.delete(oldestKey);
        }
    }
    requestIdsByPolicy.set(policyId.toLowerCase(), {
        requestId,
        expiresAt: now + POLICY_CORRELATION_TTL_MS,
    });
}
export function requestIdForPolicy(policyId) {
    const key = policyId.toLowerCase();
    const entry = requestIdsByPolicy.get(key);
    if (!entry) {
        return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
        requestIdsByPolicy.delete(key);
        return undefined;
    }
    return entry.requestId;
}
export function clearPolicyRequest(policyId) {
    requestIdsByPolicy.delete(policyId.toLowerCase());
}
