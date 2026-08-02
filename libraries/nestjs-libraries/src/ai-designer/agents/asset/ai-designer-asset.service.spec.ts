import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';
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
      // Image models reach for real branded products (live: sneakers with
      // clear Nike swooshes) — a trademark problem, not just a visual one.
      expect(call[1]).toContain(
        'No recognizable brand logos, trademarks, or real-world branded products — generic unbranded designs only.'
      );
    }
  });

  it('strips brand-asking words from a stock search but never adds the generation suffix', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({ results: [] });

    await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          {
            slotId: 's1',
            brief: 'branded mountain lake logo, trademark watermark',
            prefer: 'either',
            aspect: 'wide',
          },
        ],
      }),
    }));

    // A search API has no negative-prompt lever, so the only defence is not
    // asking for a mark — but the generation-only suffix still never leaks in.
    const query = stockMedia.searchPhotos.mock.calls[0][1] as string;
    expect(query).toBe('mountain lake');
    expect(query).not.toMatch(/brand|logo|trademark|watermark/i);
    expect(query).not.toContain('No text, no words');
    expect(stockMedia.searchPhotos).toHaveBeenCalledWith(
      ORG_ID,
      'mountain lake',
      1,
      'landscape'
    );
  });

  it('keeps an all-brand-token brief intact rather than searching for nothing', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({ results: [] });

    await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 's1', brief: 'logo branding', prefer: 'either', aspect: 'wide' },
        ],
      }),
    }));

    expect(stockMedia.searchPhotos.mock.calls[0][1]).toBe('logo branding');
  });

  it('captures the provider item id on a stock asset', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        {
          id: 'unsplash-abc',
          url: 'https://example.com/stock.png',
          source: 'unsplash',
        },
      ],
    });

    const response = await (service as any)._handler(makeContext({
      rawInput: JSON.stringify({
        type: 'asset-request',
        assetNeeds: [
          { slotId: 's1', brief: 'mountain lake', prefer: 'stock', aspect: 'wide' },
        ],
      }),
    }));

    const parsed = JSON.parse(response.content);
    expect(parsed.assets['s1:wide']).toMatchObject({
      source: 'stock',
      stockId: 'unsplash-abc',
    });
  });

  it('records heroLayout only on GENERATED assets (stock never obeyed the prompt)', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    stockMedia.searchPhotos.mockResolvedValue({
      results: [{ id: 'p1', url: 'https://example.com/stock.png', source: 'unsplash' }],
    });

    const generated = await service.regenerateForSlot(ORG_ID, {
      slotId: 'gen',
      brief: 'coffee bag',
      prefer: 'generate',
      aspect: 'wide',
      heroLayout: 'split-panel',
    });
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    const stocked = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'stk',
      brief: 'coffee bag',
      prefer: 'either',
      aspect: 'wide',
      heroLayout: 'split-panel',
    });

    expect(generated!.heroLayout).toBe('split-panel');
    expect(stocked!.source).toBe('stock');
    expect(stocked!.heroLayout).toBeUndefined();
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
    // The regeneration negative is harder still: the first attempt already
    // carried the standard suffix and the model branded the product anyway.
    expect(prompt).toContain(
      'No brand marks, emblems, monograms, logo-shaped details or real celebrity likenesses of any kind'
    );
  });

  it('promotes a prefer:"stock" need to "either" so the regeneration can reach the generator', async () => {
    const { service, aiDefaults, stockMedia } = makeService();

    const result = await service.regenerateForSlot(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'stock',
      aspect: 'square',
    });

    // Unpromoted, a stock-only need skipped the generate block entirely and
    // just re-ran the same deterministic (and cached) search.
    expect(aiDefaults.textToImage).toHaveBeenCalledTimes(1);
    expect(aiDefaults.textToImage.mock.calls[0][1]).toContain(
      'Plain unbranded packaging'
    );
    expect(stockMedia.searchPhotos).not.toHaveBeenCalled();
    expect(result!.source).toBe('generate');
  });

  it('honors stockOnly on a regeneration instead of promoting it', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        { id: 'p1', url: 'https://example.com/one.png', source: 'unsplash' },
        { id: 'p2', url: 'https://example.com/two.png', source: 'unsplash' },
      ],
    });

    const result = await service.regenerateForSlot(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'generic unbranded. sneaker on concrete',
      prefer: 'stock',
      stockOnly: true,
      aspect: 'square',
    });

    // The conductor switched technique on purpose (brand_safety): the image
    // model already failed on that defect, so promoting back to a generate is
    // exactly the re-roll the switch exists to avoid.
    expect(aiDefaults.textToImage).not.toHaveBeenCalled();
    expect(stockMedia.searchPhotos).toHaveBeenCalledTimes(1);
    expect(result!.source).toBe('stock');
  });

  it('leaves a prefer:"stock" need alone on a NORMAL (non-regenerate) resolve', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    stockMedia.searchPhotos.mockResolvedValue({
      results: [{ id: 'p1', url: 'https://example.com/stock.png', source: 'unsplash' }],
    });

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'stock',
      aspect: 'square',
    });

    expect(aiDefaults.textToImage).not.toHaveBeenCalled();
    expect(result.source).toBe('stock');
  });

  it('excludes the previous pick from a regenerated stock search', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        { id: 'p1', url: 'https://example.com/one.png', source: 'unsplash' },
        { id: 'p2', url: 'https://example.com/two.png', source: 'unsplash' },
      ],
    });

    const result = await service.regenerateForSlot(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'either',
      aspect: 'square',
      excludeStockId: 'p1',
    });

    expect(result).toMatchObject({ source: 'stock', stockId: 'p2' });
  });

  it('drops the first hit when a regeneration recorded no previous pick', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        { id: 'p1', url: 'https://example.com/one.png', source: 'unsplash' },
        { id: 'p2', url: 'https://example.com/two.png', source: 'unsplash' },
      ],
    });

    const result = await service.regenerateForSlot(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'either',
      aspect: 'square',
    });

    // The first hit IS the repeat — the search is deterministic and cached.
    expect(result).toMatchObject({ source: 'stock', stockId: 'p2' });
  });

  it('degrades honestly when the exclusion leaves no stock candidates', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [{ id: 'p1', url: 'https://example.com/one.png', source: 'unsplash' }],
    });

    const result = await service.regenerateForSlot(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'either',
      aspect: 'square',
      excludeStockId: 'p1',
    });

    // Gradient last resort, never the rejected photo handed straight back.
    expect(result!.source).toBe('gradient');
  });

  it('keeps the FIRST hit on a normal (non-regenerate) search', async () => {
    const { service, aiDefaults, stockMedia } = makeService();
    aiDefaults.textToImage.mockRejectedValue(new Error('provider down'));
    stockMedia.searchPhotos.mockResolvedValue({
      results: [
        { id: 'p1', url: 'https://example.com/one.png', source: 'unsplash' },
        { id: 'p2', url: 'https://example.com/two.png', source: 'unsplash' },
      ],
    });

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'v1:hero',
      brief: 'coffee beans on wood',
      prefer: 'either',
      aspect: 'square',
    });

    expect(result.stockId).toBe('p1');
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


