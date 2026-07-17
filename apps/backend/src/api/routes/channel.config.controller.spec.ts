import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, Logger, UseGuards } from '@nestjs/common';
import { REQUIRE_PERMISSION_KEY } from '@gitroom/backend/services/auth/rbac/require-permission.decorator';
import { SuperAdminGuard } from '@gitroom/backend/services/auth/rbac/super-admin.guard';
import { OrgRbacGuard } from '@gitroom/backend/services/auth/rbac/org-rbac.guard';

// The social provider list now comes from IntegrationManager (kernel-backed);
// the controller iterates `getSocialProviders()` / looks up a single provider
// via `getSocialIntegrationUnchecked(identifier)`.
const fakeProviders = [
  { identifier: 'x', name: 'X', toolTip: 'X social', scopes: ['tweet.read', 'tweet.write'] },
  { identifier: 'facebook', name: 'Facebook', toolTip: 'Facebook social', scopes: ['pages_manage_posts'] },
  { identifier: 'telegram', name: 'Telegram', toolTip: 'Telegram messenger', externalUrl: 'https://t.me', scopes: [] },
  { identifier: 'web3-test', name: 'Web3', isWeb3: true, scopes: [] },
  { identifier: 'ext-test', name: 'Extension', toolTip: 'Ext', isChromeExtension: true, customFields: true, scopes: ['ext_scope'] },
] as any[];

vi.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class {},
}));

vi.mock('@prisma/client', () => {
  class MockPrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.name = 'PrismaClientKnownRequestError';
      this.code = opts.code;
    }
  }
  return { Prisma: { PrismaClientKnownRequestError: MockPrismaClientKnownRequestError } };
});

import { ChannelConfigController } from './channel.config.controller';
import { Prisma } from '@prisma/client';

const mockProviderConfigService = {
  getAll: vi.fn(),
  getByIdentifier: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  decryptConfig: vi.fn(),
  getProviderCatalog: vi.fn(),
  getProviderCatalogEntry: vi.fn(),
};

const mockProviderConfigManager = {
  refreshCache: vi.fn(),
};

const mockIntegrationManager = {
  getSocialProviders: () => fakeProviders,
  getSocialIntegrationUnchecked: (identifier: string) =>
    fakeProviders.find((p) => p.identifier === identifier),
};

function createDbConfig(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    identifier: 'x',
    name: 'X',
    enabled: true,
    clientId: 'enc-client-id',
    clientSecret: 'enc-client-secret',
    redirectUri: 'https://redirect.com',
    scopes: 'custom_scope',
    setupInstructions: 'Setup steps',
    additionalConfig: null,
    ...overrides,
  };
}

const adminUser = { id: '1', isSuperAdmin: true } as any;
const regularUser = { id: '2', isSuperAdmin: false } as any;

let controller: ChannelConfigController;

