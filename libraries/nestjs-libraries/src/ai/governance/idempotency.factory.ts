import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { idempotentExpress } from '@reaatech/idempotency-middleware-express';
import { RedisAdapter } from '@reaatech/idempotency-middleware-adapter-redis';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import type { Request, Response, NextFunction } from 'express';

@Injectable()
export class IdempotencyFactory implements OnModuleInit {
  private _logger = new Logger(IdempotencyFactory.name);
  private _middleware:
    | ((req: Request, res: Response, next: NextFunction) => Promise<void>)
    | null = null;

  async onModuleInit() {
    try {
      const adapter = new RedisAdapter(ioRedis);
      await adapter.connect();
      this._middleware = idempotentExpress(adapter, {
        ttl: 86_400,
        errorHandler: (_err, _req, res, _next) => {
          res.status(409).json({ error: 'Idempotency conflict' });
        },
      });
    } catch (err) {
      this._logger.error(
        `IDEMPOTENCY DISABLED — Redis unavailable (${(err as Error).message}). Idempotency middleware is null; duplicate requests will NOT be deduplicated. This is acceptable in dev but should be fixed in production.`,
      );
    }
  }

  getMiddleware() {
    return this._middleware;
  }
}
