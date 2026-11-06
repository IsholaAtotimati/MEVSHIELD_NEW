import { useCallback, useEffect, useState } from "react";

import { BACKEND_URL } from "../config/env";
import { parseHealthBody } from "../lib/apiValidation";
import type { BackendHealth } from "../lib/types";

export type BackendHealthState = "checking" | "ok" | "failed";

export function useBackendHealth() {
  const [healthState, setHealthState] =
    useState<BackendHealthState>("checking");
  const [health, setHealth] = useState<BackendHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    setHealthState("checking");
    setHealthError(null);
    if (!BACKEND_URL) {
      setHealthState("failed");
      setHealth(null);
      setHealthError(
        "VITE_API_URL is not configured for this production frontend build.",
      );
      return;
    }
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      if (!response.ok) {
        setHealthState("failed");
        setHealth(null);
        setHealthError(`Backend health returned HTTP ${response.status}.`);
        return;
      }
      const body = parseHealthBody(await response.json());
      if (!body) {
        setHealthState("failed");
        setHealth(null);
        setHealthError("Backend health response was invalid.");
        return;
      }
      if (body.status !== "ok") {
        setHealthState("failed");
        setHealth(body);
        setHealthError("Backend reports that it is not healthy.");
        return;
      }
      setHealth(body);
      setHealthState("ok");
    } catch {
      setHealthState("failed");
      setHealth(null);
      setHealthError(
        "Backend unavailable. Check VITE_API_URL, Railway health, and backend CORS.",
      );
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

  return { healthState, health, healthError, refreshHealth };
}
