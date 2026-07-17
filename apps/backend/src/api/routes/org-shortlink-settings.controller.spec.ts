import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { OrgShortLinkSettingsController } from './org-shortlink-settings.controller';
import { OrgShortLinkSettingsService } from '@gitroom/nestjs-libraries/database/prisma/short-links/org-shortlink-settings.service';
import { ShortLinkOAuthService } from '@gitroom/nestjs-libraries/short-linking/short-link-oauth.service';
import type { ShortLinkAdapter } from '@gitroom/nestjs-libraries/short-linking/short-link.interface';

const org = { id: 'org-1' } as any;

function stubAdapter(overrides: Record<string, any> = {}): ShortLinkAdapter {
  return {
    identifier: 'bitly',
    name: 'Bitly',
    capabilities: {
      create: true,
      expand: false,
      statistics: true,
      bulkStatistics: false,
      customDomain: true,
    },
    credentialFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
    ],
    authType: 'apiKey',
    defaultDomain: 'bit.ly',
    setupNotes: 'Get your API key from Bitly dashboard',
    validateCredentials: vi.fn().mockResolvedValue({ ok: true }),
    resolveDomain: vi.fn().mockReturnValue('bit.ly'),
    createShortLink: vi.fn(),
    oauth: undefined as ShortLinkAdapter['oauth'],
    ...overrides,
  };
}

function stubService(overrides: Record<string, any> = {}) {
  return {
    getActiveProvider: vi.fn().mockResolvedValue(null),
    getProviders: vi.fn().mockResolvedValue([]),
    listProviderMetadata: vi.fn().mockReturnValue([]),
    upsertConfig: vi.fn().mockResolvedValue({ identifier: 'bitly', success: true }),
    updateConfigById: vi.fn().mockResolvedValue({ identifier: 'bitly', configId: 'cfg-1', success: true }),
    setActive: vi.fn().mockResolvedValue({ isActive: true }),
    delete: vi.fn().mockResolvedValue({}),
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    getPinnedVersion: vi.fn().mockResolvedValue('v1'),
    getConfigForProvider: vi.fn().mockResolvedValue(null),
    getExistingConfigId: vi.fn().mockResolvedValue(null),
    requireAdapter: vi.fn(),
    ...overrides,
  };
}

function stubOAuth(overrides: Record<string, any> = {}) {
  return {
    getOAuthUrl: vi.fn().mockResolvedValue({ url: 'https://oauth.example', state: 'state-123' }),
    oauthCallback: vi.fn().mockResolvedValue({ identifier: 'bitly', success: true }),
    ...overrides,
  };
}

