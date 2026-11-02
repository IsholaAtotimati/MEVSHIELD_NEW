/**
 * Typed JSON error responses for the backend HTTP API.
 *
 * Single responsibility: build every non-2xx body from one place so status,
 * machine-readable `code`, human-readable `error` message, and `requestId`
 * stay in sync. Success payloads are untouched by design — this module only
 * shapes failures.
 *
 * Consumers: `src/server.ts` for every 400, 404, 500, and 503 response.
 * The `error` field keeps the historic wording so existing clients that read
 * `body.error` keep working; `code` and `requestId` are additive.
 */
import type { Response } from "express";

/** Statuses the API can return for a failed request. */
export type ApiErrorStatus = 400 | 404 | 500 | 503;

/**
 * Machine-readable failure reasons. Extend this union rather than passing a
 * free-form string so the frontend can switch on a closed set.
 */
export type ApiErrorCode =
  | "invalid_json"
  | "invalid_request"
  | "invalid_preview"
  | "invalid_pool"
  | "invalid_trader"
  | "invalid_minimum_output"
  | "not_found"
  | "policy_signing_disabled"
  | "signer_unavailable"
  | "pool_state_unavailable"
  | "internal_error";

export type ApiErrorBody = {
  error: string;
  code: ApiErrorCode;
  requestId: string;
  details?: unknown;
};

export type ApiErrorOptions = {
  /** Passed through as `details` (e.g. Zod issues or a demo-mode hint). */
  details?: unknown;
};

function requestIdOf(res: Response): string {
  return String(res.locals.requestId ?? "");
}

/**
 * Writes a typed error response and returns the response so route handlers can
 * `return sendApiError(...)` the way they used to `return res.status(...)`.
 */
export function sendApiError(
  res: Response,
  status: ApiErrorStatus,
  code: ApiErrorCode,
  message: string,
  options: ApiErrorOptions = {},
): Response {
  const body: ApiErrorBody = {
    error: message,
    code,
    requestId: requestIdOf(res),
    ...(options.details !== undefined ? { details: options.details } : {}),
  };
  return res.status(status).json(body);
}
