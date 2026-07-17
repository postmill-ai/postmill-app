import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageProviderType, Organization, User } from '@prisma/client';
import { Ability, AbilityBuilder, AbilityClass } from '@casl/ability';

const serviceMock = {
  getProviderConfigs: vi.fn(),
  createAndTestConfig: vi.fn(),
  updateConfig: vi.fn(),
  deleteConfig: vi.fn(),
  testConnection: vi.fn(),
  mount: vi.fn(),
  unmount: vi.fn(),
  getUsageDto: vi.fn(),
  getQuotaStatusDto: vi.fn(),
  getUsageBreakdownDto: vi.fn(),
  getMigrationPreview: vi.fn(),
  migrate: vi.fn(),
  setDefaultFolderForProvider: vi.fn(),
};

const auditMock = {
  createLog: vi.fn(),
};

const fileMock = {
  getFiles: vi.fn(),
};

const permissionsMock = {
  check: vi.fn(),
};

vi.mock('@gitroom/nestjs-libraries/database/prisma/storage/storage.service', () => ({
  StorageService: class {
    getProviderConfigs = serviceMock.getProviderConfigs;
    createAndTestConfig = serviceMock.createAndTestConfig;
    updateConfig = serviceMock.updateConfig;
    deleteConfig = serviceMock.deleteConfig;
    testConnection = serviceMock.testConnection;
    mount = serviceMock.mount;
    unmount = serviceMock.unmount;
    getUsageDto = serviceMock.getUsageDto;
    getQuotaStatusDto = serviceMock.getQuotaStatusDto;
    getUsageBreakdownDto = serviceMock.getUsageBreakdownDto;
    getMigrationPreview = serviceMock.getMigrationPreview;
    migrate = serviceMock.migrate;
    setDefaultFolderForProvider = serviceMock.setDefaultFolderForProvider;
  },
}));

import { StorageController } from './storage.controller';
import { HttpException } from '@nestjs/common';
import type { StorageService } from '@gitroom/nestjs-libraries/database/prisma/storage/storage.service';
import type { AuditService } from '@gitroom/nestjs-libraries/database/prisma/audit/audit.service';
import type { FileService } from '@gitroom/nestjs-libraries/database/prisma/file/file.service';
import {
  AppAbility,
  PermissionsService,
} from '@gitroom/backend/services/auth/permissions/permissions.service';
import { CHECK_POLICIES_KEY } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';

const org: Organization = { id: 'org-1', createdAt: new Date() } as any;
const user: User = { id: 'user-1' } as any;

// Mirror of the PoliciesGuard ability for [Create, BYO_STORAGE].
function byoAbility(entitled: boolean) {
  const { can, build } = new AbilityBuilder<
    Ability<[AuthorizationActions, Sections]>
  >(Ability as AbilityClass<AppAbility>);
  if (entitled) {
    can(AuthorizationActions.Create, Sections.BYO_STORAGE);
  }
  return build();
}

