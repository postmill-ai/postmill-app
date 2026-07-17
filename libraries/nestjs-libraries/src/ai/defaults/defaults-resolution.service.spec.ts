import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DefaultsResolutionService } from './defaults-resolution.service';
import { AI_MODEL_CATEGORIES } from './default-categories';

const makeKernel = (overrides: {
  get?: ReturnType<typeof vi.fn>;
  latestActive?: ReturnType<typeof vi.fn>;
  getMetadata?: ReturnType<typeof vi.fn>;
} = {}) => ({
  get: overrides.get ?? vi.fn().mockReturnValue({ manifest: { status: 'active' } }),
  latestActive: overrides.latestActive ?? vi.fn().mockReturnValue(undefined),
  getMetadata:
    overrides.getMetadata ??
    vi.fn().mockImplementation((_domain: string, providerId: string) => ({
      id: providerId,
      displayName: providerId,
      kind: 'hub',
      domains: ['ai'],
      modelCategories: AI_MODEL_CATEGORIES,
      hasModelList: true,
    })),
});

const makeRepository = (overrides: {
  get?: ReturnType<typeof vi.fn>;
  getAll?: ReturnType<typeof vi.fn>;
  upsert?: ReturnType<typeof vi.fn>;
} = {}) => ({
  get: overrides.get ?? vi.fn().mockResolvedValue(null),
  getAll: overrides.getAll ?? vi.fn().mockResolvedValue([]),
  upsert: overrides.upsert ?? vi.fn().mockResolvedValue(undefined),
  remove: vi.fn(),
});

const makeAiSettings = (providers: any[] = []) => ({
  getProviders: vi.fn().mockResolvedValue(providers),
  getActiveProvider: vi.fn(),
  getByIdentifier: vi.fn().mockResolvedValue(null),
});

const makeMediaSettings = (providers: any[] = []) => ({
  getProviders: vi.fn().mockResolvedValue(providers),
  getConfigForProvider: vi.fn().mockResolvedValue(null),
});

const makeRuntimeContextFactory = () => ({
  build: vi.fn().mockReturnValue({}),
});

