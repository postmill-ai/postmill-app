import { Injectable } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Idempotency guard for mutating AI Designer socket events.
 *
 * Keys are scoped by (sessionId, nonce) for in-session events. The `start`
 * event is scoped by (orgId, userId, nonce) because no session exists yet.
 * All keys expire after 5 minutes — long enough to survive reconnects but
 * short enough to let the user retry with the same nonce later.
 *
 * Uses a single atomic `SET ... NX EX` so concurrent requests with the same
 * nonce cannot both pass.
 */
@Injectable()
export class AiDesignerIdempotencyService {
  private readonly _prefix = 'ai-designer:nonce';
  private readonly _ttlSeconds = 300;

  /**
   * Idempotency key for the `start` event (no session yet).
   */
  async start(nonce: string, userId: string, orgId: string): Promise<boolean> {
    const key = `${this._prefix}:start:${orgId}:${userId}:${nonce}`;
    return this._checkAndSet(key);
  }

  /**
   * Idempotency key for in-session events (`form:submit`, `accept:plan`).
   */
  async forSession(nonce: string, sessionId: string): Promise<boolean> {
    const key = `${this._prefix}:${sessionId}:${nonce}`;
    return this._checkAndSet(key);
  }

  /**
   * Release a consumed `start` nonce. Called when the operation failed after
   * the claim (budget/guardrail/limit rejection) so a legitimate client retry
   * with the same nonce is not locked out for the full TTL.
   */
  async releaseStart(
    nonce: string,
    userId: string,
    orgId: string
  ): Promise<void> {
    await ioRedis.del(`${this._prefix}:start:${orgId}:${userId}:${nonce}`);
  }

  /** Release a consumed in-session nonce (see `releaseStart`). */
  async releaseForSession(nonce: string, sessionId: string): Promise<void> {
    await ioRedis.del(`${this._prefix}:${sessionId}:${nonce}`);
  }

  private async _checkAndSet(key: string): Promise<boolean> {
    const result = await ioRedis.set(key, '1', 'EX', this._ttlSeconds, 'NX');
    return result === 'OK';
  }
}
