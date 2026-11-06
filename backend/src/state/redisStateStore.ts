import { createClient } from "redis";
import {
  SharedStateUnavailableError,
  type SharedStateStore,
  type RateLimitResult,
} from "./stateStore.js";

const TAKE_SCRIPT = `
local value = redis.call("GET", KEYS[1])
if value then
  redis.call("DEL", KEYS[1])
end
return value
`;

const RATE_LIMIT_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if count > tonumber(ARGV[2]) then
  return {0, ttl}
end
return {1, ttl}
`;

export class RedisStateStore implements SharedStateStore {
  private constructor(
    private readonly client: ReturnType<typeof createClient>,
  ) {}

  static async connect(url: string): Promise<RedisStateStore> {
    const client = createClient({
      url,
      socket: {
        connectTimeout: 5_000,
        reconnectStrategy: (retries) =>
          retries > 3 ? new Error("Redis connection retries exhausted.") : Math.min(retries * 200, 1_000),
      },
    });
    client.on("error", () => {
      process.emitWarning("Redis shared state connection encountered an error.");
    });
    try {
      await client.connect();
      return new RedisStateStore(client);
    } catch {
      client.destroy();
      throw new SharedStateUnavailableError();
    }
  }

  async get(key: string): Promise<string | null> {
    try {
      return await this.client.get(key);
    } catch {
      throw new SharedStateUnavailableError();
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    try {
      await this.client.set(key, value, { PX: Math.max(1, ttlMs) });
    } catch {
      throw new SharedStateUnavailableError();
    }
  }

  async take(key: string): Promise<string | null> {
    try {
      return await this.client.eval(TAKE_SCRIPT, { keys: [key] }) as string | null;
    } catch {
      throw new SharedStateUnavailableError();
    }
  }

  async consumeRateLimit(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitResult> {
    try {
      const result = await this.client.eval(RATE_LIMIT_SCRIPT, {
        keys: [key],
        arguments: [String(windowMs), String(max)],
      }) as [number, number];
      return result[0] === 1
        ? { ok: true }
        : { ok: false, retryAfterSeconds: Math.max(1, Math.ceil(result[1] / 1000)) };
    } catch {
      throw new SharedStateUnavailableError();
    }
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.destroy();
    }
  }
}