function makeController(entitled = true) {
  permissionsMock.check.mockResolvedValue(byoAbility(entitled));
  return new StorageController(
    serviceMock as unknown as StorageService,
    auditMock as unknown as AuditService,
    fileMock as unknown as FileService,
    permissionsMock as unknown as PermissionsService
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StorageController', () => {
  describe('listProviders', () => {
    it('returns all providers for the org', async () => {
      serviceMock.getProviderConfigs.mockResolvedValue([
        { id: 'local-1', name: 'Local Storage', type: 'LOCAL' },
      ]);
      const controller = makeController();

      const result = await controller.listProviders(org);

      expect(result).toHaveLength(1);
      expect(serviceMock.getProviderConfigs).toHaveBeenCalledWith('org-1');
    });
  });

  describe('createProvider', () => {
    it('delegates create+test+rollback to the service', async () => {
      serviceMock.createAndTestConfig.mockResolvedValue({
        id: 's3-1',
        name: 'My S3',
        type: 'S3',
      });
      const controller = makeController();

      const result = await controller.createProvider(org, user, {
        type: StorageProviderType.S3,
        name: 'My S3',
        credentials: { accessKeyId: 'key', secretAccessKey: 'secret' },
        region: 'us-east-1',
        bucket: 'my-bucket',
      });

      expect(result.name).toBe('My S3');
      expect(serviceMock.createAndTestConfig).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ name: 'My S3', quotaBytes: undefined }),
        'user-1'
      );
    });

    it('passes BigInt quotaBytes to the service', async () => {
      serviceMock.createAndTestConfig.mockResolvedValue({ id: 's3-1' });
      const controller = makeController();

      await controller.createProvider(org, user, {
        type: StorageProviderType.S3,
        name: 'My S3',
        quotaBytes: 1024,
      } as any);

      expect(serviceMock.createAndTestConfig).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ quotaBytes: BigInt(1024) }),
        'user-1'
      );
    });

    it('propagates a connection-test failure from the service', async () => {
      serviceMock.createAndTestConfig.mockRejectedValue(
        new HttpException('Connection test failed: bad creds', 400)
      );
      const controller = makeController();

      await expect(
        controller.createProvider(org, user, {
          type: StorageProviderType.S3,
          name: 'Bad Config',
        } as any)
      ).rejects.toThrow(HttpException);
    });
  });

  describe('updateProvider', () => {
    it('updates provider configuration', async () => {
      serviceMock.getProviderConfigs.mockResolvedValue([
        { id: 's3-1', name: 'My S3', type: 'S3', mounted: false },
      ]);
      serviceMock.updateConfig.mockResolvedValue({
        id: 's3-1',
        name: 'Updated S3',
      });
      const controller = makeController();

      await controller.updateProvider(org, user, 's3-1', {
        name: 'Updated S3',
      });

      expect(serviceMock.updateConfig).toHaveBeenCalledWith(
        's3-1',
        'org-1',
        expect.objectContaining({ name: 'Updated S3' }),
        'user-1'
      );
    });
  });

  describe('deleteProvider', () => {
    it('deletes a provider', async () => {
      serviceMock.deleteConfig.mockResolvedValue({});
      const controller = makeController();

      const result = await controller.deleteProvider(org, user, 's3-1');

      expect(result).toEqual({ success: true });
      expect(serviceMock.deleteConfig).toHaveBeenCalledWith('s3-1', 'org-1', 'user-1');
    });
  });

  describe('testConnection', () => {
    it('tests connectivity to a provider', async () => {
      serviceMock.testConnection.mockResolvedValue({
        ok: true,
      });
      const controller = makeController();

      const result = await controller.testConnection(org, 's3-1');

      expect(result.ok).toBe(true);
    });
  });

  describe('mountProvider', () => {
    it('mounts a provider and creates its root folder', async () => {
      serviceMock.mount.mockResolvedValue({
        id: 's3-1',
        mounted: true,
      });
      const controller = makeController();

      const result = await controller.mountProvider(org, 's3-1');

      expect(result.mounted).toBe(true);
    });
  });

  describe('unmountProvider', () => {
    it('unmounts a provider', async () => {
      serviceMock.unmount.mockResolvedValue({
        id: 's3-1',
        mounted: false,
      });
      const controller = makeController();

      const result = await controller.unmountProvider(org, 's3-1');

      expect(result.mounted).toBe(false);
    });
  });

  describe('migratePreview', () => {
    it('returns a preview of files to migrate', async () => {
      serviceMock.getMigrationPreview.mockResolvedValue({
        count: 5,
        totalBytes: 1024,
      });
      const controller = makeController();

      const result = await controller.migratePreview(org, 'src-id');

      expect(result.count).toBe(5);
      expect(result.totalBytes).toBe(1024);
    });
  });

  describe('migrateStorage', () => {
    it('performs a migration batch', async () => {
      serviceMock.migrate.mockResolvedValue({
        migrated: 10,
        failed: 0,
        errors: [],
        done: true,
      });
      const controller = makeController();

      const result = await controller.migrateStorage(org, 'src-id', 'tgt-id', {
        cursor: undefined,
        limit: 25,
      });

      expect(result.migrated).toBe(10);
      expect(result.done).toBe(true);
      expect(serviceMock.migrate).toHaveBeenCalledWith(
        'src-id',
        'tgt-id',
        'org-1',
        undefined,
        25
      );
    });

    it('clamps the limit to [1, 100]', async () => {
      serviceMock.migrate.mockResolvedValue({
        migrated: 0,
        failed: 0,
        errors: [],
        done: true,
      });
      const controller = makeController();

      await controller.migrateStorage(org, 'src', 'tgt', { limit: 999 });

      expect(serviceMock.migrate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        undefined,
        100
      );
    });
  });

  describe('getUsage', () => {
    it('returns DTO-ready storage usage', async () => {
      serviceMock.getUsageDto.mockResolvedValue({
        totalBytes: 1000,
        quotaBytes: 5000,
        providers: [
          { id: 'local-1', name: 'Local', usageBytes: 1000 },
        ],
      });
      const controller = makeController();

      const result = await controller.getUsage(org);

      expect(serviceMock.getUsageDto).toHaveBeenCalledWith('org-1');
      expect(result.totalBytes).toBe(1000);
      expect(result.quotaBytes).toBe(5000);
      expect(result.providers).toHaveLength(1);
    });
  });

  describe('getQuotaStatus', () => {
    it('returns DTO-ready quota status', async () => {
      serviceMock.getQuotaStatusDto.mockResolvedValue({
        usedBytes: 1000,
        quotaBytes: 5000,
        percentUsed: 20,
        warning: false,
      });
      const controller = makeController();

      const result = await controller.getQuotaStatus(org);

      expect(serviceMock.getQuotaStatusDto).toHaveBeenCalledWith('org-1');
      expect(result.percentUsed).toBe(20);
      expect(result.warning).toBe(false);
    });
  });

  describe('getUsageBreakdown', () => {
    it('returns DTO-ready usage breakdown', async () => {
      serviceMock.getUsageBreakdownDto.mockResolvedValue({
        byFolder: [{ folderId: 'f-1', folderName: 'Root', totalBytes: 100 }],
        byProvider: [{ providerId: 'local', providerName: 'Local', totalBytes: 100 }],
      });
      const controller = makeController();

      const result = await controller.getUsageBreakdown(org);

      expect(serviceMock.getUsageBreakdownDto).toHaveBeenCalledWith('org-1');
      expect(result.byFolder[0].totalBytes).toBe(100);
    });
  });

  describe('setDefaultFolder', () => {
    it('delegates folder ownership validation and update to the service', async () => {
      serviceMock.setDefaultFolderForProvider.mockResolvedValue({ id: 's3-1', defaultFolderId: 'f-1' });
      const controller = makeController();

      const result = await controller.setDefaultFolder(org, user, 's3-1', { folderId: 'f-1' });

      expect(serviceMock.setDefaultFolderForProvider).toHaveBeenCalledWith(
        's3-1',
        'f-1',
        'org-1',
        'user-1'
      );
      expect(result).toEqual({ id: 's3-1', defaultFolderId: 'f-1' });
    });

    it('normalizes empty folderId to null', async () => {
      serviceMock.setDefaultFolderForProvider.mockResolvedValue({ id: 's3-1', defaultFolderId: null });
      const controller = makeController();

      await controller.setDefaultFolder(org, user, 's3-1', { folderId: '' });

      expect(serviceMock.setDefaultFolderForProvider).toHaveBeenCalledWith(
        's3-1',
        null,
        'org-1',
        'user-1'
      );
    });
  });

  describe('no setDefault route', () => {
    it('does not expose a setDefaultProvider handler', () => {
      const controller = makeController();

      expect(
        Object.getOwnPropertyNames(Object.getPrototypeOf(controller))
      ).not.toContain('setDefaultProvider');
    });
  });

  // F2 — BYO storage is a paid capability (TEAM/AGENCY). Mount is gated by the
  // PoliciesGuard decorator; create/update need conditional gates (LOCAL stays
  // free; update only bites mounted non-LOCAL configs), so those run the same
  // ability check in-handler and mirror the guard's 402 outcome.
  describe('BYO storage paywall (F2)', () => {
    describe('createProvider', () => {
      it('402s a non-entitled (STARTER) org creating a non-LOCAL config', async () => {
        const controller = makeController(false);

        await expect(
          controller.createProvider(org, user, {
            type: StorageProviderType.S3,
            name: 'My S3',
          } as any)
        ).rejects.toMatchObject({ status: 402 });
        expect(serviceMock.createAndTestConfig).not.toHaveBeenCalled();
      });

      it('allows a non-entitled org creating a LOCAL config', async () => {
        serviceMock.createAndTestConfig.mockResolvedValue({ id: 'local-1' });
        const controller = makeController(false);

        await expect(
          controller.createProvider(org, user, {
            type: StorageProviderType.LOCAL,
            name: 'Local Storage',
          } as any)
        ).resolves.toEqual({ id: 'local-1' });
        expect(serviceMock.createAndTestConfig).toHaveBeenCalledTimes(1);
        expect(permissionsMock.check).not.toHaveBeenCalled();
      });

      it('allows an entitled (TEAM) org creating a non-LOCAL config', async () => {
        serviceMock.createAndTestConfig.mockResolvedValue({ id: 's3-1' });
        const controller = makeController(true);

        await expect(
          controller.createProvider(org, user, {
            type: StorageProviderType.S3,
            name: 'My S3',
          } as any)
        ).resolves.toEqual({ id: 's3-1' });
      });
    });

    describe('mountProvider', () => {
      it('carries the BYO_STORAGE policy decorator', () => {
        const metadata = Reflect.getMetadata(
          CHECK_POLICIES_KEY,
          StorageController.prototype.mountProvider
        );
        expect(metadata).toEqual([
          [AuthorizationActions.Create, Sections.BYO_STORAGE],
        ]);
      });
    });

    describe('updateProvider', () => {
      const mountedS3 = {
        id: 's3-1',
        name: 'My S3',
        type: 'S3',
        mounted: true,
      };

      it('402s a non-entitled org updating a mounted non-LOCAL config', async () => {
        serviceMock.getProviderConfigs.mockResolvedValue([mountedS3]);
        const controller = makeController(false);

        await expect(
          controller.updateProvider(org, user, 's3-1', { name: 'renamed' } as any)
        ).rejects.toMatchObject({ status: 402 });
        expect(serviceMock.updateConfig).not.toHaveBeenCalled();
      });

      it('allows a non-entitled org updating an unmounted non-LOCAL config', async () => {
        serviceMock.getProviderConfigs.mockResolvedValue([
          { ...mountedS3, mounted: false },
        ]);
        serviceMock.updateConfig.mockResolvedValue({ id: 's3-1' });
        const controller = makeController(false);

        await expect(
          controller.updateProvider(org, user, 's3-1', { name: 'renamed' } as any)
        ).resolves.toEqual({ id: 's3-1' });
        expect(serviceMock.updateConfig).toHaveBeenCalledTimes(1);
      });

      it('allows a non-entitled org updating a mounted LOCAL config', async () => {
        serviceMock.getProviderConfigs.mockResolvedValue([
          { id: 'local-1', name: 'Local', type: 'LOCAL', mounted: true },
        ]);
        serviceMock.updateConfig.mockResolvedValue({ id: 'local-1' });
        const controller = makeController(false);

        await expect(
          controller.updateProvider(org, user, 'local-1', { name: 'renamed' } as any)
        ).resolves.toEqual({ id: 'local-1' });
        expect(serviceMock.updateConfig).toHaveBeenCalledTimes(1);
      });

      it('allows an entitled org updating a mounted non-LOCAL config', async () => {
        serviceMock.getProviderConfigs.mockResolvedValue([mountedS3]);
        serviceMock.updateConfig.mockResolvedValue({ id: 's3-1' });
        const controller = makeController(true);

        await expect(
          controller.updateProvider(org, user, 's3-1', { name: 'renamed' } as any)
        ).resolves.toEqual({ id: 's3-1' });
      });
    });
  });
});