beforeEach(() => {
  vi.clearAllMocks();
  controller = new ChannelConfigController(
    mockProviderConfigService as any,
    mockProviderConfigManager as any,
    mockIntegrationManager as any,
  );
  mockProviderConfigService.decryptConfig.mockReturnValue({ clientId: undefined, clientSecret: undefined });
  mockProviderConfigManager.refreshCache.mockResolvedValue(undefined);
  });

  // ---------------------------------------------------------------------------
  // Permission guards
  // ---------------------------------------------------------------------------
  describe('permission guards', () => {
    it('listConfigs is gated with channels:manage permission', () => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        controller.listConfigs,
      );
      expect(metadata).toEqual({ resource: 'channels', action: 'manage' });
    });

    it('getConfig is gated with channels:manage permission', () => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        controller.getConfig,
      );
      expect(metadata).toEqual({ resource: 'channels', action: 'manage' });
    });

    it('saveConfig is gated with channels:manage permission', () => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        controller.saveConfig,
      );
      expect(metadata).toEqual({ resource: 'channels', action: 'manage' });
    });

    it('deleteConfig is gated with channels:manage permission', () => {
      const metadata = Reflect.getMetadata(
        REQUIRE_PERMISSION_KEY,
        controller.deleteConfig,
      );
      expect(metadata).toEqual({ resource: 'channels', action: 'manage' });
    });
  });

  describe('listConfigs', () => {
  it('delegates catalog assembly to ProviderConfigService.getProviderCatalog', async () => {
    const catalog = [
      {
        identifier: 'x',
        name: 'X',
        description: 'X social',
        enabled: true,
        isConfigured: true,
        setupInstructions: 'Setup X',
        additionalConfig: '',
        isExternal: false,
        isWeb3: false,
        isChromeExtension: false,
        customFields: false,
        scopes: 'tweet.read, tweet.write',
      },
      {
        identifier: 'telegram',
        name: 'Telegram',
        description: 'Telegram messenger',
        enabled: false,
        isConfigured: false,
        setupInstructions: '',
        additionalConfig: '',
        isExternal: true,
        isWeb3: false,
        isChromeExtension: false,
        customFields: false,
        scopes: '',
      },
    ];
    mockProviderConfigService.getProviderCatalog.mockResolvedValue(catalog);

    const result = await controller.listConfigs(adminUser);

    expect(mockProviderConfigService.getProviderCatalog).toHaveBeenCalledTimes(1);
    expect(mockProviderConfigService.getProviderCatalog).toHaveBeenCalledWith(fakeProviders);
    expect(result).toBe(catalog);
  });
});

describe('getConfig', () => {
  it('delegates catalog entry lookup to ProviderConfigService.getProviderCatalogEntry', async () => {
    const entry = {
      identifier: 'x',
      name: 'X',
      enabled: true,
      redirectUri: 'https://redirect.com',
      scopes: 'custom_scope',
      setupInstructions: 'Setup steps',
      isConfigured: true,
      additionalConfig: '',
      isExternal: false,
      isWeb3: false,
      isChromeExtension: false,
      customFields: false,
    };
    mockProviderConfigService.getProviderCatalogEntry.mockResolvedValue(entry);

    const result = await controller.getConfig(adminUser, 'x');

    expect(mockProviderConfigService.getProviderCatalogEntry).toHaveBeenCalledWith('x', fakeProviders);
    expect(result).toBe(entry);
  });
});

