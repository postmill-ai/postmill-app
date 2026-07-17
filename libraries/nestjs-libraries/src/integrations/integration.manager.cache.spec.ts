import { describe, it, expect, vi, beforeEach } from 'vitest';

const redis = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    set: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
    del: vi.fn(async (k: string) => {
      store.delete(k);
      return 1;
    }),
  };
});
vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: redis,
}));

import { IntegrationManager } from './integration.manager';

describe('IntegrationManager — getIntegrationListResponse cache', () => {
  let manager: IntegrationManager;

  const makeProvider = (identifier: string, overrides: Record<string, any> = {}) => ({
    identifier,
    name: identifier,
    editor: 'normal',
    stripLinks: undefined,
    customFields: undefined,
    changeProfilePicture: undefined,
    changeNickname: undefined,
    ...overrides,
  });

  const fakeKernel = {
    listManifests: vi.fn().mockReturnValue([]),
  } as any;

  const fakeResolutionService = () =>
    ({
      resolveProvider: vi.fn().mockReturnValue({
        capability: {
          rawProvider: makeProvider('x'),
        },
        module: { manifest: { status: 'active' } },
      }),
    } as any);

  beforeEach(() => {
    redis.store.clear();
    vi.clearAllMocks();

    manager = new IntegrationManager(
      {} as any,
      {} as any,
      fakeKernel,
      fakeResolutionService(),
      {
        getIntegrationsList: vi.fn().mockResolvedValue([
          {
            id: 'int-1',
            name: 'X Account',
            internalId: 'x-1',
            providerIdentifier: 'x',
            disabled: false,
            picture: null,
            profile: 'profile',
            type: 'social',
            postingTimes: '[]',
            inBetweenSteps: false,
            refreshNeeded: false,
            customer: null,
            additionalSettings: null,
          },
        ]),
      } as any,
      {} as any
    );
  });

  it('computes on first call and caches the result for 60s', async () => {
    const res = await manager.getIntegrationListResponse('org-1');

    expect(res).toEqual({ integrations: [expect.objectContaining({ id: 'int-1' })] });
    expect(redis.set).toHaveBeenCalledWith(
      'integrations:list:org-1',
      expect.any(String),
      'EX',
      60
    );
  });

  it('serves a cached result without recomputing', async () => {
    redis.store.set('integrations:list:org-1', JSON.stringify({ integrations: [] }));

    const res = await manager.getIntegrationListResponse('org-1');

    expect(res).toEqual({ integrations: [] });
    expect(redis.get).toHaveBeenCalledWith('integrations:list:org-1');
  });

  it('invalidates the cached key', async () => {
    await manager.getIntegrationListResponse('org-1');
    expect(redis.store.has('integrations:list:org-1')).toBe(true);

    await manager.invalidateIntegrationListCache('org-1');

    expect(redis.del).toHaveBeenCalledWith('integrations:list:org-1');
    expect(redis.store.has('integrations:list:org-1')).toBe(false);
  });
});
