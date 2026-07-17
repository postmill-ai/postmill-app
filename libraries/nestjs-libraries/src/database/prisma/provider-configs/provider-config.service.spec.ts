import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProviderConfigService } from './provider-config.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

const mockRepo = {
  getAll: vi.fn(),
  getByIdentifier: vi.fn(),
  getEnabled: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
};

const fakeProviders = [
  { identifier: 'x', name: 'X', toolTip: 'X social', scopes: ['tweet.read', 'tweet.write'] },
  { identifier: 'facebook', name: 'Facebook', toolTip: 'Facebook social', scopes: ['pages_manage_posts'] },
  { identifier: 'telegram', name: 'Telegram', toolTip: 'Telegram messenger', externalUrl: 'https://t.me', scopes: [] },
  { identifier: 'web3-test', name: 'Web3', isWeb3: true, scopes: [] },
  { identifier: 'ext-test', name: 'Extension', toolTip: 'Ext', isChromeExtension: true, customFields: true, scopes: ['ext_scope'] },
] as any[];

vi.mock('./provider-config.repository', () => ({
  ProviderConfigRepository: vi.fn(() => mockRepo),
}));

function createDbConfig(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    identifier: 'x',
    name: 'X',
    enabled: true,
    clientId: AuthService.fixedEncryption('client-id'),
    clientSecret: AuthService.fixedEncryption('client-secret'),
    redirectUri: 'https://redirect.com',
    scopes: 'custom_scope',
    setupInstructions: 'Setup steps',
    additionalConfig: null,
    ...overrides,
  };
}

