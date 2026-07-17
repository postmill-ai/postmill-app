import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSafeFetch = vi.fn();
vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
  safeFetch: (url: string, init?: RequestInit) => mockSafeFetch(url, init),
}));

import { ReplicateCatalogService } from './replicate-catalog.service';
import { ReplicateCostService } from './replicate-cost';

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe('ReplicateCatalogService', () => {
  let service: ReplicateCatalogService;
  let mockOrgMediaProviderSettings: any;
  let mockRedis: any;
  let mockEncryption: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockReset();

    mockOrgMediaProviderSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue({
        credentials: { apiKey: 'plain-test-key' },
      }),
    };

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    mockEncryption = {
      decrypt: vi.fn().mockReturnValue('decrypted-key'),
    };

    service = new ReplicateCatalogService(
      mockOrgMediaProviderSettings,
      mockRedis,
      mockEncryption,
      new ReplicateCostService(),
    );
  });

  describe('listModels', () => {
    it('returns mapped summaries with warm/pricing/real price', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          owner: 'black-forest-labs',
          name: 'flux-schnell',
          description: 'Fast image model',
          cover_image_url: 'https://cdn/cover.png',
          run_count: 1234,
          latest_version: { id: 'v1' },
        }),
      );

      const result = await service.listModels('text-to-image', 'org1');

      expect(result).toHaveLength(6);
      const first = result[0];
      expect(first).toMatchObject({
        id: 'black-forest-labs/flux-schnell',
        name: 'flux-schnell',
        description: 'Fast image model',
        coverImageUrl: 'https://cdn/cover.png',
        runCount: 1234,
        warm: true,
        pricing: 'output',
        price: { kind: 'per-image', usd: 0.003 },
      });
    });

    it('skips API fetch on per-model cache hit', async () => {
      const allowlist = [
        'black-forest-labs/flux-schnell',
        'black-forest-labs/flux-dev',
        'black-forest-labs/flux-1.1-pro',
        'google/imagen-4',
        'ideogram-ai/ideogram-v3-turbo',
        'stability-ai/stable-diffusion-3.5-large',
      ];
      mockRedis.get.mockImplementation(async (key: string) => {
        const modelId = key.replace('replicate:model:', '');
        if (allowlist.includes(modelId)) {
          return JSON.stringify({
            id: modelId,
            name: 'cached',
            description: '',
            coverImageUrl: null,
            runCount: 0,
            warm: true,
            pricing: 'output',
            price: { kind: 'per-image', usd: 0.003 },
          });
        }
        return null;
      });

      const result = await service.listModels('text-to-image', 'org1');

      // The 6 curated models came from the per-model cache — none were fetched.
      // (The category collection is fetched separately, best-effort, for extras.)
      const modelFetches = mockSafeFetch.mock.calls.filter((c: any[]) =>
        String(c[0]).includes('/models/')
      );
      expect(modelFetches).toHaveLength(0);
      expect(result).toHaveLength(6);
      expect(result[0]).toMatchObject({ name: 'cached' });
    });

    it('does not poison cache when fetch fails', async () => {
      mockSafeFetch.mockRejectedValue(new Error('network error'));

      const result = await service.listModels('text-to-image', 'org1');

      expect(result).toHaveLength(0);
      // Should not write category cache when any model failed
      expect(mockRedis.set).not.toHaveBeenCalledWith(
        'replicate:category:text-to-image',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('caches the category index on full success', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          owner: 'black-forest-labs',
          name: 'flux-schnell',
          description: '',
          cover_image_url: null,
          run_count: 0,
          latest_version: { id: 'v1' },
        }),
      );

      await service.listModels('text-to-image', 'org1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'replicate:category:text-to-image',
        expect.any(String),
        86400,
      );
    });

    it('returns an empty array for local categories', async () => {
      const result = await service.listModels('meme', 'org1');
      expect(result).toEqual([]);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });
  });
});
