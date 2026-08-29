import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearCredentials } from './credentials';

const mockOrgProviderConfigService = {
  getDecryptedConfigs: vi.fn(),
};

vi.mock(
  '@postmill-ai/nestjs-libraries/database/prisma/provider-configs/org-provider-config.service',
  () => ({
    OrgProviderConfigService: vi.fn(() => mockOrgProviderConfigService),
  })
);

import { OrgProviderConfigManager } from './org-provider-config.manager';

// Mirrors DecryptedOrgProviderConfig after OrgProviderConfigService decryption —
// additionalConfig arrives as a plaintext JSON string (whole-blob decrypt).
function makeConfig(overrides: Record<string, any> = {}) {
  return {
    id: 'cfg-1',
    organizationId: 'org-1',
    identifier: 'facebook',
    name: 'Facebook App',
    version: 'v1',
    enabled: true,
    clientId: 'app-123',
    clientSecret: 'secret',
    additionalConfig: undefined,
    redirectUri: undefined,
    scopes: undefined,
    setupNotes: undefined,
    vpnSelection: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('OrgProviderConfigManager', () => {
  let manager: OrgProviderConfigManager;

  beforeEach(() => {
    vi.clearAllMocks();
    clearCredentials();
    mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([]);
    manager = new OrgProviderConfigManager(mockOrgProviderConfigService as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getClientInfo', () => {
    it('returns the classic client info shape when additionalConfig is absent', async () => {
      mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
        makeConfig(),
      ]);

      const info = await manager.getClientInfo('org-1', 'facebook');
      expect(info).toEqual({
        client_id: 'app-123',
        client_secret: 'secret',
        instanceUrl: '',
      });
    });

    it('populates configId from additionalConfig.configId (FBfB)', async () => {
      mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
        makeConfig({
          additionalConfig: JSON.stringify({ configId: 'fb-config-789' }),
        }),
      ]);

      const info = await manager.getClientInfo('org-1', 'facebook');
      expect(info).toEqual({
        client_id: 'app-123',
        client_secret: 'secret',
        instanceUrl: '',
        configId: 'fb-config-789',
      });
    });

    it('keeps botToken parsing working alongside configId', async () => {
      mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
        makeConfig({
          identifier: 'discord',
          additionalConfig: JSON.stringify({
            botToken: 'bot-token-1',
            configId: 'fb-config-789',
          }),
        }),
      ]);

      const info = await manager.getClientInfo('org-1', 'discord');
      expect(info?.token).toBe('bot-token-1');
      expect(info?.configId).toBe('fb-config-789');
    });

    it('tolerates invalid additionalConfig JSON', async () => {
      mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
        makeConfig({ additionalConfig: 'not-valid-json' }),
      ]);

      const info = await manager.getClientInfo('org-1', 'facebook');
      expect(info).toEqual({
        client_id: 'app-123',
        client_secret: 'secret',
        instanceUrl: '',
      });
    });

    it('returns undefined for a disabled config', async () => {
      mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
        makeConfig({ enabled: false }),
      ]);

      expect(await manager.getClientInfo('org-1', 'facebook')).toBeUndefined();
    });
  });

  describe('getClientInfoById', () => {
    it('populates configId for a named config (even when disabled)', async () => {
      mockOrgProviderConfigService.getDecryptedConfigs.mockResolvedValue([
        makeConfig({
          id: 'cfg-9',
          enabled: false,
          additionalConfig: JSON.stringify({ configId: 'fb-config-789' }),
        }),
      ]);

      const info = await manager.getClientInfoById('org-1', 'cfg-9');
      expect(info?.configId).toBe('fb-config-789');
      expect(info?.client_id).toBe('app-123');
    });
  });
});
