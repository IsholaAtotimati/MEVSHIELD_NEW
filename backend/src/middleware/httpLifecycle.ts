import type { RequestHandler } from "express";

import { logEvent } from "../observability/logger.js";

export const httpLifecycleMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = Date.now();
  const requestId = String(res.locals.requestId);

  res.once("finish", () => {
    logEvent("info", "http_request", {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
};
