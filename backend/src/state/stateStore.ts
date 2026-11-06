export type RateLimitResult =
  | { ok: true }
  | { ok: false; retryAfterSeconds: number };

export interface SharedStateStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlMs: number): Promise<void>;
  take(key: string): Promise<string | null>;
  consumeRateLimit(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitResult>;
  close(): Promise<void>;
}

export class SharedStateUnavailableError extends Error {
  constructor() {
    super("Shared backend state is unavailable.");
    this.name = "SharedStateUnavailableError";
  }
}

type MemoryEntry = {
  value: string;
  expiresAt: number;
};

export class MemoryStateBackend {
  readonly values = new Map<string, MemoryEntry>();
  readonly rateLimits = new Map<string, { count: number; expiresAt: number }>();
}

export class MemoryStateStore implements SharedStateStore {
  constructor(
    private readonly backend = new MemoryStateBackend(),
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string): Promise<string | null> {
    const entry = this.backend.values.get(key);
    if (!entry || entry.expiresAt <= this.now()) {
      this.backend.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.backend.values.set(key, {
      value,
      expiresAt: this.now() + Math.max(1, ttlMs),
    });
  }

  async take(key: string): Promise<string | null> {
    const entry = this.backend.values.get(key);
    this.backend.values.delete(key);
    return !entry || entry.expiresAt <= this.now() ? null : entry.value;
  }

  async consumeRateLimit(
    key: string,
    windowMs: number,
    max: number,
  ): Promise<RateLimitResult> {
    const now = this.now();
    const current = this.backend.rateLimits.get(key);
    if (!current || current.expiresAt <= now) {
      this.backend.rateLimits.set(key, {
        count: 1,
        expiresAt: now + windowMs,
      });
      return { ok: true };
    }
    if (current.count >= max) {
      return {
        ok: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((current.expiresAt - now) / 1000),
        ),
      };
    }
    current.count += 1;
    return { ok: true };
  }

  async close(): Promise<void> {}
}
