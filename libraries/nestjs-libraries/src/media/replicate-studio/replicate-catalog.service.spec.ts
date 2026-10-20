import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const mockSafeFetch = vi.fn();
vi.mock('@postmill-ai/nestjs-libraries/dtos/webhooks/safe.fetch', () => ({
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

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafeFetch.mockReset();

    mockOrgMediaProviderSettings = {
      getConfigForProvider: vi.fn().mockResolvedValue({
        // Mirrors the real OrgMediaProviderSettingsService contract:
        // credentials arrive already decrypted (plaintext fields).
        credentials: { apiKey: 'r8_test-key' },
      }),
    };

    mockRedis = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    };

    service = new ReplicateCatalogService(
      mockOrgMediaProviderSettings,
      mockRedis,
      new ReplicateCostService(),
    );
  });

  describe('listModels', () => {
    it('returns mapped summaries with warm/pricing/real price', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          owner: 'black-forest-labs',
          name: 'flux-dev',
          description: 'Fast image model',
          cover_image_url: 'https://cdn/cover.png',
          run_count: 1234,
          latest_version: { id: 'v1' },
        }),
      );

      const result = await service.listModels('text-to-image', 'org1');

      expect(result).toHaveLength(5);
      const first = result[0];
      expect(first).toMatchObject({
        id: 'black-forest-labs/flux-dev',
        name: 'flux-dev',
        description: 'Fast image model',
        coverImageUrl: 'https://cdn/cover.png',
        runCount: 1234,
        warm: true,
        pricing: 'output',
        price: { kind: 'per-image', usd: 0.025 },
      });
    });

    it('skips API fetch on per-model cache hit', async () => {
      const allowlist = [
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

      // The 5 curated models came from the per-model cache — none were fetched.
      // Only the curated allowlist is listed — no collection fetch happens.
      const modelFetches = mockSafeFetch.mock.calls.filter((c: any[]) =>
        String(c[0]).includes('/models/')
      );
      expect(modelFetches).toHaveLength(0);
      expect(result).toHaveLength(5);
      expect(result[0]).toMatchObject({ name: 'cached' });
    });

    it('does not poison cache when fetch fails', async () => {
      mockSafeFetch.mockRejectedValue(new Error('network error'));

      const result = await service.listModels('text-to-image', 'org1');

      expect(result).toHaveLength(0);
      // Should not write category cache when any model failed
      expect(mockRedis.set).not.toHaveBeenCalledWith(
        'replicate:category:v2:text-to-image',
        expect.any(String),
        expect.any(Number),
      );
    });

    it('caches the category index on full success', async () => {
      mockSafeFetch.mockResolvedValue(
        jsonResponse({
          owner: 'black-forest-labs',
          name: 'flux-dev',
          description: '',
          cover_image_url: null,
          run_count: 0,
          latest_version: { id: 'v1' },
        }),
      );

      await service.listModels('text-to-image', 'org1');

      expect(mockRedis.set).toHaveBeenCalledWith(
        'replicate:category:v2:text-to-image',
        expect.any(String),
        86400,
      );
    });

    it('returns an empty array for local categories', async () => {
      const result = await service.listModels('meme', 'org1');
      expect(result).toEqual([]);
      expect(mockSafeFetch).not.toHaveBeenCalled();
    });

    it('lists only allowlisted models — no collection extras the runner would reject', async () => {
      // Regression: the picker used to merge in Replicate's live collection,
      // but the runner refuses anything off the allowlist — ~26 of ~30 listed
      // text-to-video models always failed with "Bad Request" at run time.
      mockSafeFetch.mockImplementation(async (url: string) =>
        jsonResponse({
          owner: 'x',
          name: String(url).split('/').pop(),
          description: '',
          cover_image_url: null,
          run_count: 0,
          latest_version: { id: 'v1' },
        }),
      );

      const result = await service.listModels('text-to-video', 'org1');

      expect(result.map((m) => m.id)).toEqual([
        'google/veo-3',
        'minimax/video-01',
        'bytedance/seedance-1-pro',
        'kwaivgi/kling-v2.1',
      ]);
      // Per-model fetches only — no /collections/ call.
      expect(
        mockSafeFetch.mock.calls.filter((c: any[]) =>
          String(c[0]).includes('/collections/'),
        ),
      ).toHaveLength(0);
    });
  });

  describe('getReplicateKey', () => {
    it('returns the key as-is — getConfigForProvider already decrypted it', async () => {
      await expect(service.getReplicateKey('org1')).resolves.toBe('r8_test-key');
    });

    it('throws NotFound when the provider row is missing', async () => {
      mockOrgMediaProviderSettings.getConfigForProvider.mockResolvedValueOnce(null);
      await expect(service.getReplicateKey('org1')).rejects.toThrow(NotFoundException);
    });

    it('throws NotFound when no key field is present', async () => {
      mockOrgMediaProviderSettings.getConfigForProvider.mockResolvedValueOnce({ credentials: {} });
      await expect(service.getReplicateKey('org1')).rejects.toThrow(NotFoundException);
    });
  });
});
