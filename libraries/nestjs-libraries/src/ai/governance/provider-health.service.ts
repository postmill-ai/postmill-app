import { Injectable, OnModuleInit } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

export interface ProviderHealthRecord {
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  successCount: number;
  errorCount: number;
  consecutiveErrors: number;
}

@Injectable()
export class ProviderHealthService implements OnModuleInit {
  private _records = new Map<string, ProviderHealthRecord>();
  private _redisKey = 'ai:provider-health';
  private readonly _redisTTL = 604800; // 7 days
  private readonly _pruneInactiveDays = 7;
  // NOTE: must be a plain field, NOT a constructor parameter-property. A primitive
  // `constructor(private _defaultThreshold = 5)` on an @Injectable() makes Nest try to
  // DI-resolve a `number` param (metadata `Object`) → UnknownDependenciesException on boot.
  private _defaultThreshold = 5;

  constructor() {}

  async recordSuccess(providerId: string) {
    const r = this._getOrCreate(providerId);
    r.lastSuccessAt = Date.now();
    r.successCount++;
    r.consecutiveErrors = 0;
    await this._syncToRedis(providerId, r);
  }

  async recordError(providerId: string) {
    const r = this._getOrCreate(providerId);
    r.lastErrorAt = Date.now();
    r.errorCount++;
    r.consecutiveErrors++;
    await this._syncToRedis(providerId, r);
  }

  getHealth(providerId: string): ProviderHealthRecord | null {
    return this._records.get(providerId) ?? null;
  }

  getAllHealth(): Record<string, ProviderHealthRecord> {
    const out: Record<string, ProviderHealthRecord> = {};
    for (const [id, rec] of this._records) {
      out[id] = { ...rec };
    }
    return out;
  }

  isUnhealthy(providerId: string, threshold = this._defaultThreshold): boolean {
    const r = this._records.get(providerId);
    if (!r) return false;
    if (r.successCount === 0 && r.errorCount > 0) return true;
    return r.consecutiveErrors >= threshold;
  }

  private async _syncToRedis(providerId: string, record: ProviderHealthRecord) {
    try {
      await ioRedis.hset(this._redisKey, providerId, JSON.stringify(record));
      await ioRedis.expire(this._redisKey, this._redisTTL);
    } catch {
      // Redis unavailable — degrade gracefully to in-memory only
    }
  }

  async onModuleInit() {
    await this.hydrateFromRedis();
  }

  async hydrateFromRedis() {
    try {
      const data = await ioRedis.hgetall(this._redisKey);
      const now = Date.now();
      const cutoff = now - this._pruneInactiveDays * 24 * 60 * 60 * 1000;
      for (const [id, json] of Object.entries(data)) {
        try {
          const record = JSON.parse(json as string);
          if ((record.lastSuccessAt ?? 0) < cutoff && (record.lastErrorAt ?? 0) < cutoff) {
            continue; // prune — no activity in the prune window
          }
          this._records.set(id, record);
        } catch { /* skip corrupt entries */ }
      }
    } catch {
      // Redis unavailable — start fresh
    }
  }

  private _getOrCreate(providerId: string): ProviderHealthRecord {
    let r = this._records.get(providerId);
    if (!r) {
      r = {
        lastSuccessAt: null,
        lastErrorAt: null,
        successCount: 0,
        errorCount: 0,
        consecutiveErrors: 0,
      };
      this._records.set(providerId, r);
    }
    return r;
  }
}
