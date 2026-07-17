import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
const mockGet = vi.fn(async (key: string) => store.get(key) ?? null);
const mockSet = vi.fn(async (key: string, value: string, _ex?: string, _ttl?: number) => {
  store.set(key, value);
  return 'OK';
});

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: (key: string) => mockGet(key),
    set: (key: string, value: string, ex?: string, ttl?: number) => mockSet(key, value, ex, ttl),
  },
}));

import { SemanticCacheService } from './semantic-cache.service';

function createService(settings: any) {
  const manager = { getSettings: vi.fn().mockResolvedValue(settings) } as any;
  return { service: new SemanticCacheService(manager), manager };
}

describe('SemanticCacheService', () => {
  beforeEach(() => {
    store.clear();
    mockGet.mockClear();
    mockSet.mockClear();
  });

  describe('disabled by default', () => {
    it('get() returns null when cacheSettings is absent', async () => {
      const { service } = createService(null);
      const result = await service.get('org-1', 'utility', 'hello');
      expect(result).toBeNull();
      expect(mockGet).not.toHaveBeenCalled();
    });

    it('get() returns null when explicitly disabled', async () => {
      const { service } = createService({ cacheSettings: { enabled: false } });
      expect(await service.get('org-1', 'utility', 'hello')).toBeNull();
    });

    it('set() is a no-op when disabled', async () => {
      const { service } = createService({ cacheSettings: { enabled: false } });
      await service.set('org-1', 'utility', 'hello', 'world');
      expect(mockSet).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    });
  });

  describe('prompt-hash tier (enabled)', () => {
    const settings = { cacheSettings: { enabled: true, ttlSeconds: 120 } };

    it('returns the cached value on an exact-match hit', async () => {
      const { service } = createService(settings);
      await service.set('org-1', 'utility', 'Hello world', 'cached-response');
      const result = await service.get('org-1', 'utility', 'Hello world');
      expect(result).toBe('cached-response');
    });

    it('normalizes whitespace and case before hashing', async () => {
      const { service } = createService(settings);
      await service.set('org-1', 'utility', 'Hello   World', 'resp');
      const result = await service.get('org-1', 'utility', 'hello world');
      expect(result).toBe('resp');
    });

    it('passes a TTL to Redis set', async () => {
      const { service } = createService(settings);
      await service.set('org-1', 'utility', 'p', 'v');
      expect(mockSet).toHaveBeenCalledWith(expect.any(String), 'v', 'EX', 120);
    });

    it('does not store empty values', async () => {
      const { service } = createService(settings);
      await service.set('org-1', 'utility', 'p', '');
      expect(mockSet).not.toHaveBeenCalled();
    });

    it('returns null on a miss', async () => {
      const { service } = createService(settings);
      expect(await service.get('org-1', 'utility', 'never-stored')).toBeNull();
    });
  });

  describe('cross-org isolation', () => {
    const settings = { cacheSettings: { enabled: true } };

    it('never returns another org\'s cached value for the same prompt+scope', async () => {
      const { service } = createService(settings);
      await service.set('org-A', 'utility', 'same prompt', 'A-secret');
      expect(await service.get('org-B', 'utility', 'same prompt')).toBeNull();
      expect(await service.get('org-A', 'utility', 'same prompt')).toBe('A-secret');
    });

    it('builds distinct keys per org', () => {
      const { service } = createService(settings);
      const kA = service.buildKey('org-A', 'utility', 'p');
      const kB = service.buildKey('org-B', 'utility', 'p');
      expect(kA).not.toBe(kB);
      expect(kA).toContain('org-A');
      expect(kB).toContain('org-B');
    });

    it('builds distinct keys per scope', () => {
      const { service } = createService(settings);
      expect(service.buildKey('org-A', 'utility', 'p')).not.toBe(
        service.buildKey('org-A', 'agent', 'p'),
      );
    });
  });

  describe('embedding-similarity tier', () => {
    const settings = {
      cacheSettings: { enabled: true, semantic: true, similarityThreshold: 0.9 },
    };

    it('degrades to prompt-hash-only when no model provider is wired', async () => {
      const { service } = createService(settings);
      // No setModelProvider() call ⇒ embedding tier unavailable.
      await service.set('org-1', 'utility', 'original prompt', 'resp');
      // Exact hit still works.
      expect(await service.get('org-1', 'utility', 'original prompt')).toBe('resp');
      // A different-but-similar prompt yields a miss (no semantic match possible).
      expect(await service.get('org-1', 'utility', 'a near identical prompt')).toBeNull();
    });

    it('degrades gracefully when the embedding model throws', async () => {
      const { service } = createService(settings);
      service.setModelProvider({
        embeddingModel: vi.fn().mockRejectedValue(new Error('no embeddings')),
      } as any);
      await service.set('org-1', 'utility', 'foo', 'resp');
      expect(await service.get('org-1', 'utility', 'foo')).toBe('resp'); // exact still works
      expect(await service.get('org-1', 'utility', 'something else')).toBeNull();
    });

    it('returns a semantic hit when a near-identical prompt embeds similarly', async () => {
      const { service } = createService(settings);
      const doEmbed = vi
        .fn()
        // store call (original prompt)
        .mockResolvedValueOnce({ embeddings: [[1, 0, 0]] })
        // lookup call (similar prompt) — same vector ⇒ cosine 1.0
        .mockResolvedValueOnce({ embeddings: [[1, 0, 0]] });
      service.setModelProvider({
        embeddingModel: vi.fn().mockResolvedValue({ doEmbed }),
      } as any);

      await service.set('org-1', 'utility', 'how do I reset my password', 'use the reset link');
      const hit = await service.get('org-1', 'utility', 'a totally different wording string');
      expect(hit).toBe('use the reset link');
    });

    it('returns a miss when similarity is below threshold', async () => {
      const { service } = createService(settings);
      const doEmbed = vi
        .fn()
        .mockResolvedValueOnce({ embeddings: [[1, 0, 0]] })
        .mockResolvedValueOnce({ embeddings: [[0, 1, 0]] }); // orthogonal ⇒ cosine 0
      service.setModelProvider({
        embeddingModel: vi.fn().mockResolvedValue({ doEmbed }),
      } as any);

      await service.set('org-1', 'utility', 'prompt one', 'resp');
      const hit = await service.get('org-1', 'utility', 'unrelated longer prompt text');
      expect(hit).toBeNull();
    });

    it('degrades when doEmbed rejects during lookup (after a stored entry exists)', async () => {
      const { service } = createService(settings);
      const doEmbed = vi
        .fn()
        .mockResolvedValueOnce({ embeddings: [[1, 0, 0]] }) // store ok
        .mockRejectedValueOnce(new Error('embed failed')); // lookup fails
      service.setModelProvider({
        embeddingModel: vi.fn().mockResolvedValue({ doEmbed }),
      } as any);
      await service.set('org-1', 'utility', 'stored prompt', 'resp');
      const hit = await service.get('org-1', 'utility', 'a different surface text');
      expect(hit).toBeNull();
    });

    it('tolerates a corrupt embedding index in Redis', async () => {
      const { service } = createService(settings);
      const doEmbed = vi.fn().mockResolvedValue({ embeddings: [[1, 0, 0]] });
      service.setModelProvider({
        embeddingModel: vi.fn().mockResolvedValue({ doEmbed }),
      } as any);
      // Pre-seed a corrupt embed index for this org/scope.
      const embedKey = (service as any)._embedKey('org-1', 'utility');
      store.set(embedKey, 'not-json{');
      // store should overwrite the corrupt index without throwing.
      await service.set('org-1', 'utility', 'p', 'v');
      const hit = await service.get('org-1', 'utility', 'q surface text long');
      // exact miss for q, semantic against the freshly written index (cosine 1.0) ⇒ hit
      expect(hit).toBe('v');
    });

    it('keeps the embedding index per (org, scope) — no cross-org semantic leak', async () => {
      const { service } = createService(settings);
      const doEmbed = vi.fn().mockResolvedValue({ embeddings: [[1, 0, 0]] });
      service.setModelProvider({
        embeddingModel: vi.fn().mockResolvedValue({ doEmbed }),
      } as any);

      await service.set('org-A', 'utility', 'shared', 'A-resp');
      // org-B with an identical embedding vector must NOT read org-A's index.
      const hit = await service.get('org-B', 'utility', 'different surface text here');
      expect(hit).toBeNull();
    });
  });

  describe('resilience', () => {
    it('returns null when Redis get throws', async () => {
      mockGet.mockRejectedValueOnce(new Error('redis down'));
      const { service } = createService({ cacheSettings: { enabled: true } });
      expect(await service.get('org-1', 'utility', 'p')).toBeNull();
    });

    it('swallows Redis set errors', async () => {
      mockSet.mockRejectedValueOnce(new Error('redis down'));
      const { service } = createService({ cacheSettings: { enabled: true } });
      await expect(service.set('org-1', 'utility', 'p', 'v')).resolves.toBeUndefined();
    });
  });

  describe('settings caching', () => {
    it('caches settings reads within the TTL', async () => {
      const { service, manager } = createService({ cacheSettings: { enabled: true } });
      await service.get('org-1', 'utility', 'p1');
      await service.get('org-1', 'utility', 'p2');
      expect(manager.getSettings).toHaveBeenCalledTimes(1);
    });
  });
});
