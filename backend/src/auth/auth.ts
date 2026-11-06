import { randomBytes } from "node:crypto";
import { getAddress } from "ethers";
import { SiweMessage } from "siwe";
import {
  SharedStateUnavailableError,
  type SharedStateStore,
} from "../state/stateStore.js";

export type AuthConfig = {
  chainId: number;
  applicationOrigin: string;
  nonceTtlMs?: number;
  sessionTtlMs?: number;
};

type AuthRecord = {
  address: string;
  expiresAt: number;
};

export type AuthResult =
  | { ok: true; address: string; token: string; expiresAt: number }
  | { ok: false; code: "invalid_auth" | "auth_unavailable"; message: string };

const NONCE_PREFIX = "mevshield:auth:nonce:";
const SESSION_PREFIX = "mevshield:auth:session:";

function parseRecord(value: string | null): AuthRecord | null {
  if (!value) return null;
  try {
    const record = JSON.parse(value) as Partial<AuthRecord>;
    if (
      typeof record.address !== "string" ||
      typeof record.expiresAt !== "number" ||
      !Number.isFinite(record.expiresAt)
    ) {
      return null;
    }
    return { address: getAddress(record.address), expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

export class AuthService {
  private readonly nonceTtlMs: number;
  private readonly sessionTtlMs: number;
  private readonly origin: URL;
  private readonly domain: string;

  constructor(
    private readonly config: AuthConfig,
    private readonly store: SharedStateStore,
  ) {
    this.origin = new URL(config.applicationOrigin);
    this.domain = this.origin.host;
    this.nonceTtlMs = config.nonceTtlMs ?? 5 * 60_000;
    this.sessionTtlMs = config.sessionTtlMs ?? 15 * 60_000;
    if (!["http:", "https:"].includes(this.origin.protocol)) {
      throw new Error("Authentication application origin must use HTTP or HTTPS.");
    }
    if (
      this.origin.origin !== config.applicationOrigin ||
      this.origin.pathname !== "/" ||
      this.origin.search ||
      this.origin.hash
    ) {
      throw new Error("Authentication application origin must be an exact origin without a path.");
    }
  }

  async issueNonce(address: string, now = Date.now()) {
    let normalizedAddress: string;
    try {
      normalizedAddress = getAddress(address);
    } catch {
      throw new Error("A valid wallet address is required.");
    }

    const nonce = randomBytes(24).toString("hex");
    const expiresAt = now + this.nonceTtlMs;
    await this.store.set(
      `${NONCE_PREFIX}${nonce}`,
      JSON.stringify({ address: normalizedAddress, expiresAt }),
      this.nonceTtlMs,
    );
    const message = new SiweMessage({
      domain: this.domain,
      address: normalizedAddress,
      statement: "Sign in to MEVShield protected execution.",
      uri: this.origin.origin,
      version: "1",
      chainId: this.config.chainId,
      nonce,
      issuedAt: new Date(now).toISOString(),
      expirationTime: new Date(expiresAt).toISOString(),
    });

    return { message: message.prepareMessage(), nonce, expiresAt };
  }

  async verify(
    messageText: string,
    signature: string,
    now = Date.now(),
  ): Promise<AuthResult> {
    let message: SiweMessage;
    try {
      message = new SiweMessage(messageText);
    } catch {
      return {
        ok: false,
        code: "invalid_auth",
        message: "Invalid authentication message.",
      };
    }

    let record: AuthRecord | null;
    try {
      record = parseRecord(await this.store.take(`${NONCE_PREFIX}${message.nonce}`));
    } catch (error) {
      if (error instanceof SharedStateUnavailableError) {
        return {
          ok: false,
          code: "auth_unavailable",
          message: "Authentication is temporarily unavailable.",
        };
      }
      throw error;
    }
    if (
      !record ||
      record.expiresAt <= now ||
      message.address.toLowerCase() !== record.address.toLowerCase() ||
      message.domain !== this.domain ||
      message.uri !== this.origin.origin ||
      message.chainId !== this.config.chainId
    ) {
      return {
        ok: false,
        code: "invalid_auth",
        message: "Authentication nonce is invalid, expired, or bound to another request.",
      };
    }

    try {
      const verified = await message.verify({
        signature,
        domain: this.domain,
        nonce: message.nonce,
        time: new Date(now).toISOString(),
      }, { suppressExceptions: true });
      if (!verified.success || verified.data.address.toLowerCase() !== record.address.toLowerCase()) {
        return {
          ok: false,
          code: "invalid_auth",
          message: "Authentication signature is invalid.",
        };
      }
    } catch {
      return {
        ok: false,
        code: "invalid_auth",
        message: "Authentication signature is invalid.",
      };
    }

    const token = randomBytes(32).toString("base64url");
    const expiresAt = now + this.sessionTtlMs;
    try {
      await this.store.set(
        `${SESSION_PREFIX}${token}`,
        JSON.stringify({ address: record.address, expiresAt }),
        this.sessionTtlMs,
      );
    } catch (error) {
      if (error instanceof SharedStateUnavailableError) {
        return {
          ok: false,
          code: "auth_unavailable",
          message: "Authentication is temporarily unavailable.",
        };
      }
      throw error;
    }
    return { ok: true, address: record.address, token, expiresAt };
  }

  async getSession(token: string | undefined, now = Date.now()) {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const session = parseRecord(await this.store.get(`${SESSION_PREFIX}${token}`));
    if (!session || session.expiresAt <= now) return null;
    return { address: session.address, expiresAt: session.expiresAt };
  }
}
