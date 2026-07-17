import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

// Create a mock Redis implementation for testing environments
class MockRedis {
  private data: Map<string, any> = new Map();

  async get(key: string) {
    return this.data.get(key);
  }

  async set(key: string, value: any, ttl?: number) {
    this.data.set(key, value);
    return 'OK';
  }

  async del(key: string) {
    this.data.delete(key);
    return 1;
  }

  async exists(key: string) {
    return this.data.has(key) ? 1 : 0;
  }

  async ping() {
    return 'PONG';
  }
}

function buildRedisClient(): Redis {
  const url = process.env.REDIS_URL;

  if (!url) {
    return new MockRedis() as unknown as Redis;
  }

  const isTls = url.startsWith('rediss://');

  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 10000,
    enableReadyCheck: false,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 100, 3000),
    reconnectOnError: (err) => {
      const message = err.message.toLowerCase();
      // Reconnect on read-only or connection errors; otherwise surface the error.
      return message.includes('ereadonly') || message.includes('econnreset');
    },
    ...(isTls ? { tls: { rejectUnauthorized: false } } : {}),
  });

  client.on('error', (err) => {
    Logger.error(`Redis connection error: ${err.message}`, RedisService.name);
  });

  client.on('connect', () => {
    Logger.log('Redis client connected', RedisService.name);
  });

  // Best-effort boot-time connectivity check. A failure is logged but not fatal;
  // individual callers already degrade when Redis is unavailable.
  client.ping().catch((err) => {
    Logger.warn(`Redis ping failed at startup: ${err.message}`, RedisService.name);
  });

  return client;
}

// Use real Redis if REDIS_URL is defined, otherwise use MockRedis
const rawClient = buildRedisClient();

/**
 * @deprecated Use RedisService instead
 */
export const ioRedis = rawClient;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private _client: Redis;

  constructor() {
    this._client = rawClient;
  }

  get client(): Redis {
    return this._client;
  }

  // Cheap readiness probe for /health/ready. Throws if the client cannot reach Redis.
  async ping(): Promise<'PONG'> {
    return this._client.ping() as Promise<'PONG'>;
  }

  // Drain the connection on graceful shutdown (SIGTERM/SIGINT → app.close()). MockRedis
  // (no REDIS_URL) has no `quit`, so guard on it.
  async onModuleDestroy() {
    if (!process.env.REDIS_URL) {
      return;
    }
    try {
      await this._client.quit();
    } catch (err) {
      Logger.warn(
        `Redis quit on shutdown failed: ${(err as Error).message}`,
        RedisService.name
      );
    }
  }

  async get(key: string) {
    return this._client.get(key);
  }

  async set(key: string, value: any, ttl?: number) {
    if (ttl) {
      return this._client.set(key, value, 'EX', ttl);
    }
    return this._client.set(key, value);
  }

  async del(key: string) {
    return this._client.del(key);
  }

  async exists(key: string) {
    return this._client.exists(key);
  }
}