describe('ProviderConfigService', () => {
  let service: ProviderConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProviderConfigService(mockRepo as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAll', () => {
    it('delegates to repository', () => {
      const expected = [{ identifier: 'test' }];
      mockRepo.getAll.mockReturnValue(expected);
      expect(service.getAll()).toBe(expected);
      expect(mockRepo.getAll).toHaveBeenCalledOnce();
    });
  });

  describe('getByIdentifier', () => {
    it('delegates to repository', () => {
      const expected = { identifier: 'test1', name: 'Test' };
      mockRepo.getByIdentifier.mockReturnValue(expected);
      expect(service.getByIdentifier('test1')).toBe(expected);
      expect(mockRepo.getByIdentifier).toHaveBeenCalledWith('test1');
    });
  });

  describe('getEnabled', () => {
    it('delegates to repository', () => {
      const expected = [{ identifier: 'test', enabled: true }];
      mockRepo.getEnabled.mockReturnValue(expected);
      expect(service.getEnabled()).toBe(expected);
      expect(mockRepo.getEnabled).toHaveBeenCalledOnce();
    });
  });

  describe('delete', () => {
    it('delegates to repository', () => {
      const expected = { identifier: 'test' };
      mockRepo.delete.mockReturnValue(expected);
      expect(service.delete('test')).toBe(expected);
      expect(mockRepo.delete).toHaveBeenCalledWith('test');
    });
  });

  describe('upsert', () => {
    beforeEach(() => {
      mockRepo.upsert.mockResolvedValue({ identifier: 'test' });
    });

    it('encrypts clientId and clientSecret when truthy', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientId: 'my-id',
        clientSecret: 'my-secret',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(2);
      expect(encryptSpy).toHaveBeenCalledWith('my-id');
      expect(encryptSpy).toHaveBeenCalledWith('my-secret');
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({
          clientId: expect.stringMatching(/^v2:/),
          clientSecret: expect.stringMatching(/^v2:/),
        })
      );
    });

    it('stores null when clientId is null', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientId: null as any,
        clientSecret: 'my-secret',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('my-secret');
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ clientId: null })
      );
    });

    it('stores null when clientId is empty string', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientId: '',
        clientSecret: 'my-secret',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ clientId: null })
      );
    });

    it('skips clientId when undefined (not in data)', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientSecret: 'my-secret',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('my-secret');
    });

    it('stores null when clientSecret is null', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientId: 'my-id',
        clientSecret: null as any,
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('my-id');
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ clientSecret: null })
      );
    });

    it('stores null when clientSecret is empty string', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientId: 'my-id',
        clientSecret: '',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('my-id');
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ clientSecret: null })
      );
    });

    it('skips clientSecret when undefined (not in data)', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientId: 'my-id',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('my-id');
    });

    it('handles mixed: undefined clientId, null clientSecret, truthy clientId+secret', async () => {
      const encryptSpy = vi.spyOn(AuthService, 'fixedEncryption');

      await service.upsert('test', {
        name: 'Test',
        enabled: true,
        clientSecret: 'secret-1',
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('secret-1');
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test',
        expect.not.objectContaining({ clientId: expect.anything() })
      );

      encryptSpy.mockClear();
      mockRepo.upsert.mockClear();

      await service.upsert('test2', {
        name: 'Test2',
        enabled: true,
        clientId: 'id-2',
        clientSecret: null as any,
      });

      expect(encryptSpy).toHaveBeenCalledTimes(1);
      expect(encryptSpy).toHaveBeenCalledWith('id-2');
      expect(mockRepo.upsert).toHaveBeenCalledWith(
        'test2',
        expect.objectContaining({ clientSecret: null })
      );
    });
  });

  describe('decryptConfig', () => {
    it('decrypts both clientId and clientSecret when truthy', () => {
      const encryptedId = AuthService.fixedEncryption('secret-id');
      const encryptedSecret = AuthService.fixedEncryption('secret-secret');
      const config = {
        clientId: encryptedId,
        clientSecret: encryptedSecret,
      } as any;

      const result = service.decryptConfig(config);

      expect(result).toEqual({
        clientId: 'secret-id',
        clientSecret: 'secret-secret',
      });
    });

    it('returns undefined for clientSecret when only clientId is set', () => {
      const encryptedId = AuthService.fixedEncryption('my-id');
      const config = {
        clientId: encryptedId,
        clientSecret: null,
      } as any;

      const result = service.decryptConfig(config);

      expect(result.clientId).toBe('my-id');
      expect(result.clientSecret).toBeUndefined();
    });

    it('returns undefined for clientId when only clientSecret is set', () => {
      const encryptedSecret = AuthService.fixedEncryption('my-secret');
      const config = {
        clientId: null,
        clientSecret: encryptedSecret,
      } as any;

      const result = service.decryptConfig(config);

      expect(result.clientId).toBeUndefined();
      expect(result.clientSecret).toBe('my-secret');
    });

    it('returns undefined for both when both are null', () => {
      const config = {
        clientId: null,
        clientSecret: null,
      } as any;

      const result = service.decryptConfig(config);

      expect(result.clientId).toBeUndefined();
      expect(result.clientSecret).toBeUndefined();
    });

    it('returns undefined for clientId when clientId is empty string', () => {
      const encryptedSecret = AuthService.fixedEncryption('my-secret');
      const config = {
        clientId: '',
        clientSecret: encryptedSecret,
      } as any;

      const result = service.decryptConfig(config);

      expect(result.clientId).toBeUndefined();
      expect(result.clientSecret).toBe('my-secret');
    });
  });

  describe('getProviderCatalog', () => {
    it('assembles catalog entries for every social provider merged with DB config', async () => {
      const dbConfigs = [
        createDbConfig({ identifier: 'x', enabled: true, scopes: null, setupInstructions: 'Setup X' }),
        createDbConfig({ identifier: 'facebook', enabled: false, clientId: AuthService.fixedEncryption('fb-id'), clientSecret: undefined, scopes: null }),
      ];
      mockRepo.getAll.mockResolvedValue(dbConfigs);

      const result = await service.getProviderCatalog(fakeProviders);

      expect(mockRepo.getAll).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(fakeProviders.length);

      const xConfig = result.find((r: any) => r.identifier === 'x');
      expect(xConfig).toMatchObject({
        identifier: 'x',
        name: 'X',
        description: 'X social',
        enabled: true,
        isConfigured: true,
        setupInstructions: 'Setup X',
        isExternal: false,
        isWeb3: false,
        isChromeExtension: false,
        customFields: false,
        scopes: 'tweet.read, tweet.write',
      });

      const fbConfig = result.find((r: any) => r.identifier === 'facebook');
      expect(fbConfig).toMatchObject({
        identifier: 'facebook',
        enabled: false,
        isConfigured: true,
        scopes: 'pages_manage_posts',
      });

      const tgConfig = result.find((r: any) => r.identifier === 'telegram');
      expect(tgConfig).toMatchObject({
        identifier: 'telegram',
        enabled: false,
        isConfigured: false,
        isExternal: true,
        scopes: '',
      });

      const web3Config = result.find((r: any) => r.identifier === 'web3-test');
      expect(web3Config).toMatchObject({ isWeb3: true });

      const extConfig = result.find((r: any) => r.identifier === 'ext-test');
      expect(extConfig).toMatchObject({ isChromeExtension: true, customFields: true, scopes: 'ext_scope' });
    });

    it('marks isConfigured false when decrypt returns no credentials', async () => {
      mockRepo.getAll.mockResolvedValue([
        createDbConfig({ identifier: 'x', clientId: null, clientSecret: null }),
      ]);

      const result = await service.getProviderCatalog(fakeProviders);
      const xConfig = result.find((r: any) => r.identifier === 'x');

      expect(xConfig?.isConfigured).toBe(false);
    });

    it('handles decrypt failure gracefully per-provider', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockRepo.getAll.mockResolvedValue([
        createDbConfig({ identifier: 'x', clientId: 'enc-id', clientSecret: 'enc-secret' }),
        createDbConfig({ identifier: 'facebook', clientId: 'fb-id', clientSecret: 'fb-secret' }),
      ]);
      vi.spyOn(service as any, 'decryptConfig').mockImplementation((config: any) => {
        if (config.identifier === 'x') {
          throw new Error('decrypt failed');
        }
        return { clientId: 'decrypted-fb', clientSecret: 'decrypted-fb-secret' };
      });

      const result = await service.getProviderCatalog(fakeProviders);

      const xConfig = result.find((r: any) => r.identifier === 'x');
      expect(xConfig?.isConfigured).toBe(false);

      const fbConfig = result.find((r: any) => r.identifier === 'facebook');
      expect(fbConfig?.isConfigured).toBe(true);

      consoleWarnSpy.mockRestore();
    });

    it('handles empty DB configs gracefully', async () => {
      mockRepo.getAll.mockResolvedValue([]);

      const result = await service.getProviderCatalog(fakeProviders);

      for (const item of result) {
        expect(item.enabled).toBe(false);
        expect(item.isConfigured).toBe(false);
        expect(item.setupInstructions).toBe('');
      }
    });

    it('falls back to empty description when provider has no toolTip', async () => {
      mockRepo.getAll.mockResolvedValue([]);
      const result = await service.getProviderCatalog(fakeProviders);
      const web3 = result.find((r: any) => r.identifier === 'web3-test');
      expect(web3?.description).toBe('');
    });
  });

  describe('getProviderCatalogEntry', () => {
    it('returns entry for an existing provider', async () => {
      const config = createDbConfig({ scopes: 'custom_scope' });
      mockRepo.getByIdentifier.mockResolvedValue(config);

      const result = await service.getProviderCatalogEntry('x', fakeProviders);

      expect(mockRepo.getByIdentifier).toHaveBeenCalledWith('x');
      expect(result).toMatchObject({
        identifier: 'x',
        name: 'X',
        enabled: true,
        redirectUri: 'https://redirect.com',
        scopes: 'custom_scope',
        setupInstructions: 'Setup steps',
        isConfigured: true,
        isExternal: false,
        isWeb3: false,
        isChromeExtension: false,
        customFields: false,
      });
    });

    it('uses provider scopes when DB config has no scopes', async () => {
      const config = createDbConfig({ scopes: null });
      mockRepo.getByIdentifier.mockResolvedValue(config);

      const result = await service.getProviderCatalogEntry('x', fakeProviders);

      expect(result.scopes).toBe('tweet.read, tweet.write');
    });

    it('falls back to identifier as name when provider not in list', async () => {
      const config = createDbConfig({ identifier: 'unknown-provider', scopes: null });
      mockRepo.getByIdentifier.mockResolvedValue(config);

      const result = await service.getProviderCatalogEntry('unknown-provider', fakeProviders);

      expect(result.name).toBe('unknown-provider');
      expect(result.scopes).toBe('');
    });

    it('returns isConfigured false when no config exists', async () => {
      mockRepo.getByIdentifier.mockResolvedValue(null);

      const result = await service.getProviderCatalogEntry('x', fakeProviders);

      expect(result.isConfigured).toBe(false);
      expect(result.enabled).toBe(false);
      expect(result.redirectUri).toBe('');
      expect(result.name).toBe('X');
      expect(result.scopes).toBe('tweet.read, tweet.write');
    });

    it('returns isConfigured false when decrypt returns empty', async () => {
      const config = createDbConfig({ clientId: 'enc-id', clientSecret: 'enc-secret' });
      mockRepo.getByIdentifier.mockResolvedValue(config);
      vi.spyOn(service as any, 'decryptConfig').mockReturnValue({ clientId: undefined, clientSecret: undefined });

      const result = await service.getProviderCatalogEntry('x', fakeProviders);

      expect(result.isConfigured).toBe(false);
    });

    it('returns isConfigured true when only clientId is present', async () => {
      const config = createDbConfig({ clientId: 'enc-id', clientSecret: null });
      mockRepo.getByIdentifier.mockResolvedValue(config);
      vi.spyOn(service as any, 'decryptConfig').mockReturnValue({ clientId: 'decrypted-id', clientSecret: undefined });

      const result = await service.getProviderCatalogEntry('x', fakeProviders);

      expect(result.isConfigured).toBe(true);
    });
  });
});