describe('saveConfig', () => {
  const validBody = {
    enabled: true,
    clientId: 'my-client-id',
    clientSecret: 'my-client-secret',
    redirectUri: 'https://callback.com',
    scopes: 'read,write',
    setupInstructions: 'How to set up',
    additionalConfig: '{"key":"val"}',
  };

  it('should upsert with correct data and return result', async () => {
    const upsertResult = createDbConfig({ identifier: 'x' });
    mockProviderConfigService.upsert.mockResolvedValue(upsertResult);
    mockProviderConfigService.decryptConfig.mockReturnValue({ clientId: 'decrypted-id', clientSecret: 'decrypted-secret' });

    const result = await controller.saveConfig(adminUser, 'x', validBody);

    expect(mockProviderConfigService.upsert).toHaveBeenCalledWith('x', {
      name: 'X',
      enabled: true,
      clientId: 'my-client-id',
      clientSecret: 'my-client-secret',
      redirectUri: 'https://callback.com',
      scopes: 'read,write',
      setupInstructions: 'How to set up',
      additionalConfig: '{"key":"val"}',
    });

    expect(mockProviderConfigManager.refreshCache).toHaveBeenCalledTimes(1);

    expect(result).toMatchObject({
      identifier: 'x',
      name: 'X',
      enabled: true,
      isConfigured: true,
      redirectUri: upsertResult.redirectUri,
      scopes: upsertResult.scopes,
      additionalConfig: upsertResult.additionalConfig,
      setupInstructions: upsertResult.setupInstructions,
    });
  });

  it('should pass undefined for body fields not provided', async () => {
    const body = { enabled: true };
    const upsertResult = createDbConfig({ identifier: 'x' });
    mockProviderConfigService.upsert.mockResolvedValue(upsertResult);
    mockProviderConfigService.decryptConfig.mockReturnValue({ clientId: undefined, clientSecret: undefined });

    await controller.saveConfig(adminUser, 'x', body);

    expect(mockProviderConfigService.upsert).toHaveBeenCalledWith('x', {
      name: 'X',
      enabled: true,
      clientId: undefined,
      clientSecret: undefined,
      redirectUri: undefined,
      scopes: undefined,
      setupInstructions: undefined,
      additionalConfig: undefined,
    });
  });

  it.each([
    ['enabled', 'enabled must be a boolean'],
  ])('should throw 400 when %s is not boolean', async (field, message) => {
    const body = { enabled: 'not-boolean' } as any;
    await expect(controller.saveConfig(adminUser, 'x', body))
      .rejects.toThrow(BadRequestException);
  });

  it.each([
    ['clientId', 'clientId must be a string', { enabled: true, clientId: 123 }],
    ['clientSecret', 'clientSecret must be a string', { enabled: true, clientSecret: 456 }],
    ['redirectUri', 'redirectUri must be a string', { enabled: true, redirectUri: 789 }],
    ['scopes', 'scopes must be a string', { enabled: true, scopes: true }],
    ['setupInstructions', 'setupInstructions must be a string', { enabled: true, setupInstructions: 999 }],
    ['additionalConfig', 'additionalConfig must be a string', { enabled: true, additionalConfig: [] }],
  ])('should throw 400 when %s is not a string', async (_field, message, body) => {
    const err = await controller.saveConfig(adminUser, 'x', body as any).catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe(message);
  });

  it('should throw 400 for unknown provider identifier', async () => {
    const body = { enabled: true };
    const err = await controller.saveConfig(adminUser, 'nonexistent', body).catch(e => e);
    expect(err).toBeInstanceOf(BadRequestException);
  });

  it('should handle refreshCache failure gracefully', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    const err = new Error('cache down');

    mockProviderConfigService.upsert.mockResolvedValue(createDbConfig({ identifier: 'x' }));
    mockProviderConfigService.decryptConfig.mockReturnValue({ clientId: 'id', clientSecret: 'secret' });
    mockProviderConfigManager.refreshCache.mockRejectedValue(err);

    const result = await controller.saveConfig(adminUser, 'x', { enabled: true });

    expect(result.isConfigured).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to refresh cache after config upsert, stale cache will self-correct'),
    );
    warnSpy.mockRestore();
  });
});

describe('deleteConfig', () => {
  it('should delete existing config and refresh cache', async () => {
    const config = createDbConfig({ identifier: 'x' });
    mockProviderConfigService.getByIdentifier.mockResolvedValue(config);
    mockProviderConfigService.delete.mockResolvedValue(undefined);

    const result = await controller.deleteConfig(adminUser, 'x');

    expect(mockProviderConfigService.getByIdentifier).toHaveBeenCalledWith('x');
    expect(mockProviderConfigService.delete).toHaveBeenCalledWith('x');
    expect(mockProviderConfigManager.refreshCache).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true });
  });

  it('should return already deleted when no config exists', async () => {
    mockProviderConfigService.getByIdentifier.mockResolvedValue(null);

    const result = await controller.deleteConfig(adminUser, 'x');

    expect(mockProviderConfigService.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, message: 'Already deleted' });
  });

  it('should handle Prisma P2025 error gracefully', async () => {
    const config = createDbConfig({ identifier: 'x' });
    mockProviderConfigService.getByIdentifier.mockResolvedValue(config);
    mockProviderConfigService.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record not found', {
        code: 'P2025',
        clientVersion: '6.5.0',
      }),
    );

    const result = await controller.deleteConfig(adminUser, 'x');

    expect(result).toEqual({ success: true, message: 'Already deleted' });
  });

  it('should throw non-P2025 errors', async () => {
    const config = createDbConfig({ identifier: 'x' });
    mockProviderConfigService.getByIdentifier.mockResolvedValue(config);
    const genericError = new Error('DB connection failed');
    mockProviderConfigService.delete.mockRejectedValue(genericError);

    await expect(controller.deleteConfig(adminUser, 'x')).rejects.toThrow('DB connection failed');
  });
});

