import { describe, it, expect, vi, beforeEach } from 'vitest';
import 'reflect-metadata';
import { HttpException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { MediaProviderController } from './media-provider.controller';

const mockListProviderMetadata = vi.fn();
const mockGetProviders = vi.fn();
const mockUpsertConfig = vi.fn();
const mockSetStorage = vi.fn();
const mockSetActiveWithDefaults = vi.fn();
const mockDeleteConfig = vi.fn();
const mockTestConnection = vi.fn();

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service',
  () => ({
    OrgMediaProviderSettingsService: class {
      listProviderMetadata = mockListProviderMetadata;
      getProviders = mockGetProviders;
      upsertConfig = mockUpsertConfig;
      setStorage = mockSetStorage;
      setActiveWithDefaults = mockSetActiveWithDefaults;
      deleteConfig = mockDeleteConfig;
      testConnection = mockTestConnection;
    },
  }),
);

import { OrgMediaProviderSettingsService } from '@gitroom/nestjs-libraries/database/prisma/media-providers/org-media-provider-settings.service';

const org = { id: 'org-1' } as any;

describe('MediaProviderController', () => {
  let controller: MediaProviderController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new MediaProviderController(
      new (OrgMediaProviderSettingsService as any)(),
    );
  });

  // Every /settings/media route must carry the media-config:manage RBAC gate.
  describe('RBAC gating', () => {
    const routes = [
      'listProviders',
      'getConfig',
      'upsertConfig',
      'setStorage',
      'setActive',
      'testConnection',
      'deleteConfig',
    ] as const;

    it('exposes the expected route handlers', () => {
      for (const route of routes) {
        expect(
          typeof MediaProviderController.prototype[
            route as keyof MediaProviderController
          ]
        ).toBe('function');
      }
    });

    it.each(routes)('%s requires media-config:manage', (route) => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        MediaProviderController.prototype[route as keyof MediaProviderController]
      );
      expect(metadata).toEqual({ resource: 'media-config', action: 'manage' });
    });
  });

  describe('GET /providers', () => {
    it('delegates to the service for provider metadata', async () => {
      const meta: Array<{
        identifier: string;
        name: string;
        capabilities: Record<string, boolean>;
        credentialFields: unknown;
      }> = [{ identifier: 'openai', name: 'OpenAI', capabilities: { image: true }, credentialFields: null }];
      mockListProviderMetadata.mockReturnValue(meta);

      const result = await controller.listProviders();

      expect(mockListProviderMetadata).toHaveBeenCalledOnce();
      expect(result).toEqual(meta);
    });
  });

  describe('GET /config', () => {
    it('returns provider configs', async () => {
      mockGetProviders.mockResolvedValue([{ identifier: 'openai', enabled: true }]);

      const result = await controller.getConfig(org);

      expect(mockGetProviders).toHaveBeenCalledWith('org-1');
      expect(result.providers).toHaveLength(1);
    });
  });

  describe('PUT /config/:identifier', () => {
    it('delegates upsert to the service', async () => {
      mockUpsertConfig.mockResolvedValue({ identifier: 'openai', success: true });

      const result = await controller.upsertConfig(org, 'openai', {
        credentials: { apiKey: 'sk-1' },
        version: 'v1',
      } as any);

      expect(mockUpsertConfig).toHaveBeenCalledWith('org-1', 'openai', {
        credentials: { apiKey: 'sk-1' },
        version: 'v1',
      });
      expect(result).toEqual({ identifier: 'openai', success: true });
    });
  });

  describe('PUT /config/:identifier/storage', () => {
    it('delegates storage binding to the service', async () => {
      mockSetStorage.mockResolvedValue({ identifier: 'openai', success: true });

      const result = await controller.setStorage(org, 'openai', {
        storageProviderId: 'sp-1',
        storageRootFolderId: 'root-1',
      } as any);

      expect(mockSetStorage).toHaveBeenCalledWith('org-1', 'openai', {
        storageProviderId: 'sp-1',
        storageRootFolderId: 'root-1',
      });
      expect(result).toEqual({ identifier: 'openai', success: true });
    });
  });

  describe('POST /config/:identifier/set-active', () => {
    it('delegates to the service and returns isActive', async () => {
      mockSetActiveWithDefaults.mockResolvedValue({ identifier: 'openai', success: true, isActive: true });

      const result = await controller.setActive(org, 'openai', { version: 'v1' } as any);

      expect(mockSetActiveWithDefaults).toHaveBeenCalledWith('org-1', 'openai', 'v1');
      expect(result.isActive).toBe(true);
    });
  });

  describe('POST /config/:identifier/test', () => {
    it('tests inline credentials through the service', async () => {
      mockTestConnection.mockResolvedValue({
        ok: true,
        message: 'Connection successful',
        result: { url: 'https://example.com/img.png' },
      });

      const result = await controller.testConnection(org, 'openai', {
        credentials: { apiKey: 'sk-1' },
      } as any);

      expect(mockTestConnection).toHaveBeenCalledWith('org-1', 'openai', { apiKey: 'sk-1' });
      expect(result).toMatchObject({ ok: true, message: 'Connection successful' });
    });

    it('returns 400 when inline credentials target an unknown provider', async () => {
      mockTestConnection.mockRejectedValue(new HttpException('Unknown media provider', 400));

      await expect(
        controller.testConnection(org, 'unknown', { credentials: { apiKey: 'x' } } as any),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('tests stored config when no inline credentials', async () => {
      mockTestConnection.mockResolvedValue({ ok: true });

      const result = await controller.testConnection(org, 'openai', {} as any);

      expect(mockTestConnection).toHaveBeenCalledWith('org-1', 'openai', undefined);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('DELETE /config/:identifier', () => {
    it('delegates delete to the service', async () => {
      mockDeleteConfig.mockResolvedValue({ success: true });

      const result = await controller.deleteConfig(org, 'openai');

      expect(mockDeleteConfig).toHaveBeenCalledWith('org-1', 'openai');
      expect(result).toEqual({ success: true });
    });
  });
});
