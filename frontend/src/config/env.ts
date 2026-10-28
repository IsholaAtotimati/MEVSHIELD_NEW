export const BACKEND_URL =
  import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export const SEPOLIA_DEMO_MODE =
  import.meta.env.DEV && import.meta.env.VITE_SEPOLIA_DEMO_MODE === "true";

export const MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED =
  import.meta.env.VITE_MINIMUM_OUTPUT_V2_DEPLOYMENT_VERIFIED === "true";

export function isLocalBackendUrl(value: string): boolean {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(value).hostname,
    );
  } catch {
    return false;
  }
}
