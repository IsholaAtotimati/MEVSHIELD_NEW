export function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function logFrontend(
  event: string,
  data: Record<string, unknown>,
): void {
  console.info(
    JSON.stringify({
      service: "mevshield-frontend",
      environment: import.meta.env.MODE,
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }),
  );
}

export function safeError(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  const sanitize = (message: string) =>
    message
      .replace(/0x[0-9a-fA-F]{80,}/g, "[redacted hex data]")
      .slice(0, 240);

  if (error instanceof Error) {
    return {
      errorName: error.name,
      errorMessage: sanitize(error.message),
    };
  }

  return {
    errorName: "UnknownError",
    errorMessage: sanitize(String(error)),
  };
}
