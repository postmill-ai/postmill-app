import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpException } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { ContentPackController } from './content-pack.controller';

const mockListProviderMetadata = vi.fn();
const mockGetProviders = vi.fn();
const mockGetActiveProviderMetadata = vi.fn();
const mockGetProviderMetadata = vi.fn();
const mockUpsert = vi.fn();
const mockSetActive = vi.fn();
const mockDelete = vi.fn();
const mockTestConnection = vi.fn();

vi.mock(
  '@gitroom/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.service',
  () => ({
    OrgContentPackSettingsService: class {
      listProviderMetadata = mockListProviderMetadata;
      getProviders = mockGetProviders;
      getActiveProviderMetadata = mockGetActiveProviderMetadata;
      getProviderMetadata = mockGetProviderMetadata;
      upsert = mockUpsert;
      setActive = mockSetActive;
      delete = mockDelete;
      testConnection = mockTestConnection;
    },
  }),
);

import { OrgContentPackSettingsService } from '@gitroom/nestjs-libraries/database/prisma/content-packs/org-content-pack-settings.service';

const org = { id: 'org-1' } as any;

describe('ContentPackController', () => {
  let controller: ContentPackController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new ContentPackController(
      new (OrgContentPackSettingsService as any)(),
    );
  });

  // ---------------------------------------------------------------------------
  // RBAC gating
  // ---------------------------------------------------------------------------
  describe('RBAC gating', () => {
    const routes = [
      'listProviders',
      'getConfig',
      'upsertConfig',
      'setActive',
      'deactivate',
      'testConnection',
      'deleteConfig',
    ] as const;

    it('exposes the expected route handlers', () => {
      for (const route of routes) {
        expect(
          typeof ContentPackController.prototype[route as keyof ContentPackController]
        ).toBe('function');
      }
    });

    it.each(routes)('%s requires media-config:manage', (route) => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        ContentPackController.prototype[route as keyof ContentPackController]
      );
      expect(metadata).toEqual({ resource: 'media-config', action: 'manage' });
    });
  });

  // ---------------------------------------------------------------------------
  // GET /providers
  // ---------------------------------------------------------------------------
  describe('GET /providers', () => {
    it('delegates to the service for static provider metadata', async () => {
      const meta = [
        {
          identifier: 'magnific',
          name: 'Magnific',
          capabilities: ['photos', 'vectors', 'videos'],
          credentialFields: [{ key: 'apiKey', label: 'API Key', type: 'password', required: true }],
        },
      ];
      mockListProviderMetadata.mockReturnValue(meta);

      const result = await controller.listProviders();

      expect(mockListProviderMetadata).toHaveBeenCalledOnce();
      expect(result).toEqual(meta);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /config
  // ---------------------------------------------------------------------------
  describe('GET /config', () => {
    it('returns active metadata without credentials and provider list', async () => {
      mockGetActiveProviderMetadata.mockResolvedValue({
        identifier: 'magnific',
        name: 'Magnific',
        capabilities: ['photos'],
      });
      mockGetProviders.mockResolvedValue([
        { identifier: 'magnific', isConfigured: true, isActive: true },
      ]);

      const result = await controller.getConfig(org);

      expect(mockGetActiveProviderMetadata).toHaveBeenCalledWith('org-1');
      expect(mockGetProviders).toHaveBeenCalledWith('org-1');
      expect(result.active).not.toHaveProperty('credentials');
      expect(result.active).toEqual({
        identifier: 'magnific',
        name: 'Magnific',
        capabilities: ['photos'],
      });
      expect(result.providers).toHaveLength(1);
    });

    it('returns null active when no pack is active', async () => {
      mockGetActiveProviderMetadata.mockResolvedValue(null);
      mockGetProviders.mockResolvedValue([]);

      const result = await controller.getConfig(org);

      expect(result.active).toBeNull();
      expect(result.providers).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /config/:identifier
  // ---------------------------------------------------------------------------
  describe('PUT /config/:identifier', () => {
    it('throws BadRequestException for unknown provider identifier', async () => {
      mockGetProviderMetadata.mockReturnValue(undefined);

      await expect(
        controller.upsertConfig(org, 'nonexistent', { credentials: { apiKey: 'k' } } as any),
      ).rejects.toThrow(BadRequestException);

      expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('upserts config and returns success', async () => {
      mockGetProviderMetadata.mockReturnValue({
        identifier: 'magnific',
        name: 'Magnific',
        capabilities: ['photos'],
      });
      mockUpsert.mockResolvedValue({});

      const result = await controller.upsertConfig(org, 'magnific', {
        credentials: { apiKey: 'k' },
        extraConfig: { foo: 'bar' },
      } as any);

      expect(mockUpsert).toHaveBeenCalledWith('org-1', 'magnific', {
        credentials: { apiKey: 'k' },
        extraConfig: { foo: 'bar' },
      });
      expect(result).toEqual({ identifier: 'magnific', success: true });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/:identifier/set-active
  // ---------------------------------------------------------------------------
  describe('POST /config/:identifier/set-active', () => {
    it('sets active provider and returns result', async () => {
      mockSetActive.mockResolvedValue({});

      const result = await controller.setActive(org, 'magnific');

      expect(mockSetActive).toHaveBeenCalledWith('org-1', 'magnific');
      expect(result).toEqual({ identifier: 'magnific', isActive: true });
    });

    it('wraps service errors in BadRequestException', async () => {
      mockSetActive.mockRejectedValue(new Error('Not configured'));

      await expect(controller.setActive(org, 'magnific')).rejects.toThrow(BadRequestException);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /deactivate
  // ---------------------------------------------------------------------------
  describe('POST /deactivate', () => {
    it('deactivates the active provider', async () => {
      mockSetActive.mockResolvedValue({});

      const result = await controller.deactivate(org);

      expect(mockSetActive).toHaveBeenCalledWith('org-1', null);
      expect(result).toEqual({ isActive: false });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/:identifier/test
  // ---------------------------------------------------------------------------
  describe('POST /config/:identifier/test', () => {
    it('throws BadRequestException for unknown provider identifier', async () => {
      mockGetProviderMetadata.mockReturnValue(undefined);

      await expect(controller.testConnection(org, 'nonexistent', {} as any)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('validates inline credentials when provided in body', async () => {
      mockGetProviderMetadata.mockReturnValue({
        identifier: 'magnific',
        name: 'Magnific',
        capabilities: ['photos'],
      });
      mockTestConnection.mockResolvedValue({
        ok: true,
        message: 'Connection successful',
        result: { results: [] },
      });

      const result = await controller.testConnection(org, 'magnific', {
        credentials: { apiKey: 'direct-key' },
      } as any);

      expect(mockTestConnection).toHaveBeenCalledWith('org-1', 'magnific', {
        apiKey: 'direct-key',
      });
      expect(result).toMatchObject({ ok: true, message: 'Connection successful' });
    });

    it('tests connection from stored config when no inline credentials', async () => {
      mockGetProviderMetadata.mockReturnValue({
        identifier: 'magnific',
        capabilities: ['photos'],
      });
      mockTestConnection.mockResolvedValue({ ok: true });

      const result = await controller.testConnection(org, 'magnific', {} as any);

      expect(mockTestConnection).toHaveBeenCalledWith('org-1', 'magnific', undefined);
      expect(result).toEqual({ ok: true });
    });

    it('wraps stored-config test errors in HttpException', async () => {
      mockGetProviderMetadata.mockReturnValue({
        identifier: 'magnific',
        capabilities: ['photos'],
      });
      mockTestConnection.mockRejectedValue(new Error('Connection failed'));

      await expect(controller.testConnection(org, 'magnific', {} as any)).rejects.toThrow(
        HttpException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /config/:identifier
  // ---------------------------------------------------------------------------
  describe('DELETE /config/:identifier', () => {
    it('deletes config and returns success', async () => {
      mockDelete.mockResolvedValue({});

      const result = await controller.deleteConfig(org, 'magnific');

      expect(mockDelete).toHaveBeenCalledWith('org-1', 'magnific');
      expect(result).toEqual({ success: true });
    });
  });
});
