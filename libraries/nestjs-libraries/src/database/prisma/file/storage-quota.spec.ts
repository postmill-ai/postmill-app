import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpException } from '@nestjs/common';
import { FileRepository } from './file.repository';
import { StorageService } from '../storage/storage.service';
import { StorageProviderType } from '@prisma/client';

describe('Storage quota — aggregate, BYO waiver, add-on GB', () => {
  beforeEach(() => {
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    vi.clearAllMocks();
  });

  function buildFileRepository(aggregateResult: { _sum: { fileSize: number | null } }) {
    const fileModel = {
      aggregate: vi.fn().mockResolvedValue(aggregateResult),
    };
    const repository = {
      model: { file: fileModel },
    } as any;
    return { repository: new FileRepository(repository), fileModel };
  }

  describe('FileRepository.getStorageBytes', () => {
    it('sums fileSize for non-deleted files in the org', async () => {
      const { repository, fileModel } = buildFileRepository({
        _sum: { fileSize: 1234 },
      });

      const result = await repository.getStorageBytes('org-1');

      expect(result).toBe(1234);
      expect(fileModel.aggregate).toHaveBeenCalledWith({
        _sum: { fileSize: true },
        where: {
          organizationId: 'org-1',
          deletedAt: null,
        },
      });
    });

    it('excludes soft-deleted files via deletedAt: null', async () => {
      const { repository, fileModel } = buildFileRepository({
        _sum: { fileSize: 0 },
      });

      await repository.getStorageBytes('org-1');

      const where = fileModel.aggregate.mock.calls[0][0].where;
      expect(where).toHaveProperty('deletedAt', null);
    });

    it('returns 0 when there are no files', async () => {
      const { repository } = buildFileRepository({
        _sum: { fileSize: null },
      });

      expect(await repository.getStorageBytes('org-1')).toBe(0);
    });
  });

  function buildStorageService(overrides: Record<string, unknown> = {}) {
    const subscriptionService = {
      getSubscriptionByOrganizationId: vi.fn().mockResolvedValue({
        subscriptionTier: 'STARTER',
        extraStorageGb: 0,
      }),
      ...((overrides.subscriptionService as any) || {}),
    };
    const fileRepository = {
      getStorageBytes: vi.fn().mockResolvedValue(0),
      ...((overrides.fileRepository as any) || {}),
    };
    const storageRepository = {
      findMountedByOrg: vi.fn().mockResolvedValue([]),
      ...((overrides.storageRepository as any) || {}),
    };
    const service = new StorageService(
      storageRepository as any,
      {} as any,
      {} as any,
      {} as any,
      subscriptionService as any,
      fileRepository as any
    );
    return { service, subscriptionService, fileRepository, storageRepository };
  }

  describe('StorageService.assertWithinQuota', () => {
    beforeEach(() => {
      process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test';
    });

    it('passes when usage is under the plan cap', async () => {
      const { service, fileRepository } = buildStorageService();
      fileRepository.getStorageBytes.mockResolvedValue(0);

      await expect(service.assertWithinQuota('org-1', 1)).resolves.toBeUndefined();
    });

    it('throws 402 when usage plus incoming exceeds the plan cap', async () => {
      const { service, fileRepository } = buildStorageService();
      const gb = 1024 * 1024 * 1024;
      fileRepository.getStorageBytes.mockResolvedValue(gb);

      await expect(service.assertWithinQuota('org-1', 1)).rejects.toThrow(
        HttpException
      );
      await expect(service.assertWithinQuota('org-1', 1)).rejects.toThrow(
        'Hosted storage limit reached'
      );
    });

    it('meters a non-entitled (STARTER) org even with a non-LOCAL provider mounted (F2)', async () => {
      const { service, storageRepository, fileRepository } = buildStorageService();
      storageRepository.findMountedByOrg.mockResolvedValue([
        { type: StorageProviderType.S3 },
      ]);
      const gb = 1024 * 1024 * 1024;
      fileRepository.getStorageBytes.mockResolvedValue(100 * gb);

      // STARTER has byo_storage:false — the mount no longer waives the meter.
      await expect(service.assertWithinQuota('org-1', gb)).rejects.toThrow(
        HttpException
      );
      expect(fileRepository.getStorageBytes).toHaveBeenCalled();
    });

    it('is waived for a BYO-entitled (TEAM) org with a non-LOCAL provider mounted', async () => {
      const { service, subscriptionService, storageRepository, fileRepository } =
        buildStorageService();
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        subscriptionTier: 'TEAM',
        extraStorageGb: 0,
      });
      storageRepository.findMountedByOrg.mockResolvedValue([
        { type: StorageProviderType.S3 },
      ]);
      const gb = 1024 * 1024 * 1024;
      fileRepository.getStorageBytes.mockResolvedValue(100 * gb);

      await expect(service.assertWithinQuota('org-1', gb)).resolves.toBeUndefined();
      expect(fileRepository.getStorageBytes).not.toHaveBeenCalled();
    });

    it('raises the cap by extraStorageGb add-on packs', async () => {
      const { service, subscriptionService, fileRepository } = buildStorageService();
      subscriptionService.getSubscriptionByOrganizationId.mockResolvedValue({
        subscriptionTier: 'STARTER',
        extraStorageGb: 5,
      });
      const gb = 1024 * 1024 * 1024;
      fileRepository.getStorageBytes.mockResolvedValue(5 * gb + 1 * gb - 1);

      await expect(service.assertWithinQuota('org-1', 1)).resolves.toBeUndefined();

      fileRepository.getStorageBytes.mockResolvedValue(5 * gb + 1 * gb);
      await expect(service.assertWithinQuota('org-1', 1)).rejects.toThrow(
        HttpException
      );
    });

    it('is always waived in self-host mode without Stripe', async () => {
      delete process.env.STRIPE_PUBLISHABLE_KEY;
      const { service, fileRepository } = buildStorageService();
      const gb = 1024 * 1024 * 1024;
      fileRepository.getStorageBytes.mockResolvedValue(1000 * gb);

      await expect(service.assertWithinQuota('org-1', gb)).resolves.toBeUndefined();
      expect(fileRepository.getStorageBytes).not.toHaveBeenCalled();
    });
  });
});
