import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const requestIdMiddleware: RequestHandler = (_req, res, next) => {
  const suppliedId = _req.get("x-request-id")?.trim();
  const requestId =
    suppliedId && REQUEST_ID_PATTERN.test(suppliedId)
      ? suppliedId
      : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader("x-request-id", requestId);
  next();
};
