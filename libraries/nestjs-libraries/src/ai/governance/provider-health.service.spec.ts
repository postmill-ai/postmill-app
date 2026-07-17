import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockHset, mockExpire, mockHgetall } = vi.hoisted(() => ({
  mockHset: vi.fn().mockResolvedValue(1),
  mockExpire: vi.fn().mockResolvedValue(1),
  mockHgetall: vi.fn().mockResolvedValue({}),
}));

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    hset: mockHset,
    expire: mockExpire,
    hgetall: mockHgetall,
  },
}));

import { ProviderHealthService } from './provider-health.service';

function freshService(threshold = 5) {
  return new ProviderHealthService(threshold);
}

describe('ProviderHealthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHset.mockResolvedValue(1);
    mockExpire.mockResolvedValue(1);
    mockHgetall.mockResolvedValue({});
  });

  describe('recordSuccess()', () => {
    it('creates a new record if one does not exist', () => {
      const service = freshService();
      service.recordSuccess('provider-1');
      expect(service.getHealth('provider-1')).not.toBeNull();
    });

    it('increments successCount', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      await service.recordSuccess('provider-1');
      expect(service.getHealth('provider-1')!.successCount).toBe(2);
    });

    it('resets consecutiveErrors to 0', async () => {
      const service = freshService();
      await service.recordError('provider-1');
      await service.recordError('provider-1');
      expect(service.getHealth('provider-1')!.consecutiveErrors).toBe(2);

      await service.recordSuccess('provider-1');
      expect(service.getHealth('provider-1')!.consecutiveErrors).toBe(0);
    });

    it('sets lastSuccessAt to a recent timestamp', async () => {
      const service = freshService();
      const before = Date.now();
      await service.recordSuccess('provider-1');
      const after = Date.now();
      const ts = service.getHealth('provider-1')!.lastSuccessAt!;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('does not zero out lastErrorAt', async () => {
      const service = freshService();
      await service.recordError('provider-1');
      const errorTs = service.getHealth('provider-1')!.lastErrorAt;
      expect(errorTs).not.toBeNull();

      await service.recordSuccess('provider-1');
      expect(service.getHealth('provider-1')!.lastErrorAt).toBe(errorTs);
    });

    it('syncs to Redis', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      expect(mockHset).toHaveBeenCalledWith(
        'ai:provider-health',
        'provider-1',
        expect.any(String),
      );
      expect(mockExpire).toHaveBeenCalledWith('ai:provider-health', 604800);
    });
  });

  describe('recordError()', () => {
    it('creates a new record if one does not exist', () => {
      const service = freshService();
      service.recordError('provider-2');
      expect(service.getHealth('provider-2')).not.toBeNull();
    });

    it('increments errorCount', async () => {
      const service = freshService();
      await service.recordError('provider-1');
      await service.recordError('provider-1');
      expect(service.getHealth('provider-1')!.errorCount).toBe(2);
    });

    it('increments consecutiveErrors', async () => {
      const service = freshService();
      await service.recordError('provider-1');
      expect(service.getHealth('provider-1')!.consecutiveErrors).toBe(1);

      await service.recordError('provider-1');
      expect(service.getHealth('provider-1')!.consecutiveErrors).toBe(2);
    });

    it('sets lastErrorAt to a recent timestamp', async () => {
      const service = freshService();
      const before = Date.now();
      await service.recordError('provider-1');
      const after = Date.now();
      const ts = service.getHealth('provider-1')!.lastErrorAt!;
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });

    it('does not reset successCount', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      await service.recordSuccess('provider-1');
      await service.recordError('provider-1');
      expect(service.getHealth('provider-1')!.successCount).toBe(2);
    });

    it('syncs to Redis', async () => {
      const service = freshService();
      await service.recordError('provider-1');
      expect(mockHset).toHaveBeenCalledWith(
        'ai:provider-health',
        'provider-1',
        expect.any(String),
      );
    });
  });

  describe('isUnhealthy()', () => {
    it('returns false if no record exists', () => {
      const service = freshService();
      expect(service.isUnhealthy('nonexistent')).toBe(false);
    });

    it('returns true when successCount is 0 and errorCount > 0', async () => {
      const service = freshService();
      await service.recordError('provider-1');
      expect(service.isUnhealthy('provider-1')).toBe(true);
    });

    it('returns false after 1 consecutive error following a success (below default 5)', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      await service.recordError('provider-1');
      expect(service.isUnhealthy('provider-1')).toBe(false);
    });

    it('returns true after exactly 5 consecutive errors', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      for (let i = 0; i < 5; i++) {
        await service.recordError('provider-1');
      }
      expect(service.isUnhealthy('provider-1')).toBe(true);
    });

    it('returns false after 4 consecutive errors (below default 5)', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      for (let i = 0; i < 4; i++) {
        await service.recordError('provider-1');
      }
      expect(service.isUnhealthy('provider-1')).toBe(false);
    });

    it('respects a custom threshold', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      await service.recordError('provider-1');
      await service.recordError('provider-1');
      expect(service.isUnhealthy('provider-1', 3)).toBe(false);

      await service.recordError('provider-1');
      expect(service.isUnhealthy('provider-1', 3)).toBe(true);
    });

    it('becomes healthy again after a success', async () => {
      const service = freshService(2);
      await service.recordError('provider-1');
      await service.recordError('provider-1');
      expect(service.isUnhealthy('provider-1', 2)).toBe(true);

      await service.recordSuccess('provider-1');
      expect(service.isUnhealthy('provider-1', 2)).toBe(false);
    });
  });

  describe('getHealth()', () => {
    it('returns null for unknown provider', () => {
      const service = freshService();
      expect(service.getHealth('unknown')).toBeNull();
    });

    it('returns the correct record shape', async () => {
      const service = freshService();
      await service.recordSuccess('provider-1');
      await service.recordError('provider-1');

      const health = service.getHealth('provider-1')!;
      expect(health).toHaveProperty('lastSuccessAt');
      expect(health).toHaveProperty('lastErrorAt');
      expect(health).toHaveProperty('successCount');
      expect(health).toHaveProperty('errorCount');
      expect(health).toHaveProperty('consecutiveErrors');
      expect(health.successCount).toBe(1);
      expect(health.errorCount).toBe(1);
      expect(health.consecutiveErrors).toBe(1);
    });

    it('tracks multiple providers independently', async () => {
      const service = freshService();
      await service.recordSuccess('p-a');
      await service.recordError('p-b');

      expect(service.getHealth('p-a')!.successCount).toBe(1);
      expect(service.getHealth('p-a')!.errorCount).toBe(0);
      expect(service.getHealth('p-b')!.successCount).toBe(0);
      expect(service.getHealth('p-b')!.errorCount).toBe(1);
    });
  });

  describe('getAllHealth()', () => {
    it('returns an empty object when no providers tracked', () => {
      const service = freshService();
      expect(service.getAllHealth()).toEqual({});
    });

    it('returns all tracked providers', async () => {
      const service = freshService();
      await service.recordSuccess('p-a');
      await service.recordError('p-b');

      const all = service.getAllHealth();
      expect(Object.keys(all)).toHaveLength(2);
      expect(all['p-a'].successCount).toBe(1);
      expect(all['p-b'].errorCount).toBe(1);
    });

    it('returns a shallow copy', async () => {
      const service = freshService();
      await service.recordSuccess('p-a');

      const all = service.getAllHealth();
      all['p-a'].successCount = 999;

      expect(service.getHealth('p-a')!.successCount).toBe(1);
    });
  });

  describe('graceful degradation when Redis is unavailable', () => {
    it('does not throw when syncToRedis fails', async () => {
      mockHset.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const service = freshService();
      await expect(service.recordSuccess('provider-1')).resolves.toBeUndefined();
      expect(service.getHealth('provider-1')!.successCount).toBe(1);
    });

    it('still records in-memory when Redis sync fails', async () => {
      mockHset.mockRejectedValueOnce(new Error('Connection lost'));
      const service = freshService();
      await service.recordError('provider-1');
      await service.recordError('provider-1');

      expect(service.getHealth('provider-1')!.errorCount).toBe(2);
      expect(service.getHealth('provider-1')!.consecutiveErrors).toBe(2);
    });

    it('still resolves isUnhealthy correctly without Redis', async () => {
      mockHset.mockRejectedValueOnce(new Error('no redis'));
      const service = freshService(2);
      await service.recordError('p-1');
      await service.recordError('p-1');

      expect(service.isUnhealthy('p-1', 2)).toBe(true);
    });
  });

  describe('hydrateFromRedis()', () => {
    it('populates in-memory records from Redis on startup', async () => {
      const now = Date.now();
      mockHgetall.mockResolvedValue({
        'provider-x': JSON.stringify({
          lastSuccessAt: now - 1000,
          lastErrorAt: null,
          successCount: 3,
          errorCount: 0,
          consecutiveErrors: 0,
        }),
      });

      const service = freshService();
      await service.hydrateFromRedis();

      expect(service.getHealth('provider-x')!.successCount).toBe(3);
    });

    it('prunes stale records with no recent activity', async () => {
      const ancientTime = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const recentTime = Date.now() - 1000;
      mockHgetall.mockResolvedValue({
        'stale-provider': JSON.stringify({
          lastSuccessAt: ancientTime,
          lastErrorAt: ancientTime,
          successCount: 100,
          errorCount: 0,
          consecutiveErrors: 0,
        }),
        'active-provider': JSON.stringify({
          lastSuccessAt: recentTime,
          lastErrorAt: null,
          successCount: 5,
          errorCount: 0,
          consecutiveErrors: 0,
        }),
      });

      const service = freshService();
      await service.hydrateFromRedis();

      expect(service.getHealth('stale-provider')).toBeNull();
      expect(service.getHealth('active-provider')).not.toBeNull();
      expect(service.getHealth('active-provider')!.successCount).toBe(5);
    });

    it('skips corrupt JSON entries', async () => {
      mockHgetall.mockResolvedValue({ 'bad-provider': '{ not valid json }' });
      const service = freshService();
      await expect(service.hydrateFromRedis()).resolves.toBeUndefined();
      expect(service.getHealth('bad-provider')).toBeNull();
    });

    it('does not throw when Redis is unavailable', async () => {
      mockHgetall.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const service = freshService();
      await expect(service.hydrateFromRedis()).resolves.toBeUndefined();
    });
  });
});
