import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';

// ioRedis is touched by _bustDefaultsCatalogCache on the success path — stub it so no
// real connection is attempted.
vi.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    keys: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(0),
  },
}));

import { MediaProviderController } from './media-provider.controller';

const org = { id: 'org-1' } as any;

function makeController(overrides: {
  configs?: any[];
  getFolder?: any;
} = {}) {
  const orgMedia = { upsert: vi.fn().mockResolvedValue({}) };
  const storageService = {
    getProviderConfigs: vi
      .fn()
      .mockResolvedValue(overrides.configs ?? [{ id: 'store-1', organizationId: 'org-1' }]),
  };
  const fileService = {
    getFolder:
      overrides.getFolder ?? vi.fn().mockResolvedValue({ id: 'folder-1', organizationId: 'org-1' }),
  };
  const orgMediaProviderSettings = {
    setStorage: vi.fn(async (orgId: string, identifier: string, data: any) => {
      const configs = await storageService.getProviderConfigs(orgId);
      if (!configs.some((c: any) => c.id === data.storageProviderId)) {
        throw new BadRequestException(
          'storageProviderId does not belong to this organization',
        );
      }
      if (data.storageRootFolderId) {
        try {
          await fileService.getFolder(orgId, data.storageRootFolderId);
        } catch (err) {
          if (!(err instanceof HttpException) || err.getStatus() !== 404) throw err;
          throw new BadRequestException(
            'storageRootFolderId does not belong to this organization',
          );
        }
      }
      await orgMedia.upsert(orgId, identifier, data);
      return { identifier, success: true };
    }),
  };
  const controller = new MediaProviderController(orgMediaProviderSettings as any);
  return { controller, orgMedia, storageService, fileService, orgMediaProviderSettings };
}

// PROVIDER_REMEDIATION 3.6: validate storageProviderId + storageRootFolderId belong to
// the caller's org at WRITE time (not deferred to job completion after a paid render).
describe('MediaProviderController.setStorage ownership (3.6)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists when both ids belong to the org', async () => {
    const { controller, orgMedia } = makeController({
      configs: [{ id: 'store-1', organizationId: 'org-1' }],
    });

    const result = await controller.setStorage(org, 'openai', {
      storageProviderId: 'store-1',
      storageRootFolderId: 'folder-1',
    });

    expect(result).toEqual({ identifier: 'openai', success: true });
    expect(orgMedia.upsert).toHaveBeenCalledWith('org-1', 'openai', {
      storageProviderId: 'store-1',
      storageRootFolderId: 'folder-1',
    });
  });

  it('rejects a storageProviderId owned by another org', async () => {
    const { controller, orgMedia } = makeController({
      configs: [{ id: 'store-1', organizationId: 'org-1' }],
    });

    await expect(
      controller.setStorage(org, 'openai', { storageProviderId: 'store-OTHER' }),
    ).rejects.toThrow(BadRequestException);
    expect(orgMedia.upsert).not.toHaveBeenCalled();
  });

  it('rejects a storageRootFolderId owned by another org', async () => {
    const { controller, orgMedia } = makeController({
      configs: [{ id: 'store-1', organizationId: 'org-1' }],
      // getFolder throws HttpException(404) for a cross-org/missing folder — the
      // real FileService.getFolder shape. 3.4 now rethrows any NON-404 error, so
      // the mock must be the genuine 404 to still map to the ownership 400.
      getFolder: vi
        .fn()
        .mockRejectedValue(new HttpException('Folder not found', 404)),
    });

    await expect(
      controller.setStorage(org, 'openai', {
        storageProviderId: 'store-1',
        storageRootFolderId: 'folder-OTHER',
      }),
    ).rejects.toThrow(BadRequestException);
    expect(orgMedia.upsert).not.toHaveBeenCalled();
  });

  // 3.4: an infra failure (DB outage, transient Prisma error) must PROPAGATE —
  // not be swallowed into a 400 "does not belong to this organization" that
  // blames the user's input for a server-side blip.
  it('rethrows a non-404 getFolder failure instead of mapping it to the ownership 400', async () => {
    const infraError = new Error('db connection lost');
    const { controller, orgMedia } = makeController({
      configs: [{ id: 'store-1', organizationId: 'org-1' }],
      getFolder: vi.fn().mockRejectedValue(infraError),
    });

    await expect(
      controller.setStorage(org, 'openai', {
        storageProviderId: 'store-1',
        storageRootFolderId: 'folder-1',
      }),
    ).rejects.toBe(infraError);
    expect(orgMedia.upsert).not.toHaveBeenCalled();
  });

  it('accepts the synthetic __virtual_local__ provider id', async () => {
    const { controller, orgMedia } = makeController({
      configs: [{ id: '__virtual_local__', organizationId: 'org-1' }],
    });

    await controller.setStorage(org, 'openai', { storageProviderId: '__virtual_local__' });
    expect(orgMedia.upsert).toHaveBeenCalled();
  });
});