// PROVIDER_REMEDIATION 0.2: the global social OAuth-app store is super-admin only.
// `channels:manage` is granted to owner/admin/EDITOR by the RBAC seeder, so a
// non-super-admin (editor/owner) must be rejected before any service call.
describe('super-admin gating (0.2)', () => {
  const forbidden = ForbiddenException;

  it('rejects listConfigs for a non-super-admin', async () => {
    await expect(controller.listConfigs(regularUser)).rejects.toThrow(forbidden);
    expect(mockProviderConfigService.getAll).not.toHaveBeenCalled();
  });

  it('rejects getConfig for a non-super-admin', async () => {
    await expect(controller.getConfig(regularUser, 'x')).rejects.toThrow(forbidden);
    expect(mockProviderConfigService.getByIdentifier).not.toHaveBeenCalled();
  });

  it('rejects saveConfig for a non-super-admin (no global write)', async () => {
    await expect(
      controller.saveConfig(regularUser, 'x', { enabled: true, clientId: 'evil' } as any),
    ).rejects.toThrow(forbidden);
    expect(mockProviderConfigService.upsert).not.toHaveBeenCalled();
  });

  it('rejects deleteConfig for a non-super-admin', async () => {
    await expect(controller.deleteConfig(regularUser, 'x')).rejects.toThrow(forbidden);
    expect(mockProviderConfigService.delete).not.toHaveBeenCalled();
  });

  it('allows a super-admin through to the service', async () => {
    mockProviderConfigService.getProviderCatalog.mockResolvedValue([]);
    await expect(controller.listConfigs(adminUser)).resolves.toBeDefined();
    expect(mockProviderConfigService.getProviderCatalog).toHaveBeenCalled();
  });
});

// AUTH-03: guard ordering invariant for the platform-global `/admin/channel-configs`
// routes. SuperAdminGuard must run first so that non-super-admins are rejected before
// OrgRbacGuard attempts org resolution.
describe('guard ordering invariant', () => {
  it('lists SuperAdminGuard before OrgRbacGuard on the controller', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      ChannelConfigController,
    ) as Array<new (...args: any[]) => any>;

    expect(guards).toBeDefined();
    expect(guards.length).toBeGreaterThanOrEqual(2);

    const first = guards[0].name;
    const second = guards[1].name;
    expect(first).toBe(SuperAdminGuard.name);
    expect(second).toBe(OrgRbacGuard.name);
  });

  it('SuperAdminGuard allows a super-admin request that carries no org cookie', () => {
    const guard = new SuperAdminGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'super-u', isSuperAdmin: true } }),
      }),
    } as any;
    expect(guard.canActivate(context)).toBe(true);
  });

  it('SuperAdminGuard rejects a non-super-admin before OrgRbacGuard would run', () => {
    const guard = new SuperAdminGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { id: 'regular-u', isSuperAdmin: false } }),
      }),
    } as any;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('OrgRbacGuard short-circuits for a super-admin without org context', async () => {
    const reflector = { getAllAndOverride: vi.fn(() => ({ resource: 'channels', action: 'manage' })) } as any;
    const rolesService = { getEffectivePermissions: vi.fn() } as any;
    const audit = { record: vi.fn() } as any;
    const guard = new OrgRbacGuard(reflector, rolesService, audit);

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'super-u', isSuperAdmin: true },
          // deliberately absent org / orgId
        }),
      }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(rolesService.getEffectivePermissions).not.toHaveBeenCalled();
  });
});
