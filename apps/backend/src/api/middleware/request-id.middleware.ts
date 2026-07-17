import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response, NextFunction } from 'express';

// Attaches a correlation id to every request: reuses an inbound `x-request-id`
// if present, otherwise mints one. Exposed on the response header and stashed on
// `req.requestId` so handlers/logs can reference a single id per request.
// Inbound ids are client-controlled, so sanitize before they reach logs/headers:
// allow only url-safe id chars and cap the length (defends against log injection /
// header smuggling via newlines or huge values). Anything invalid → a fresh uuid.
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request & { requestId?: string }, res: Response, next: NextFunction) {
    const incoming = req.headers['x-request-id'];
    const candidate = Array.isArray(incoming) ? incoming[0] : incoming;
    const requestId =
      candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
    req.requestId = requestId;
    res.setHeader('x-request-id', requestId);
    next();
  }
}
