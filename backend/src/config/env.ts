/**
 * Environment variable resolution for backend configuration.
 *
 * Single responsibility: turn raw `process.env` strings into trimmed values and
 * resolve the aliases for variables that were renamed, so the precedence order
 * for an env var is declared exactly once. It performs no I/O, holds no state,
 * and never decides whether a value is acceptable for a deployment — callers
 * keep their own checks, because runtime config treats a bad address as fatal
 * while the Sepolia monitor treats the router as optional.
 *
 * Consumers: `src/config/runtimeConfig.ts` (verifier and router) and
 * `src/monitor/sepolia.ts` (RPC, registry, hook, router). Import these helpers
 * instead of declaring another local `firstConfigured`.
 */

/**
 * Returns the first value that is present after trimming, or `undefined`.
 * Empty and whitespace-only strings are treated as unset.
 */
export function firstConfigured(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value && value.trim())?.trim();
}

/** `SEPOLIA_RPC_URL`, falling back to the generic `RPC_URL`. */
export function resolveSepoliaRpcUrl(
  env: NodeJS.ProcessEnv,
): string | undefined {
  return firstConfigured(env.SEPOLIA_RPC_URL, env.RPC_URL);
}

/** `POLICY_VERIFIER_ADDRESS`, then `VERIFIER_ADDRESS`, then `POLICY_VERIFIER`. */
export function resolveVerifierAddress(
  env: NodeJS.ProcessEnv,
): string | undefined {
  return firstConfigured(
    env.POLICY_VERIFIER_ADDRESS,
    env.VERIFIER_ADDRESS,
    env.POLICY_VERIFIER,
  );
}

/** `POLICY_REGISTRY_ADDRESS`, falling back to the legacy `POLICY_REGISTRY`. */
export function resolveRegistryAddress(
  env: NodeJS.ProcessEnv,
): string | undefined {
  return firstConfigured(env.POLICY_REGISTRY_ADDRESS, env.POLICY_REGISTRY);
}

/** `HOOK_ADDRESS`, falling back to the legacy `MEVSHIELD_HOOK_ADDRESS`. */
export function resolveHookAddress(
  env: NodeJS.ProcessEnv,
): string | undefined {
  return firstConfigured(env.HOOK_ADDRESS, env.MEVSHIELD_HOOK_ADDRESS);
}

/**
 * `ROUTER_ADDRESS`, falling back to the legacy `MEVSHIELD_ROUTER`.
 * `ROUTER_ADDRESS` always wins when both are set.
 */
export function resolveRouterAddress(
  env: NodeJS.ProcessEnv,
): string | undefined {
  return firstConfigured(env.ROUTER_ADDRESS, env.MEVSHIELD_ROUTER);
}
