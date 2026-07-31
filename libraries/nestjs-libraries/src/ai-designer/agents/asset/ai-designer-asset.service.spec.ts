import { describe, it, expect, vi } from 'vitest';
import { AiDesignerAssetService } from './ai-designer-asset.service';

const ORG_ID = 'org-1';

const makeService = () => {
  const aiDefaults = {
    textToImage: vi.fn().mockResolvedValue('https://example.com/img.png'),
  };
  const fileService = {
    importFromUrl: vi.fn().mockResolvedValue({ id: 'file-1', path: '/file-1.png' }),
    saveGeneratedMedia: vi.fn().mockResolvedValue({ id: 'file-1', path: '/file-1.png' }),
  };
  const storageService = {
    getLocalAdapterForOrg: vi.fn().mockResolvedValue({
      writeBuffer: vi.fn().mockResolvedValue('/fallback.png'),
    }),
  };
  const stockMedia = {
    searchPhotos: vi.fn().mockResolvedValue({ results: [] }),
  };

  return {
    service: new AiDesignerAssetService(
      aiDefaults as any,
      fileService as any,
      storageService as any,
      stockMedia as any
    ),
    aiDefaults,
    fileService,
    stockMedia,
  };
};

const makeContext = (overrides: { orgId?: string; rawInput?: string } = {}) => ({
  raw_input: overrides.rawInput ?? JSON.stringify({
    type: 'asset-request',
    assetNeeds: [
      { slotId: 's1', brief: 'a blue gradient', prefer: 'generate' as const },
    ],
  }),
  metadata: { orgId: overrides.orgId ?? ORG_ID },
} as any);

describe('AiDesignerAssetService', () => {
  it('reads orgId from context metadata', async () => {
    const { service, aiDefaults } = makeService();

    await (service as any)._handler(makeContext());

    expect(aiDefaults.textToImage).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(String),
      expect.any(Object)
    );
  });

  it('returns an error envelope when metadata orgId is missing', async () => {
    const { service, aiDefaults } = makeService();

    const response = await (service as any)._handler(makeContext({ orgId: '' }));

    const parsed = JSON.parse(response.content);
    expect(parsed.type).toBe('error');
    expect(parsed.message).toMatch(/missing orgId/i);
    expect(aiDefaults.textToImage).not.toHaveBeenCalled();
  });

  it('clamps assetNeeds to MAX_ASSET_NEEDS = 8', async () => {
    const { service, aiDefaults } = makeService();

    const needs = Array.from({ length: 12 }, (_, i) => ({
      slotId: `slot-${i}`,
      brief: `brief ${i}`,
      prefer: 'generate' as const,
    }));

    const response = await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({ type: 'asset-request', assetNeeds: needs }),
    }));

    const parsed = JSON.parse(response.content);
    expect(Object.keys(parsed.assets).length).toBe(8);
    expect(aiDefaults.textToImage).toHaveBeenCalledTimes(8);
  });
});

describe('AiDesignerAssetService per-aspect generation (Phase 3)', () => {
  it('generates one asset per aspect need, keyed slotId:aspect', async () => {
    const { service, aiDefaults } = makeService();

    const response = await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 's1', brief: 'a blue gradient', prefer: 'generate', aspect: 'square' },
          { slotId: 's1', brief: 'a blue gradient', prefer: 'generate', aspect: 'wide' },
        ],
      }),
    }));

    const parsed = JSON.parse(response.content);
    expect(Object.keys(parsed.assets).sort()).toEqual(['s1:square', 's1:wide']);
    expect(parsed.assets['s1:square'].aspect).toBe('square');
    expect(parsed.assets['s1:wide'].aspect).toBe('wide');
    expect(aiDefaults.textToImage).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(String),
      { aspect: 'square' }
    );
    expect(aiDefaults.textToImage).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(String),
      { aspect: 'wide' }
    );
  });

  it('passes the aspect orientation to the stock search on generate failure', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        {
          id: 'p1',
          url: 'https://example.com/stock.png',
          source: 'unsplash',
          attribution: undefined,
        },
      ],
    });

    const response = await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 's1', brief: 'mountain lake', prefer: 'either', aspect: 'wide' },
        ],
      }),
    }));

    expect(stockMedia.searchPhotos).toHaveBeenCalledWith(
      ORG_ID,
      'mountain lake',
      1,
      'landscape'
    );
    const parsed = JSON.parse(response.content);
    expect(parsed.assets['s1:wide'].source).toBe('stock');
  });

  it('appends a layout suffix for hero slots and leaves non-hero briefs untouched', async () => {
    const { service, aiDefaults } = makeService();

    await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          {
            slotId: 'hero',
            brief: 'coffee beans on wood',
            prefer: 'generate',
            aspect: 'wide',
            heroLayout: 'side-by-side',
          },
          {
            slotId: 'icon',
            brief: 'small coffee cup icon',
            prefer: 'generate',
            aspect: 'square',
          },
        ],
      }),
    }));

    const heroPrompt = aiDefaults.textToImage.mock.calls.find(
      (call) => call[2]?.aspect === 'wide'
    );
    expect(heroPrompt[1]).toContain('coffee beans on wood');
    expect(heroPrompt[1]).toContain('Wide 16:9 composition.');
    expect(heroPrompt[1]).toContain('Full-bleed photographic composition to every edge');
    expect(heroPrompt[1]).toContain('right half');

    const plainPrompt = aiDefaults.textToImage.mock.calls.find(
      (call) => call[2]?.aspect === 'square'
    );
    expect(plainPrompt[1]).toContain('small coffee cup icon');
    expect(plainPrompt[1]).not.toContain('composition');
  });

  it('appends the no-baked-in-text instruction to every generated prompt', async () => {
    const { service, aiDefaults } = makeService();

    await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 's1', brief: 'a blue gradient', prefer: 'generate' },
          {
            slotId: 'hero',
            brief: 'coffee beans on wood',
            prefer: 'generate',
            aspect: 'wide',
            heroLayout: 'side-by-side',
          },
        ],
      }),
    }));

    for (const call of aiDefaults.textToImage.mock.calls) {
      expect(call[1]).toContain(
        'No text, no words, no letters, no typography, no watermark, no logo.'
      );
    }
  });

  it('never appends the no-text instruction to stock searches', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({ results: [] });

    await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 's1', brief: 'mountain lake', prefer: 'either', aspect: 'wide' },
        ],
      }),
    }));

    expect(stockMedia.searchPhotos).toHaveBeenCalledWith(
      ORG_ID,
      'mountain lake',
      1,
      'landscape'
    );
  });
});

