import { randomUUID } from "node:crypto";
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
export const requestIdMiddleware = (_req, res, next) => {
    const suppliedId = _req.get("x-request-id")?.trim();
    const requestId = suppliedId && REQUEST_ID_PATTERN.test(suppliedId)
        ? suppliedId
        : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
};