describe('AiDesignerAssetService intrinsic size analysis (round 7 workstream D)', () => {
  const KEY = '2026/07/30/hero.png';
  let tmpDir: string;

  // Flat mid-grey field with one high-contrast blob in the RIGHT third —
  // exactly the "coffee bag on the right half" shape the split/sidebar
  // generation prompt asks for.
  const rightSubjectScene = async () => {
    const blob = await sharp({
      create: { width: 300, height: 300, channels: 3, background: '#ff0000' },
    })
      .png()
      .toBuffer();
    return sharp({
      create: { width: 1600, height: 900, channels: 3, background: '#808080' },
    }).composite([{ input: blob, left: 1050, top: 300 }]);
  };

  const rightSubjectPng = async () => (await rightSubjectScene()).png().toBuffer();

  // The SAME scene in the container every generated asset actually uses.
  const rightSubjectWebp = async () =>
    (await rightSubjectScene()).webp({ lossless: true }).toBuffer();

  const makeLocalService = (uploadPath = KEY) => {
    const aiDefaults = {
      textToImage: vi.fn().mockResolvedValue('https://example.com/img.png'),
    };
    const file = {
      id: 'file-1',
      path: `http://localhost:4200/uploads/${uploadPath}`,
    };
    const fileService = {
      importFromUrl: vi.fn().mockResolvedValue(file),
      saveGeneratedMedia: vi.fn().mockResolvedValue(file),
    };
    const storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        writeBuffer: vi.fn().mockResolvedValue('/fallback.png'),
      }),
    };
    const stockMedia = { searchPhotos: vi.fn().mockResolvedValue({ results: [] }) };
    return {
      service: new AiDesignerAssetService(
        aiDefaults as any,
        fileService as any,
        storageService as any,
        stockMedia as any
      ),
      aiDefaults,
    };
  };

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `asset-analysis-test-${Date.now()}`);
    mkdirSync(path.join(tmpDir, '2026', '07', '30'), { recursive: true });
    vi.stubEnv('FRONTEND_URL', 'http://localhost:4200');
    vi.stubEnv('UPLOAD_DIRECTORY', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  });

  // Round 7 workstream D: the sharp-`attention` probe that used to fill
  // `subjectPoint` here is gone — it was a saliency heuristic that measured
  // drop shadows (live: 0.0625 and 0.281 against true centroids of 0.398 and
  // 0.520). Asset resolution now reads the intrinsic SIZE only; the crop
  // defaults to centre and the composer escalates to the real VLM detector
  // for risky crops.
  it('reports the intrinsic dimensions of a generated asset and NO subjectPoint', async () => {
    writeFileSync(path.join(tmpDir, KEY), await rightSubjectPng());
    const { service } = makeLocalService();

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a coffee bag',
      prefer: 'generate',
      aspect: 'wide',
      heroLayout: 'split-panel',
    });

    expect(result.naturalWidth).toBe(1600);
    expect(result.naturalHeight).toBe(900);
    expect(result.subjectPoint).toBeUndefined();
  });

  it('reads a WebP asset the same way (every generated asset lands as .webp)', async () => {
    const webpKey = '2026/07/30/hero.webp';
    writeFileSync(path.join(tmpDir, webpKey), await rightSubjectWebp());
    const { service } = makeLocalService(webpKey);

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a coffee bag',
      prefer: 'generate',
      aspect: 'wide',
      heroLayout: 'split-panel',
    });

    expect(result.naturalWidth).toBe(1600);
    expect(result.naturalHeight).toBe(900);
    expect(result.subjectPoint).toBeUndefined();
  });

  it('is fail-soft: an unreadable file leaves the analysis fields undefined and still resolves the asset', async () => {
    // Nothing written to disk — readFile rejects.
    const { service } = makeLocalService();
    const warnSpy = vi
      .spyOn((service as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a coffee bag',
      prefer: 'generate',
      aspect: 'wide',
    });

    expect(result).toMatchObject({ fileId: 'file-1', source: 'generate' });
    expect(result.subjectPoint).toBeUndefined();
    expect(result.naturalWidth).toBeUndefined();
    expect(result.naturalHeight).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Asset size analysis skipped')
    );
  });

  it('never throws when sharp itself blows up on a corrupt file', async () => {
    writeFileSync(path.join(tmpDir, KEY), Buffer.from('not an image at all'));
    const { service } = makeLocalService();
    vi.spyOn((service as any)._logger, 'warn').mockImplementation(() => undefined);

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a coffee bag',
      prefer: 'generate',
      aspect: 'wide',
    });

    expect(result.fileId).toBe('file-1');
    expect(result.subjectPoint).toBeUndefined();
  });

  it('refuses to read outside UPLOAD_DIRECTORY (traversal guard)', async () => {
    const { service } = makeLocalService('../../../etc/passwd');
    const warnSpy = vi
      .spyOn((service as any)._logger, 'warn')
      .mockImplementation(() => undefined);

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a coffee bag',
      prefer: 'generate',
      aspect: 'wide',
    });

    expect(result.subjectPoint).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Blocked upload path traversal')
    );
  });

  it('skips the analysis entirely for a non-local (remote) asset path', async () => {
    const { service } = makeLocalService();
    (service as any)._fileService.importFromUrl.mockResolvedValue({
      id: 'file-1',
      path: 'https://cdn.example.com/hero.png',
    });

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a coffee bag',
      prefer: 'generate',
      aspect: 'wide',
    });

    expect(result.fileId).toBe('file-1');
    expect(result.naturalWidth).toBeUndefined();
  });
});