describe('AiDesignerAssetService regeneration (regenerateAsset fix)', () => {
  it('regenerateForSlot delegates to the resolve path with the strengthened negative prompt', async () => {
    const { service, aiDefaults } = makeService();

    const result = await service.regenerateForSlot(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'generate',
      aspect: 'square',
    });

    expect(result).toMatchObject({
      slotId: 'v1:hero',
      fileId: 'file-1',
      source: 'generate',
    });
    const prompt = aiDefaults.textToImage.mock.calls[0][1] as string;
    expect(prompt).toContain('coffee beans on wood');
    expect(prompt).toContain(
      'No text, no words, no letters, no typography, no watermark, no logo.'
    );
    expect(prompt).toContain(
      'Plain unbranded packaging or surfaces — absolutely no printed text, labels, or logos on any object.'
    );
  });

  it('routes a regenerate-flagged request through the harder prompt; normal requests stay untouched', async () => {
    const { service, aiDefaults } = makeService();

    await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 'v1:hero', brief: 'coffee beans', prefer: 'generate', aspect: 'square' },
        ],
        regenerate: true,
      }),
    }));
    await (service as any)._handler(makeContext());

    expect(aiDefaults.textToImage.mock.calls[0][1]).toContain(
      'Plain unbranded packaging'
    );
    expect(aiDefaults.textToImage.mock.calls[1][1]).not.toContain(
      'Plain unbranded packaging'
    );
  });
});

describe('AiDesignerAssetService degradation hardening (workstream 5)', () => {
  it('retries image generation once before falling back to stock', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        {
          id: 'p1',
          url: 'https://example.com/stock.png',
          source: 'unsplash',
          attribution: undefined,
        },
      ],
    });

    const response = await (service as any)._handler(makeContext());

    // 1 initial attempt + 1 retry, then stock.
    expect(aiDefaults.textToImage).toHaveBeenCalledTimes(2);
    expect(stockMedia.searchPhotos).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(response.content);
    expect(parsed.assets.s1.source).toBe('stock');
  });

  it('does not retry when the first generation succeeds', async () => {
    const { service, aiDefaults, stockMedia } = makeService();

    const response = await (service as any)._handler(makeContext());

    expect(aiDefaults.textToImage).toHaveBeenCalledTimes(1);
    expect(stockMedia.searchPhotos).not.toHaveBeenCalled();
    const parsed = JSON.parse(response.content);
    expect(parsed.assets.s1.source).toBe('generate');
  });

  it('returns null and logs an error when even the gradient fallback fails', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({ results: [] });
    (service as any)._storageService = {
      getLocalAdapterForOrg: vi
        .fn()
        .mockRejectedValue(new Error('storage exploded')),
    };
    const errorSpy = vi
      .spyOn((service as any)._logger, 'error')
      .mockImplementation(() => undefined);

    const response = await (service as any)._handler(makeContext());

    const parsed = JSON.parse(response.content);
    expect(parsed.assets).toEqual({});
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Gradient fallback failed for slot s1'),
      expect.anything(),
      expect.any(String)
    );
    expect(errorSpy.mock.calls[0][0]).toContain('storage exploded');
  });
});

