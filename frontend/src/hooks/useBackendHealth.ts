import { useCallback, useEffect, useState } from "react";

import { BACKEND_URL } from "../config/env";
import type { BackendHealth } from "../lib/types";

export type BackendHealthState = "checking" | "ok" | "failed";

export function useBackendHealth() {
  const [healthState, setHealthState] =
    useState<BackendHealthState>("checking");
  const [health, setHealth] = useState<BackendHealth | null>(null);

  const refreshHealth = useCallback(async () => {
    setHealthState("checking");
    try {
      const response = await fetch(`${BACKEND_URL}/health`);
      if (!response.ok) {
        setHealthState("failed");
        setHealth(null);
        return;
      }
      const body = (await response.json()) as BackendHealth;
      if (body.status !== "ok") {
        setHealthState("failed");
        setHealth(body);
        return;
      }
      setHealth(body);
      setHealthState("ok");
    } catch {
      setHealthState("failed");
      setHealth(null);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const interval = window.setInterval(() => void refreshHealth(), 15_000);
    return () => window.clearInterval(interval);
  }, [refreshHealth]);

  return { healthState, health, refreshHealth };
}