describe('OrgShortLinkSettingsController', () => {
  let controller: OrgShortLinkSettingsController;
  let service: ReturnType<typeof stubService>;
  let oauth: ReturnType<typeof stubOAuth>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = stubService();
    oauth = stubOAuth();
    controller = new OrgShortLinkSettingsController(
      service as unknown as OrgShortLinkSettingsService,
      oauth as unknown as ShortLinkOAuthService,
    );
  });

  // ---------------------------------------------------------------------------
  // GET /providers
  // ---------------------------------------------------------------------------
  describe('GET /providers', () => {
    it('delegates to the service for the safe provider metadata list', async () => {
      const meta = [
        {
          identifier: 'bitly',
          name: 'Bitly',
          capabilities: stubAdapter().capabilities,
          credentialFields: stubAdapter().credentialFields,
          authType: 'apiKey',
          defaultDomain: 'bit.ly',
          setupNotes: 'Get your API key from Bitly dashboard',
        },
      ];
      service.listProviderMetadata.mockReturnValue(meta);

      const result = await controller.listProviders();

      expect(service.listProviderMetadata).toHaveBeenCalledOnce();
      expect(result).toEqual(meta);
    });

    it('returns empty array when no adapters registered', async () => {
      service.listProviderMetadata.mockReturnValue([]);

      const result = await controller.listProviders();

      expect(result).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // GET /config
  // ---------------------------------------------------------------------------
  describe('GET /config', () => {
    it('returns active provider without credentials or extraConfig', async () => {
      const active = {
        identifier: 'bitly',
        name: 'Bitly',
        credentials: 'secret',
        customDomain: 'short.myco.com',
        extraConfig: { plan: 'business' },
        enabled: true,
        isActive: true,
      };
      service.getActiveProvider.mockResolvedValue(active);
      service.getProviders.mockResolvedValue([]);

      const result = await controller.getConfig(org);

      expect(service.getActiveProvider).toHaveBeenCalledWith('org-1');
      expect(service.getProviders).toHaveBeenCalledWith('org-1');
      expect(result.active).not.toHaveProperty('credentials');
      expect(result.active).not.toHaveProperty('extraConfig');
      expect(result.active).toEqual({
        identifier: 'bitly',
        name: 'Bitly',
        customDomain: 'short.myco.com',
        enabled: true,
        isActive: true,
      });
    });

    it('returns null active when no active provider', async () => {
      service.getActiveProvider.mockResolvedValue(null);
      service.getProviders.mockResolvedValue([]);

      const result = await controller.getConfig(org);

      expect(result.active).toBeNull();
      expect(result.providers).toEqual([]);
    });

    it('returns all provider configs', async () => {
      service.getActiveProvider.mockResolvedValue(null);
      service.getProviders.mockResolvedValue([
        { identifier: 'bitly', enabled: true, isActive: false },
        { identifier: 'rebrandly', enabled: false, isActive: false },
      ]);

      const result = await controller.getConfig(org);

      expect(result.providers).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /config/:identifier
  // ---------------------------------------------------------------------------
  describe('PUT /config/:identifier', () => {
    const body = {
      credentials: { apiKey: 'test-key' },
      customDomain: 'short.myco.com',
      extraConfig: { plan: 'enterprise' },
    };

    it('delegates upsert to the service and returns success', async () => {
      const result = await controller.upsertConfig(org, 'bitly', body as any);

      expect(service.upsertConfig).toHaveBeenCalledWith('org-1', 'bitly', body);
      expect(result).toEqual({ identifier: 'bitly', success: true });
    });

    it('passes explicit version to upsertConfig', async () => {
      const result = await controller.upsertConfig(org, 'bitly', {
        ...body,
        version: 'v2',
      } as any);

      expect(service.upsertConfig).toHaveBeenCalledWith('org-1', 'bitly', {
        ...body,
        version: 'v2',
      });
      expect(result).toEqual({ identifier: 'bitly', success: true });
    });
  });

  // ---------------------------------------------------------------------------
  // PUT /config/:identifier/:configId
  // ---------------------------------------------------------------------------
  describe('PUT /config/:identifier/:configId', () => {
    const body = {
      credentials: { apiKey: 'rotated-key' },
      customDomain: 'short.myco.com',
    };

    it('delegates the rotation update to the service and returns success', async () => {
      const result = await controller.updateConfigById(org, 'bitly', 'cfg-1', body as any);

      expect(service.updateConfigById).toHaveBeenCalledWith('org-1', 'cfg-1', 'bitly', body);
      expect(result).toEqual({ identifier: 'bitly', configId: 'cfg-1', success: true });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/:identifier/set-active
  // ---------------------------------------------------------------------------
  describe('POST /config/:identifier/set-active', () => {
    it('sets active provider and returns result', async () => {
      const result = await controller.setActive(org, 'bitly', {} as any);

      expect(service.setActive).toHaveBeenCalledWith('org-1', 'bitly', undefined);
      expect(result).toEqual({ identifier: 'bitly', isActive: true });
    });

    it('passes explicit version to setActive', async () => {
      const result = await controller.setActive(org, 'bitly', { version: 'v2' } as any);

      expect(service.setActive).toHaveBeenCalledWith('org-1', 'bitly', 'v2');
      expect(result).toEqual({ identifier: 'bitly', isActive: true });
    });

    it('wraps service errors in BadRequestException', async () => {
      service.setActive.mockRejectedValue(new Error('Not configured'));

      await expect(controller.setActive(org, 'bitly', {} as any)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/:identifier/test
  // ---------------------------------------------------------------------------
  describe('POST /config/:identifier/test', () => {
    it('throws BadRequestException when the service rejects an unknown provider', async () => {
      service.testConnection.mockImplementation(() => {
        throw new BadRequestException('Unknown short-link provider');
      });

      await expect(
        controller.testConnection(org, 'nonexistent', {} as any),
      ).rejects.toThrow(BadRequestException);
    });

    it('validates inline credentials when provided in body', async () => {
      const body = { credentials: { apiKey: 'direct-key' } };
      const result = await controller.testConnection(org, 'bitly', body as any);

      expect(service.testConnection).toHaveBeenCalledWith(
        'org-1',
        'bitly',
        { apiKey: 'direct-key' },
        undefined,
      );
      expect(result).toEqual({ ok: true });
    });

    it('wraps inline credential validation errors in HttpException', async () => {
      service.testConnection.mockRejectedValue(new Error('Blocked URL'));

      await expect(
        controller.testConnection(org, 'bitly', { credentials: { apiKey: 'x' } } as any),
      ).rejects.toThrow(HttpException);
    });

    it('tests connection from stored config when no inline credentials', async () => {
      const result = await controller.testConnection(org, 'bitly', {} as any);

      expect(service.testConnection).toHaveBeenCalledWith('org-1', 'bitly', undefined, undefined);
      expect(result).toEqual({ ok: true });
    });

    it('wraps stored-config test errors in HttpException', async () => {
      service.testConnection.mockRejectedValue(new Error('Connection failed'));

      await expect(controller.testConnection(org, 'bitly', {} as any)).rejects.toThrow(
        HttpException,
      );
    });

    it('validates credentials with customDomain from body', async () => {
      const body = {
        credentials: { apiKey: 'key' },
        customDomain: 'links.example.com',
      };
      await controller.testConnection(org, 'bitly', body as any);

      expect(service.testConnection).toHaveBeenCalledWith(
        'org-1',
        'bitly',
        { apiKey: 'key' },
        'links.example.com',
      );
    });
  });

  // ---------------------------------------------------------------------------
  // DELETE /config/:identifier
  // ---------------------------------------------------------------------------
  describe('DELETE /config/:identifier', () => {
    it('deletes config and returns success', async () => {
      const result = await controller.deleteConfig(org, 'bitly');

      expect(service.delete).toHaveBeenCalledWith('org-1', 'bitly');
      expect(result).toEqual({ success: true });
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/:identifier/oauth/url
  // ---------------------------------------------------------------------------
  describe('POST /config/:identifier/oauth/url', () => {
    it('resolves pinned version and delegates to the OAuth service', async () => {
      service.getPinnedVersion.mockResolvedValue('v2');

      const result = await controller.getOAuthUrl(org, 'bitly', {
        redirectUri: 'https://app.example.com/oauth/callback',
      } as any);

      expect(service.getPinnedVersion).toHaveBeenCalledWith('org-1', 'bitly');
      expect(oauth.getOAuthUrl).toHaveBeenCalledWith(
        'org-1',
        'bitly',
        'https://app.example.com/oauth/callback',
        'v2',
      );
      expect(result).toEqual({ url: 'https://oauth.example', state: 'state-123' });
    });

    it('propagates OAuth service errors', async () => {
      oauth.getOAuthUrl.mockRejectedValue(new ForbiddenException('Invalid redirect URI'));

      await expect(
        controller.getOAuthUrl(org, 'bitly', {
          redirectUri: 'https://evil.com/steal',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ---------------------------------------------------------------------------
  // POST /config/:identifier/oauth/callback
  // ---------------------------------------------------------------------------
  describe('POST /config/:identifier/oauth/callback', () => {
    it('resolves pinned version and delegates to the OAuth service', async () => {
      service.getPinnedVersion.mockResolvedValue('v2');

      const result = await controller.oauthCallback(org, 'bitly', {
        code: 'auth-code',
        state: 'state-123',
        redirectUri: 'https://app.example.com/oauth/callback',
      } as any);

      expect(service.getPinnedVersion).toHaveBeenCalledWith('org-1', 'bitly');
      expect(oauth.oauthCallback).toHaveBeenCalledWith(
        'org-1',
        'bitly',
        'auth-code',
        'state-123',
        'https://app.example.com/oauth/callback',
        'v2',
      );
      expect(result).toEqual({ identifier: 'bitly', success: true });
    });

    it('propagates OAuth service errors', async () => {
      oauth.oauthCallback.mockRejectedValue(new ForbiddenException('OAuth state mismatch'));

      await expect(
        controller.oauthCallback(org, 'bitly', {
          code: 'auth-code',
          state: 'state-123',
          redirectUri: 'https://app.example.com/oauth/callback',
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
