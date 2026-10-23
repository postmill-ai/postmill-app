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
  let mockKernel: any;

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

    mockKernel = { listMetadata: vi.fn().mockReturnValue([]) };

    service = new ReplicateCatalogService(
      mockOrgMediaProviderSettings,
      mockRedis,
      new ReplicateCostService(),
      mockKernel,
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
        expect.stringMatching(/^replicate:category:v3:[0-9a-f]{8}:text-to-image$/),
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
        expect.stringMatching(/^replicate:category:v3:[0-9a-f]{8}:text-to-image$/),
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
        'google/veo-3.1',
        'minimax/video-01',
        'bytedance/seedance-1-pro',
        'kwaivgi/kling-v2.5-turbo-pro',
      ]);
      // Per-model fetches only — no /collections/ call.
      expect(
        mockSafeFetch.mock.calls.filter((c: any[]) =>
          String(c[0]).includes('/collections/'),
        ),
      ).toHaveLength(0);
    });

    it('attaches curated capability notes from the provider metadata (never cached)', async () => {
      mockKernel.listMetadata.mockReturnValue([
        {
          id: 'replicate',
          mediaModels: {
            'text-to-video': [
              { id: 'minimax/video-01', label: 'video-01', notes: ['No audio track'] },
            ],
          },
        },
      ]);
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

      expect(result.find((m) => m.id === 'minimax/video-01')?.notes).toEqual([
        'No audio track',
      ]);
      // Models without curated notes carry none.
      expect(result.find((m) => m.id === 'google/veo-3.1')?.notes).toBeUndefined();
      // Notes ride on the response only — the cached payload stays notes-free
      // so a metadata edit ships without waiting out the 24h cache.
      const cachedWrite = mockRedis.set.mock.calls.find((c: any[]) =>
        String(c[0]).startsWith('replicate:category:'),
      );
      expect(cachedWrite).toBeDefined();
      expect(JSON.parse(cachedWrite![1]).every((m: any) => m.notes === undefined)).toBe(
        true,
      );
    });

    it('attaches notes on a category cache hit too', async () => {
      mockKernel.listMetadata.mockReturnValue([
        {
          id: 'replicate',
          mediaModels: {
            'text-to-video': [
              { id: 'minimax/video-01', label: 'video-01', notes: ['No audio track'] },
            ],
          },
        },
      ]);
      mockRedis.get.mockImplementation(async (key: string) =>
        key.startsWith('replicate:category:')
          ? JSON.stringify([{ id: 'minimax/video-01', name: 'video-01' }])
          : null,
      );

      const result = await service.listModels('text-to-video', 'org1');

      expect(mockSafeFetch).not.toHaveBeenCalled();
      expect(result[0].notes).toEqual(['No audio track']);
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

  describe('getModel schema ref inlining', () => {
    const modelResponse = (input: unknown, extraSchemas: Record<string, unknown> = {}) =>
      jsonResponse({
        owner: 'kwaivgi',
        name: 'kling-v2.1',
        cover_image_url: null,
        latest_version: {
          id: 'v1',
          openapi_schema: {
            components: {
              schemas: {
                Input: input,
                ...extraSchemas,
              },
            },
          },
        },
      });

    it('inlines enum/type/min/max/title AND default/description from a $ref component', async () => {
      // Regression: default/description lived on the $ref'd component for many
      // schemas (aspect_ratio, mode, …) and were dropped here, so form default
      // seeding (defaultsFromSchema) saw nothing and forms arrived empty.
      mockSafeFetch.mockResolvedValue(
        modelResponse(
          {
            type: 'object',
            properties: {
              prompt: { type: 'string', 'x-order': 0 },
              aspect_ratio: {
                allOf: [{ $ref: '#/components/schemas/AspectRatio' }],
                'x-order': 1,
              },
            },
          },
          {
            AspectRatio: {
              type: 'string',
              enum: ['16:9', '9:16', '1:1'],
              default: '16:9',
              title: 'Aspect ratio',
              description: 'Aspect ratio of the generated video',
            },
          },
        ),
      );

      const model = await service.getModel('kwaivgi', 'kling-v2.1', 'org1');
      const props = (model.inputSchema as any).properties;

      expect(props.aspect_ratio).toMatchObject({
        type: 'string',
        enum: ['16:9', '9:16', '1:1'],
        default: '16:9',
        title: 'Aspect ratio',
        description: 'Aspect ratio of the generated video',
      });
      // The resolved ref wrapper is dropped so the field renders directly.
      expect(props.aspect_ratio.allOf).toBeUndefined();
      expect(props.prompt).toEqual({ type: 'string', 'x-order': 0 });
    });

    it("the property's own default/description win over the component's", async () => {
      mockSafeFetch.mockResolvedValue(
        modelResponse(
          {
            type: 'object',
            properties: {
              mode: {
                allOf: [{ $ref: '#/components/schemas/Mode' }],
                default: 'std',
                description: 'Standard is fine here',
              },
            },
          },
          {
            Mode: {
              type: 'string',
              enum: ['std', 'pro'],
              default: 'pro',
              description: 'Component-level description',
            },
          },
        ),
      );

      const model = await service.getModel('kwaivgi', 'kling-v2.1', 'org1');
      const props = (model.inputSchema as any).properties;

      expect(props.mode).toMatchObject({
        enum: ['std', 'pro'],
        default: 'std',
        description: 'Standard is fine here',
      });
    });
  });
});
