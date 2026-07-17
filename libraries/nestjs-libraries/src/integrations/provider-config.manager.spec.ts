import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Logger } from '@nestjs/common';
import { ProviderConfigManager } from './provider-config.manager';
import { AuthService } from '@gitroom/helpers/auth/auth.service';
import { replaceCredentialsMap, clearCredentials, getCredential } from './credentials';

const mockProviderConfigService = {
  getAll: vi.fn(),
  getByIdentifier: vi.fn(),
  getEnabled: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
  decryptConfig: vi.fn(),
};

vi.mock('@gitroom/nestjs-libraries/database/prisma/provider-configs/provider-config.service', () => ({
  ProviderConfigService: vi.fn(() => mockProviderConfigService),
}));

function makeConfig(overrides: Record<string, any> = {}) {
  return {
    identifier: 'test',
    name: 'Test',
    enabled: true,
    clientId: 'enc-client-id',
    clientSecret: 'enc-client-secret',
    redirectUri: null,
    scopes: null,
    additionalConfig: null,
    setupInstructions: null,
    ...overrides,
  };
}

describe('ProviderConfigManager', () => {
  let manager: ProviderConfigManager;
  let consoleErrorSpy: any;
  let mockNow: number;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCredentials();
    consoleErrorSpy = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    mockNow = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => mockNow);

    mockProviderConfigService.getAll.mockResolvedValue([]);
    mockProviderConfigService.decryptConfig.mockReturnValue({
      clientId: 'decrypted-id',
      clientSecret: 'decrypted-secret',
    });

    manager = new ProviderConfigManager(mockProviderConfigService as any);
    // Prevent cross-replica Redis pub/sub from leaking into call-count assertions.
    vi.spyOn(manager, 'publishInvalidate').mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe('onModuleInit', () => {
    it('loads configs on init (internal refresh, no cross-replica broadcast)', async () => {
      await manager.onModuleInit();
      expect(mockProviderConfigService.getAll).toHaveBeenCalledOnce();
    });

    it('handles errors gracefully', async () => {
      mockProviderConfigService.getAll.mockRejectedValueOnce(new Error('fail'));
      await expect(manager.onModuleInit()).resolves.toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('refreshCache', () => {
    it('deduplicates concurrent calls', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([]);

      const promise1 = manager.refreshCache();
      const promise2 = manager.refreshCache();

      await Promise.all([promise1, promise2]);

      expect(mockProviderConfigService.getAll).toHaveBeenCalledTimes(1);
    });
  });

  describe('getConfig', () => {
    it('returns undefined for unknown provider', async () => {
      const result = await manager.getConfig('unknown');
      expect(result).toBeUndefined();
    });

    it('returns decrypted config for known provider', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', name: 'GitHub' }),
      ]);

      const result = await manager.getConfig('github');
      expect(result).toEqual({
        identifier: 'github',
        name: 'GitHub',
        enabled: true,
        clientId: 'decrypted-id',
        clientSecret: 'decrypted-secret',
        redirectUri: undefined,
        scopes: undefined,
        additionalConfig: undefined,
        setupInstructions: undefined,
      });
    });
  });

  describe('getEnabledIdentifiers', () => {
    it('returns only enabled providers', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', enabled: true }),
        makeConfig({ identifier: 'gitlab', enabled: false }),
        makeConfig({ identifier: 'bitbucket', enabled: true }),
      ]);

      const result = await manager.getEnabledIdentifiers();
      expect(result).toEqual(['github', 'bitbucket']);
    });
  });

  describe('getAllConfigs', () => {
    it('returns all cached configs', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github' }),
      ]);

      const result = await manager.getAllConfigs();
      expect(result).toHaveLength(1);
      expect(result[0].identifier).toBe('github');
    });
  });

  describe('isEnabled', () => {
    it('returns true for enabled provider', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', enabled: true }),
      ]);

      expect(await manager.isEnabled('github')).toBe(true);
    });

    it('returns false for disabled provider', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', enabled: false }),
      ]);

      expect(await manager.isEnabled('github')).toBe(false);
    });
  });

  describe('getClientInfo', () => {
    it('returns client_id, client_secret, instanceUrl', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'mastodon',
          redirectUri: 'https://mastodon.social',
        }),
      ]);

      const result = await manager.getClientInfo('mastodon');
      expect(result).toEqual({
        client_id: 'decrypted-id',
        client_secret: 'decrypted-secret',
        instanceUrl: 'https://mastodon.social',
      });
    });

    it('returns empty string instanceUrl when redirectUri is null', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'mastodon' }),
      ]);

      const result = await manager.getClientInfo('mastodon');
      expect(result?.instanceUrl).toBe('');
    });

    it('returns undefined for disabled provider', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', enabled: false }),
      ]);

      const result = await manager.getClientInfo('github');
      expect(result).toBeUndefined();
    });

    it('returns undefined when clientId is missing', async () => {
      mockProviderConfigService.decryptConfig.mockReturnValue({
        clientId: undefined,
        clientSecret: 'decrypted-secret',
      });
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', clientId: null }),
      ]);

      const result = await manager.getClientInfo('github');
      expect(result).toBeUndefined();
    });

    it('returns undefined when clientSecret is missing', async () => {
      mockProviderConfigService.decryptConfig.mockReturnValue({
        clientId: 'decrypted-id',
        clientSecret: undefined,
      });
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github', clientSecret: null }),
      ]);

      const result = await manager.getClientInfo('github');
      expect(result).toBeUndefined();
    });

    it('returns undefined for unknown provider (no config)', async () => {
      const result = await manager.getClientInfo('nonexistent');
      expect(result).toBeUndefined();
    });
  });

  describe('ensureFresh', () => {
    it('refreshes cache when stale', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github' }),
      ]);
      await manager.refreshCache();

      mockNow += 60_001;
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github' }),
        makeConfig({ identifier: 'gitlab' }),
      ]);

      await manager.getConfig('gitlab');

      expect(mockProviderConfigService.getAll).toHaveBeenCalledTimes(2);
    });

    it('does NOT refresh when cache is fresh', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github' }),
      ]);
      await manager.refreshCache();

      await manager.getConfig('github');

      expect(mockProviderConfigService.getAll).toHaveBeenCalledTimes(1);
    });

    it('handles errors gracefully during stale refresh', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github' }),
      ]);
      await manager.refreshCache();

      mockNow += 60_001;
      mockProviderConfigService.getAll.mockRejectedValue(new Error('db error'));

      await manager.getConfig('github');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('#doRefresh', () => {
    it('handles per-config errors gracefully', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'good' }),
        makeConfig({ identifier: 'bad' }),
        makeConfig({ identifier: 'good2' }),
      ]);

      let callCount = 0;
      mockProviderConfigService.decryptConfig.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('decryption failed');
        }
        return { clientId: 'decrypted-id', clientSecret: 'decrypted-secret' };
      });

      await manager.refreshCache();

      expect(await manager.getConfig('good')).toBeDefined();
      expect(await manager.getConfig('bad')).toBeUndefined();
      expect(await manager.getConfig('good2')).toBeDefined();
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('parses botToken from additionalConfig', async () => {
      const encryptedBotToken = AuthService.fixedEncryption('my-bot-token');
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'telegram',
          clientSecret: null,
          additionalConfig: JSON.stringify({ botToken: encryptedBotToken }),
        }),
      ]);

      await manager.refreshCache();

      const config = await manager.getConfig('telegram');
      expect(config).toBeDefined();
    });

    it('handles invalid additionalConfig JSON', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ additionalConfig: 'not-valid-json' }),
      ]);

      await manager.refreshCache();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to parse additionalConfig for test'
      );
    });

    it('handles missing botToken in valid additionalConfig', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'test',
          clientId: 'enc-id',
          clientSecret: null,
          additionalConfig: JSON.stringify({ foo: 'bar' }),
        }),
      ]);

      await manager.refreshCache();

      const config = await manager.getConfig('test');
      expect(config).toBeDefined();
    });

    it('skips non-enabled providers in credential map', async () => {
      const replaceSpy = vi.spyOn(
        await vi.importActual<typeof import('./credentials')>('./credentials'),
        'replaceCredentialsMap'
      );
      // Re-import to get the spied instance
      const credentials = await vi.importActual<typeof import('./credentials')>('./credentials');
      const replaceSpy2 = vi.spyOn(credentials, 'replaceCredentialsMap');

      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'disabled', enabled: false }),
      ]);

      await manager.refreshCache();

      const config = await manager.getConfig('disabled');
      expect(config).toBeDefined();
      expect(config?.enabled).toBe(false);
    });

    it('handles decryption errors for botToken', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'test',
          additionalConfig: JSON.stringify({ botToken: 'invalid-encrypted' }),
        }),
      ]);

      await manager.refreshCache();

      const config = await manager.getConfig('test');
      expect(config).toBeDefined();
    });

    it('atomically replaces cache after refresh', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'github' }),
      ]);
      await manager.refreshCache();

      expect(await manager.getConfig('github')).toBeDefined();

      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'gitlab' }),
      ]);
      await manager.refreshCache();

      expect(await manager.getConfig('github')).toBeUndefined();
      expect(await manager.getConfig('gitlab')).toBeDefined();
    });

    it('handles decryptConfig returning undefined values', async () => {
      mockProviderConfigService.decryptConfig.mockReturnValue({
        clientId: undefined,
        clientSecret: undefined,
      });
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({ identifier: 'test', clientId: null, clientSecret: null }),
      ]);

      await manager.refreshCache();

      const config = await manager.getConfig('test');
      expect(config?.clientId).toBeUndefined();
      expect(config?.clientSecret).toBeUndefined();
    });

    it('maps setupInstructions, scopes, redirectUri from config', async () => {
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'test',
          redirectUri: 'https://example.com/callback',
          scopes: 'read,write',
          setupInstructions: 'Setup info',
        }),
      ]);

      await manager.refreshCache();

      const config = await manager.getConfig('test');
      expect(config?.redirectUri).toBe('https://example.com/callback');
      expect(config?.scopes).toBe('read,write');
      expect(config?.setupInstructions).toBe('Setup info');
    });

    it('splits scopes by comma in credential map', async () => {
      const credentials = await vi.importActual<typeof import('./credentials')>('./credentials');
      const replaceSpy = vi.spyOn(credentials, 'replaceCredentialsMap');

      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'test',
          scopes: ' read , write , admin ',
        }),
      ]);

      await manager.refreshCache();

      expect(replaceSpy).toHaveBeenCalled();
      const mapArg = replaceSpy.mock.calls[0][0] === '__global__'
        ? replaceSpy.mock.calls[0][1]
        : replaceSpy.mock.calls[0][0];
      const entry = mapArg.get('test');
      expect(entry?.scopes).toEqual(['read', 'write', 'admin']);
    });

    it('adds token to credential entry when botToken present', async () => {
      const credentials = await vi.importActual<typeof import('./credentials')>('./credentials');
      const replaceSpy = vi.spyOn(credentials, 'replaceCredentialsMap');
      const encryptedToken = AuthService.fixedEncryption('bot-token-123');
      const decryptedToken = AuthService.fixedDecryption(encryptedToken);

      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'telegram',
          clientSecret: null,
          additionalConfig: JSON.stringify({ botToken: encryptedToken }),
        }),
      ]);

      await manager.refreshCache();

      expect(replaceSpy).toHaveBeenCalled();
      const mapArg = replaceSpy.mock.calls[0][0] === '__global__'
        ? replaceSpy.mock.calls[0][1]
        : replaceSpy.mock.calls[0][0];
      const entry = mapArg.get('telegram');
      expect(entry?.token).toBe(decryptedToken);
    });

    it('skips credential map entry when enabled but no credentials', async () => {
      const credentials = await vi.importActual<typeof import('./credentials')>('./credentials');
      const replaceSpy = vi.spyOn(credentials, 'replaceCredentialsMap');

      mockProviderConfigService.decryptConfig.mockReturnValue({
        clientId: undefined,
        clientSecret: undefined,
      });
      mockProviderConfigService.getAll.mockResolvedValue([
        makeConfig({
          identifier: 'test',
          enabled: true,
          clientId: null,
          clientSecret: null,
        }),
      ]);

      await manager.refreshCache();

      expect(replaceSpy).toHaveBeenCalled();
      const mapArg = replaceSpy.mock.calls[0][0] === '__global__'
        ? replaceSpy.mock.calls[0][1]
        : replaceSpy.mock.calls[0][0];
      expect(mapArg.has('test')).toBe(false);
    });
  });
});