describe('DefaultsResolutionService', () => {
  let service: DefaultsResolutionService;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a stored row when its provider is still a candidate', async () => {
    const repository = makeRepository({
      get: vi.fn().mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
        settings: null,
      }),
    });
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      makeKernel() as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result?.source).toBe('stored');
    expect(result?.providerId).toBe('openai');
    expect(result?.model).toBe('gpt-4.1');
  });

  it('honors the stored version when it is still active', async () => {
    const repository = makeRepository({
      get: vi.fn().mockResolvedValue({
        providerId: 'openai',
        version: 'v1', // stored provenance
        model: 'gpt-4.1',
        settings: null,
      }),
    });
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v2' },
    ]);
    const kernel = makeKernel({
      get: vi.fn().mockReturnValue({
        manifest: { status: 'active' },
        create: () => ({
          listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }, { id: 'gpt-5' }]),
        }),
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result?.source).toBe('stored');
    expect(result?.providerId).toBe('openai');
    expect(result?.version).toBe('v1');
    expect(result?.model).toBe('gpt-4.1');
  });

  it('auto-upgrades a stored default when its pinned version is retired', async () => {
    const repository = makeRepository({
      get: vi.fn().mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'gpt-4.1',
        settings: null,
      }),
    });
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v2' },
    ]);
    const kernel = makeKernel({
      get: vi.fn().mockImplementation((_domain: string, _providerId: string, version: string) => {
        if (version === 'v1') {
          return { manifest: { status: 'retired' } };
        }
        return {
          manifest: { status: 'active' },
          create: () => ({
            listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]),
          }),
        };
      }),
      latestActive: vi.fn().mockReturnValue({ manifest: { version: 'v2', status: 'active' } }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result?.source).toBe('auto');
    expect(result?.providerId).toBe('openai');
    expect(result?.version).toBe('v2');
    expect(result?.model).toBe('gpt-4.1');
  });

  it('falls through to auto when the stored model no longer exists in the current version catalog', async () => {
    const repository = makeRepository({
      get: vi.fn().mockResolvedValue({
        providerId: 'openai',
        version: 'v1',
        model: 'retired-model',
        settings: null,
      }),
    });
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v2' },
    ]);
    const kernel = makeKernel({
      get: vi.fn().mockReturnValue({
        create: () => ({
          listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]),
        }),
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result?.source).toBe('auto');
    expect(result?.providerId).toBe('openai');
    expect(result?.version).toBe('v2');
    expect(result?.model).toBe('gpt-4.1');
  });

  it('falls through to auto-pick when the stored provider is no longer a candidate', async () => {
    const repository = makeRepository({
      get: vi.fn().mockResolvedValue({
        providerId: 'disabled-provider',
        version: 'v1',
        model: 'old-model',
        settings: null,
      }),
    });
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    const kernel = makeKernel({
      get: vi.fn().mockReturnValue({
        create: () => ({
          listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]),
        }),
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result?.source).toBe('auto');
    expect(result?.providerId).toBe('openai');
    expect(result?.model).toBe('gpt-4.1');
  });

  it('orders media candidates as primary media first, then other media, then AI', async () => {
    const repository = makeRepository();
    const mediaSettings = makeMediaSettings([
      {
        identifier: 'primary-media',
        enabled: true,
        isConfigured: true,
        isActive: true,
        version: 'v1',
      },
      {
        identifier: 'other-media',
        enabled: true,
        isConfigured: true,
        isActive: false,
        version: 'v1',
      },
    ]);
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    const kernel = makeKernel({
      getMetadata: vi.fn().mockImplementation((_domain: string, providerId: string) => {
        const base = {
          id: providerId,
          displayName: providerId,
          kind: 'hub',
          hasModelList: true,
        };
        if (providerId === 'primary-media' || providerId === 'other-media') {
          return { ...base, domains: ['media'], mediaCategories: ['text-to-image'] };
        }
        return { ...base, domains: ['ai', 'media'], mediaCategories: ['text-to-image'] };
      }),
      get: vi.fn().mockReturnValue({
        create: () => ({
          listModels: vi.fn().mockResolvedValue([{ id: 'model-1' }]),
        }),
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      mediaSettings as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const candidates = await service.candidates('media', 'text-to-image', 'org-1');

    expect(candidates.map((c) => c.providerId)).toEqual([
      'primary-media',
      'other-media',
      'openai',
    ]);
  });

  it('returns undefined model for action-only providers', async () => {
    const repository = makeRepository();
    const aiSettings = makeAiSettings([
      { identifier: 'heygen', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    const kernel = makeKernel({
      getMetadata: vi.fn().mockReturnValue({
        id: 'heygen',
        displayName: 'HeyGen',
        kind: 'action',
        domains: ['media'],
        mediaCategories: ['video-avatar'],
        hasModelList: false,
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('media', 'video-avatar', 'org-1');

    expect(result?.source).toBe('auto');
    expect(result?.providerId).toBe('heygen');
    expect(result?.model).toBeUndefined();
  });

  it('auto-picks a concrete model from static mediaModels for direct providers', async () => {
    const repository = makeRepository();
    const aiSettings = makeAiSettings([
      { identifier: 'replicate', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    const kernel = makeKernel({
      getMetadata: vi.fn().mockReturnValue({
        id: 'replicate',
        displayName: 'Replicate',
        kind: 'direct',
        domains: ['media'],
        mediaCategories: ['text-to-image'],
        hasModelList: false,
        mediaModels: {
          'text-to-image': [
            { id: 'black-forest-labs/flux-schnell', label: 'FLUX Schnell', fields: [] },
          ],
        },
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('media', 'text-to-image', 'org-1');

    expect(result?.source).toBe('auto');
    expect(result?.providerId).toBe('replicate');
    expect(result?.model).toBe('black-forest-labs/flux-schnell');
  });

  it('returns null when no candidates are available', async () => {
    const repository = makeRepository();
    const aiSettings = makeAiSettings([]);
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings([]) as any,
      makeKernel() as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result).toBeNull();
  });

  it('resolve never writes to the repository', async () => {
    const repository = makeRepository();
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    const kernel = makeKernel({
      get: vi.fn().mockReturnValue({
        create: () => ({
          listModels: vi.fn().mockResolvedValue([{ id: 'gpt-4.1' }]),
        }),
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(repository.upsert).not.toHaveBeenCalled();
  });

  describe('_categoryToOperation', () => {
    const subject = () =>
      new DefaultsResolutionService(
        makeRepository() as any,
        makeAiSettings() as any,
        makeMediaSettings() as any,
        makeKernel() as any,
      );

    it.each([
      ['text-to-image', 'image'],
      ['image-upscale', 'image'],
      ['image-focal-point', 'image'],
      ['text-to-video', 'video'],
      ['image-to-video', 'video'],
      ['video-to-video', 'video'],
      ['video-avatar', 'video'],
      ['video-background', 'video'],
      ['video-upscale', 'video'],
      ['text-to-speech', 'audio'],
      ['text-to-music', 'audio'],
      ['video-caption', 'audio'],
      ['unknown-category', 'image'],
    ])('%s → %s', (category, operation) => {
      expect((subject() as any)._categoryToOperation(category)).toBe(operation);
    });
  });

  it('passes the plain creds map (not the runtime context) to an AI provider listModels (1.5)', async () => {
    const repository = makeRepository();
    const aiSettings = makeAiSettings([
      { identifier: 'qwen', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    // org has a stored key → _credentialsForCandidate returns it for the AI candidate.
    aiSettings.getByIdentifier.mockResolvedValue({ credentials: { apiKey: 'dashscope-key' } });
    const listModels = vi.fn().mockResolvedValue([{ id: 'qwen-max' }]);
    const kernel = makeKernel({
      get: vi.fn().mockReturnValue({ create: () => ({ listModels }) }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    await service.resolve('ai', 'low-reasoning', 'org-1');

    // AI contract is listModels(creds: Record<string,string>) — the org's key must
    // arrive verbatim, NOT the runtime context object.
    expect(listModels).toHaveBeenCalledWith({ apiKey: 'dashscope-key' });
  });

  it('ranks auto-pick by provider-local modelHints', async () => {
    const repository = makeRepository();
    const aiSettings = makeAiSettings([
      { identifier: 'openai', enabled: true, isConfigured: true, version: 'v1' },
    ]);
    const kernel = makeKernel({
      get: vi.fn().mockReturnValue({
        create: () => ({
          listModels: vi.fn().mockResolvedValue([
            { id: 'gpt-3.5-turbo' },
            { id: 'gpt-4.1' },
            { id: 'gpt-4.1-mini' },
          ]),
        }),
      }),
      getMetadata: vi.fn().mockReturnValue({
        id: 'openai',
        displayName: 'OpenAI',
        kind: 'hub',
        domains: ['ai'],
        modelCategories: AI_MODEL_CATEGORIES,
        hasModelList: true,
        modelHints: {
          'low-reasoning': ['gpt-4.1-mini', 'gpt-4.1'],
        },
      }),
    });
    service = new DefaultsResolutionService(
      repository as any,
      aiSettings as any,
      makeMediaSettings() as any,
      kernel as any,
      makeRuntimeContextFactory() as any,
    );

    const result = await service.resolve('ai', 'low-reasoning', 'org-1');

    expect(result?.source).toBe('auto');
    expect(result?.model).toBe('gpt-4.1-mini');
  });
});
