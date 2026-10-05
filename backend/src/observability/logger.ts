type LogLevel = "debug" | "info" | "warn" | "error";

type LogFields = Record<string, unknown>;

const SERVICE = "mevshield-backend";
const ENVIRONMENT = process.env.NODE_ENV ?? "development";
const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};
const configuredLevel = (process.env.LOG_LEVEL ?? "info").toLowerCase();
const minimumLevel: LogLevel =
  configuredLevel in LEVEL_WEIGHT
    ? (configuredLevel as LogLevel)
    : "info";

export function logEvent(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
): void {
  if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[minimumLevel]) {
    return;
  }

  const entry = {
    service: SERVICE,
    environment: ENVIRONMENT,
    timestamp: new Date().toISOString(),
    level,
    event,
    ...fields,
  };

  const output = JSON.stringify(entry, (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value,
  );

  if (level === "error") {
    console.error(output);
  } else if (level === "warn") {
    console.warn(output);
  } else if (level === "debug") {
    console.debug(output);
  } else {
    console.info(output);
  }
}
