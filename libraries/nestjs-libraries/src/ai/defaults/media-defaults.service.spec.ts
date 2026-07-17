import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MediaDefaultsService } from './media-defaults.service';
import { DefaultsResolutionService } from './defaults-resolution.service';
import { OrgDefaultModelRepository } from '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository';
import { DefaultsSettingsValidator } from './defaults-settings.validator';
import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';

const mockRedisGet = vi.fn();
const mockRedisSet = vi.fn();
const mockRedisKeys = vi.fn();
const mockRedisDel = vi.fn();

vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: (...args: any[]) => mockRedisGet(...args),
    set: (...args: any[]) => mockRedisSet(...args),
    keys: (...args: any[]) => mockRedisKeys(...args),
    del: (...args: any[]) => mockRedisDel(...args),
  },
}));

const mockDefaultsResolveAll = vi.fn();
const mockDefaultsCandidates = vi.fn();

vi.mock(
  './defaults-resolution.service',
  () => ({
    DefaultsResolutionService: class {
      resolveAll = mockDefaultsResolveAll;
      candidates = mockDefaultsCandidates;
    },
  }),
);

const mockRepositoryGetAll = vi.fn();
const mockRepositoryUpsert = vi.fn();
const mockRepositoryRemove = vi.fn();

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/ai-settings/org-default-model.repository',
  () => ({
    OrgDefaultModelRepository: class {
      getAll = mockRepositoryGetAll;
      upsert = mockRepositoryUpsert;
      remove = mockRepositoryRemove;
    },
  }),
);

const mockOrgMediaGetConfigForProvider = vi.fn().mockResolvedValue({ credentials: {} });

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service',
  () => ({
    OrgMediaProviderSettingsService: class {
      getConfigForProvider = mockOrgMediaGetConfigForProvider;
    },
  }),
);

const mockKernelGet = vi.fn();
const mockKernelListManifests = vi.fn();

vi.mock('@gitroom/nestjs-libraries/providers/providers.module', () => ({
  PROVIDER_KERNEL: 'PROVIDER_KERNEL',
}));

function makeService() {
  return new MediaDefaultsService(
    new (DefaultsResolutionService as any)(),
    new (OrgDefaultModelRepository as any)(),
    { validate: (_domain: any, _category: any, settings: any) => settings } as any,
    {
      get: mockKernelGet,
      listManifests: mockKernelListManifests,
    } as any,
    new (OrgMediaProviderSettingsService as any)(),
  );
}

const orgId = 'org-1';

describe('MediaDefaultsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisKeys.mockResolvedValue([]);
    mockRedisDel.mockResolvedValue(0);
  });

  it('getMediaDefaults returns resolved and stored categories', async () => {
    mockDefaultsResolveAll.mockResolvedValue({
      'text-to-image': { providerId: 'openai', version: 'v1', model: 'dall-e-3' },
    });
    mockRepositoryGetAll.mockResolvedValue([
      { category: 'text-to-image', providerId: 'openai', version: 'v1', model: 'dall-e-3' },
    ]);

    const service = makeService();
    const result = await service.getMediaDefaults(orgId);

    expect(result.categories).toHaveLength(16);
    const imageRow = result.categories.find((c: any) => c.category === 'text-to-image');
    expect(imageRow).toMatchObject({
      category: 'text-to-image',
      providerId: 'openai',
      version: 'v1',
      model: 'dall-e-3',
      source: 'stored',
    });
  });

  it('setMediaDefault persists a default and busts catalog cache', async () => {
    mockRepositoryUpsert.mockResolvedValue(undefined);
    const service = makeService();

    const result = await service.setMediaDefault(orgId, 'text-to-image', {
      providerId: 'openai',
      version: 'v1',
      model: 'dall-e-3',
    } as any);

    expect(result).toEqual({ category: 'text-to-image', success: true });
    expect(mockRepositoryUpsert).toHaveBeenCalledWith(
      'org-1',
      'media',
      'text-to-image',
      expect.objectContaining({ providerId: 'openai', version: 'v1', model: 'dall-e-3' }),
    );
    expect(mockRedisKeys).toHaveBeenCalledWith(
      'settings:content:media-defaults:catalog:org-1:*',
    );
  });

  it('setMediaDefault strips prompt and validates settings', async () => {
    const validateSpy = vi.fn((_d, _c, s) => s);
    const service = new MediaDefaultsService(
      new (DefaultsResolutionService as any)(),
      new (OrgDefaultModelRepository as any)(),
      { validate: validateSpy } as any,
      { get: mockKernelGet, listManifests: mockKernelListManifests } as any,
      new (OrgMediaProviderSettingsService as any)(),
    );

    await service.setMediaDefault(orgId, 'text-to-image', {
      providerId: 'openai',
      version: 'v1',
      settings: { prompt: 'ignore', resolution: '1024x1024' },
    } as any);

    expect(validateSpy).toHaveBeenCalledWith(
      'media',
      'text-to-image',
      {
        prompt: 'ignore',
        resolution: '1024x1024',
      },
      { providerId: 'openai', model: undefined, version: 'v1' },
    );
  });

  it('clearMediaDefault removes a default', async () => {
    mockRepositoryRemove.mockResolvedValue(undefined);
    const service = makeService();

    const result = await service.clearMediaDefault(orgId, 'text-to-image');

    expect(result).toEqual({ category: 'text-to-image', success: true });
    expect(mockRepositoryRemove).toHaveBeenCalledWith('org-1', 'media', 'text-to-image');
  });

  it('getMediaDefaultsCatalog returns candidates and models with label format', async () => {
    mockDefaultsCandidates.mockResolvedValue([
      {
        providerId: 'heygen',
        version: 'v1',
        metadata: { hasModelList: false, kind: 'action', uiName: undefined },
      },
      {
        providerId: 'openai',
        version: 'v1',
        metadata: { hasModelList: true, kind: 'model', uiName: undefined },
      },
    ]);

    mockKernelGet.mockReturnValue({
      create: () => ({
        listModels: vi.fn().mockResolvedValue([
          { id: 'dall-e-3', label: 'DALL·E 3' },
          { id: 'gpt-image-1', label: 'GPT Image' },
        ]),
      }),
    });

    const service = makeService();
    const result = await service.getMediaDefaultsCatalog(orgId, 'text-to-image');

    expect(result.category).toBe('text-to-image');
    expect(result.options).toContainEqual({
      providerId: 'heygen',
      version: 'v1',
      label: 'heygen',
    });
    expect(result.options).toContainEqual({
      providerId: 'openai',
      version: 'v1',
      model: 'dall-e-3',
      label: 'openai: DALL·E 3',
      fields: [],
    });
    expect(result.options).toContainEqual({
      providerId: 'openai',
      version: 'v1',
      model: 'gpt-image-1',
      label: 'openai: GPT Image',
      fields: [],
    });
    expect(mockRedisSet).toHaveBeenCalledWith(
      'settings:content:media-defaults:catalog:org-1:text-to-image',
      expect.any(String),
      'EX',
      60,
    );
  });

  it('rejects an invalid category with 400', async () => {
    const service = makeService();
    await expect(
      service.setMediaDefault(orgId, 'not-a-category', {
        providerId: 'openai',
      } as any),
    ).rejects.toMatchObject({ status: 400 });
  });
});