// Round 7 C4: the gradient last resort always wrote 512x512, so a portrait or
// ultra-wide run got a SQUARE placeholder — and its wrong intrinsic size then
// fed the composer's focal-point maths.
describe('AiDesignerAssetService gradient fallback aspect (round 7 C4)', () => {
  const gradientFor = async (aspect?: 'square' | 'wide' | 'tall') => {
    const written: Buffer[] = [];
    const aiDefaults = {
      textToImage: vi.fn().mockRejectedValue(new Error('provider down')),
    };
    const fileService = {
      importFromUrl: vi.fn(),
      saveGeneratedMedia: vi
        .fn()
        .mockResolvedValue({ id: 'file-1', path: '/fallback.png' }),
    };
    const storageService = {
      getLocalAdapterForOrg: vi.fn().mockResolvedValue({
        writeBuffer: vi.fn(async (buffer: Buffer) => {
          written.push(buffer);
          return '/fallback.png';
        }),
      }),
    };
    const stockMedia = { searchPhotos: vi.fn().mockResolvedValue({ results: [] }) };
    const service = new AiDesignerAssetService(
      aiDefaults as any,
      fileService as any,
      storageService as any,
      stockMedia as any
    );

    const result = await (service as any)._resolveAsset(ORG_ID, {
      slotId: 'hero',
      brief: 'a blue gradient',
      prefer: 'either',
      ...(aspect ? { aspect } : {}),
    });
    expect(result.source).toBe('gradient');
    return sharp(written[0]).metadata();
  };

  it('writes a square placeholder for a square need', async () => {
    const meta = await gradientFor('square');
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });

  it('writes a 16:9 placeholder for a wide need', async () => {
    const meta = await gradientFor('wide');
    expect(meta.width! / meta.height!).toBeCloseTo(16 / 9, 5);
    expect(meta.width).toBeGreaterThan(meta.height!);
  });

  it('writes a 9:16 placeholder for a tall need', async () => {
    const meta = await gradientFor('tall');
    expect(meta.height! / meta.width!).toBeCloseTo(16 / 9, 5);
    expect(meta.height).toBeGreaterThan(meta.width!);
  });

  it('falls back to square when the need names no aspect', async () => {
    const meta = await gradientFor();
    expect(meta.width).toBe(512);
    expect(meta.height).toBe(512);
  });
});

// Round 7 C3: `referenceFileIds` used to be handed to this agent and was never
// read — a dead feature. No image provider in use accepts an init/reference
// image on the text-to-image path, so references stay an interpreted-cue
// feature and the payload no longer pretends otherwise.
describe('AiDesignerAssetService reference images are not an asset input (round 7 C3)', () => {
  it('ignores referenceFileIds entirely and never forwards them to generation', async () => {
    const { service, aiDefaults } = makeService();

    await (service as any)._handler(
      makeContext({
        rawInput: JSON.stringify({
          type: 'asset-request',
          assetNeeds: [{ slotId: 's1', brief: 'a blue gradient', prefer: 'generate' }],
          referenceFileIds: ['file-ref-1', 'file-ref-2'],
        }),
      })
    );

    expect(aiDefaults.textToImage).toHaveBeenCalledTimes(1);
    const [, prompt, opts] = aiDefaults.textToImage.mock.calls[0];
    expect(prompt).not.toContain('file-ref-1');
    expect(JSON.stringify(opts)).not.toContain('file-ref');
  });
});
