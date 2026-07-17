import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  // AIProviderConfig
  getProviderConfigs: vi.fn(),
  listProviderConfigs: vi.fn(),
  getProviderConfigByIdentifier: vi.fn(),
  upsertProviderConfig: vi.fn(),
  deleteProviderConfig: vi.fn(),
  getEnabledProviderConfigs: vi.fn(),
  // AISystemSettings
  getSystemSettings: vi.fn(),
  upsertSystemSettings: vi.fn(),
  // AISpendLog
  createSpendLog: vi.fn(),
  getSpendSummary: vi.fn(),
  // AISettingsAudit
  getAuditLogs: vi.fn(),
  createAuditLog: vi.fn(),
  // AIOrgProviderConfig
  getOrgProviderConfigs: vi.fn(),
  getOrgProviderConfig: vi.fn(),
  upsertOrgProviderConfig: vi.fn(),
  deleteOrgProviderConfig: vi.fn(),
  // AIBrandProfile
  getBrandProfile: vi.fn(),
  upsertBrandProfile: vi.fn(),
  // AIPromptTemplate
  getPromptTemplates: vi.fn(),
  upsertPromptTemplate: vi.fn(),
  deletePromptTemplate: vi.fn(),
  // AIMediaJob
  createMediaJob: vi.fn(),
  updateMediaJob: vi.fn(),
  getMediaJobs: vi.fn(),
  getMediaJobStatusCounts: vi.fn(),
  getMediaJobById: vi.fn(),
  getMediaJobByIdUnscoped: vi.fn(),
  claimMediaJobStatus: vi.fn(),
  // AIPromptLibraryItem
  getPromptLibraryItems: vi.fn(),
  createPromptLibraryItem: vi.fn(),
  deletePromptLibraryItem: vi.fn(),
  // AIContentIndex
  upsertContentIndex: vi.fn(),
};

const mockKernel = {
  listManifests: vi.fn(),
  versions: vi.fn(),
  latestActive: vi.fn(),
};

const mockResolution = {
  resolveAI: vi.fn(),
};

vi.mock('./ai-settings.repository', () => ({
  AiSettingsRepository: vi.fn(() => mockRepo),
}));

vi.mock('@gitroom/helpers/auth/auth.service', () => ({
  AuthService: {
    fixedEncryption: vi.fn((value: string) => `ENC:${value}`),
    fixedDecryption: vi.fn((hash: string) => hash.replace('ENC:', '')),
  },
}));

// 3.9: per-org rows encrypt via EncryptionService (AES-GCM), NOT AuthService.fixedEncryption.
const mockEncryption = {
  encrypt: vi.fn((value: string) => `AESGCM:${value}`),
  decrypt: vi.fn((hash: string) => hash.replace('AESGCM:', '')),
};

import { AiSettingsService } from './ai-settings.service';
import { AuthService } from '@gitroom/helpers/auth/auth.service';

describe('AiSettingsService', () => {
  let service: AiSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AiSettingsService(
      mockRepo as any,
      mockEncryption as any,
      mockKernel as any,
      mockResolution as any,
    );
  });

  // ── AIProviderConfig ──

  describe('getProviderConfigs', () => {
    it('delegates to repository', () => {
      const configs = [{ identifier: 'openai' }];
      mockRepo.getProviderConfigs.mockReturnValue(configs);

      expect(service.getProviderConfigs()).toBe(configs);
      expect(mockRepo.getProviderConfigs).toHaveBeenCalledOnce();
    });
  });

  describe('listProviderConfigs', () => {
    it('delegates to repository', () => {
      const configs = [{ id: '1', identifier: 'openai' }];
      mockRepo.listProviderConfigs.mockReturnValue(configs);

      expect(service.listProviderConfigs()).toBe(configs);
      expect(mockRepo.listProviderConfigs).toHaveBeenCalledOnce();
    });
  });

  describe('getProviderConfigByIdentifier', () => {
    it('delegates to repository', () => {
      const config = { identifier: 'openai' };
      mockRepo.getProviderConfigByIdentifier.mockReturnValue(config);

      expect(service.getProviderConfigByIdentifier('openai')).toBe(config);
      expect(mockRepo.getProviderConfigByIdentifier).toHaveBeenCalledWith('openai');
    });
  });

  describe('upsertProviderConfig', () => {
    it('encrypts credentials before storage', async () => {
      const data = {
        credentials: { apiKey: 'sk-secret', baseUrl: 'https://api.openai.com' },
        defaultModel: 'gpt-4',
      };
      const encryptedCreds = AuthService.fixedEncryption(JSON.stringify(data.credentials));
      const upserted = { identifier: 'openai', credentials: encryptedCreds };
      mockRepo.upsertProviderConfig.mockResolvedValue(upserted);

      const result = await service.upsertProviderConfig('openai', data);

      expect(AuthService.fixedEncryption).toHaveBeenCalledWith(JSON.stringify(data.credentials));
      expect(mockRepo.upsertProviderConfig).toHaveBeenCalledWith('openai', {
        ...data,
        credentials: encryptedCreds,
        extraConfig: undefined,
      });
      expect(result).toEqual(upserted);
    });

    it('skips encryption when credentials is undefined', async () => {
      const data = { defaultModel: 'gpt-4' };
      mockRepo.upsertProviderConfig.mockResolvedValue({ identifier: 'openai', ...data });

      await service.upsertProviderConfig('openai', data);

      expect(mockRepo.upsertProviderConfig).toHaveBeenCalledWith('openai', {
        ...data,
        credentials: undefined,
        extraConfig: undefined,
      });
      expect(AuthService.fixedEncryption).not.toHaveBeenCalled();
    });

    it('stringifies extraConfig object', async () => {
      const data = { extraConfig: { region: 'us-west', maxTokens: 4096 } };
      const extraConfigStr = JSON.stringify(data.extraConfig);
      mockRepo.upsertProviderConfig.mockResolvedValue({ identifier: 'openai' });

      await service.upsertProviderConfig('openai', data);

      expect(mockRepo.upsertProviderConfig).toHaveBeenCalledWith('openai', {
        ...data,
        extraConfig: extraConfigStr,
        credentials: undefined,
      });
    });

    it('accepts valid JSON string for extraConfig', async () => {
      const data = {
        extraConfig: '{"region":"us-west"}' as unknown as Record<string, string>,
      };
      mockRepo.upsertProviderConfig.mockResolvedValue({ identifier: 'openai' });

      await service.upsertProviderConfig('openai', data);

      expect(mockRepo.upsertProviderConfig).toHaveBeenCalledWith('openai', {
        ...data,
        extraConfig: '{"region":"us-west"}',
        credentials: undefined,
      });
    });

    it('throws when extraConfig is an invalid JSON string', async () => {
      const data = {
        extraConfig: '{invalid json' as unknown as Record<string, string>,
      };

      await expect(
        service.upsertProviderConfig('openai', data),
      ).rejects.toThrow('extraConfig must be a valid JSON string');

      expect(mockRepo.upsertProviderConfig).not.toHaveBeenCalled();
    });
  });

  describe('decryptProviderConfig', () => {
    it('decrypts credentials JSON back to plain object', () => {
      const creds = { apiKey: 'sk-secret' };
      const encrypted = AuthService.fixedEncryption(JSON.stringify(creds));

      const result = service.decryptProviderConfig({ credentials: encrypted });

      expect(AuthService.fixedDecryption).toHaveBeenCalledWith(encrypted);
      expect(result).toEqual({ credentials: creds });
    });

    it('returns undefined credentials when input is null', () => {
      const result = service.decryptProviderConfig({ credentials: null });
      expect(result).toEqual({ credentials: undefined });
    });

    it('returns undefined credentials when input is undefined', () => {
      const result = service.decryptProviderConfig({} as any);
      expect(result).toEqual({ credentials: undefined });
    });

    it('returns undefined on decryption failure', () => {
      const result = service.decryptProviderConfig({ credentials: 'garbage' });

      // The mock stores undoes replace, so garbage stays garbage — JSON.parse fails
      // Our mock's fixedDecryption just strips ENC: prefix; for garbage without prefix
      // it returns the string as-is, and JSON.parse of garbage throws
      expect(result).toEqual({ credentials: undefined });
    });
  });

  describe('deleteProviderConfig', () => {
    it('delegates to repository', async () => {
      const deleted = { identifier: 'openai' };
      mockRepo.deleteProviderConfig.mockResolvedValue(deleted);

      const result = await service.deleteProviderConfig('openai');

      expect(mockRepo.deleteProviderConfig).toHaveBeenCalledWith('openai');
      expect(result).toEqual(deleted);
    });
  });

  describe('getEnabledProviderConfigs', () => {
    it('delegates to repository', () => {
      const configs = [{ identifier: 'openai', enabled: true }];
      mockRepo.getEnabledProviderConfigs.mockReturnValue(configs);

      expect(service.getEnabledProviderConfigs()).toBe(configs);
      expect(mockRepo.getEnabledProviderConfigs).toHaveBeenCalledOnce();
    });
  });

  // ── Provider catalog helpers (A-07) ──

  describe('getProviderVersionMeta', () => {
    it('returns the latest active manifest by default', () => {
      mockKernel.versions.mockReturnValue([
        { version: 'v1', status: 'active', credentialFields: [{ key: 'apiKey' }] },
        { version: 'v2', status: 'active', credentialFields: [{ key: 'apiKey' }] },
      ]);
      mockKernel.latestActive.mockReturnValue({
        manifest: { version: 'v2', status: 'active', credentialFields: [{ key: 'apiKey' }] },
      });

      const result = service.getProviderVersionMeta('openai');

      expect(result.version).toBe('v2');
      expect(result.availableVersions).toHaveLength(2);
    });

    it('falls back to the first manifest when no latest active is found', () => {
      mockKernel.versions.mockReturnValue([
        { version: 'v1', status: 'active', credentialFields: [{ key: 'apiKey' }] },
      ]);
      mockKernel.latestActive.mockReturnValue(undefined);

      const result = service.getProviderVersionMeta('openai');

      expect(result.version).toBe('v1');
    });
  });

  describe('isProviderConfigured', () => {
    it('returns true when all required credential fields are present', () => {
      const adapter = {
        identifier: 'bedrock',
        credentialFields: [
          { key: 'accessKeyId', required: true },
          { key: 'secretAccessKey', required: true },
          { key: 'region', required: true },
        ],
      } as any;
      const encryptedCreds = AuthService.fixedEncryption(
        JSON.stringify({
          accessKeyId: 'AKIA...',
          secretAccessKey: 'secret',
          region: 'us-east-1',
        }),
      );

      const result = service.isProviderConfigured(adapter, {
        credentials: encryptedCreds,
      });

      expect(result).toBe(true);
    });

    it('returns false when a required credential field is missing', () => {
      const adapter = {
        identifier: 'bedrock',
        credentialFields: [
          { key: 'accessKeyId', required: true },
          { key: 'secretAccessKey', required: true },
          { key: 'region', required: true },
        ],
      } as any;
      const encryptedCreds = AuthService.fixedEncryption(
        JSON.stringify({ accessKeyId: 'AKIA...', secretAccessKey: 'secret' }),
      );

      const result = service.isProviderConfigured(adapter, {
        credentials: encryptedCreds,
      });

      expect(result).toBe(false);
    });
  });

  describe('redactSensitive', () => {
    it('masks sensitive keys recursively', () => {
      const result = service.redactSensitive({
        baseURL: 'https://api.example.test/v1',
        apiKey: 'sk-leak',
        nested: { accessToken: 'tok-leak', region: 'us-east-1' },
      });

      expect(result).toEqual({
        baseURL: 'https://api.example.test/v1',
        apiKey: '[REDACTED]',
        nested: { accessToken: '[REDACTED]', region: 'us-east-1' },
      });
    });
  });

  describe('safeJson', () => {
    it('parses and redacts a JSON string', () => {
      const result = service.safeJson(JSON.stringify({ apiKey: 'sk-secret' }));
      expect(result).toEqual({ apiKey: '[REDACTED]' });
    });

    it('returns null for falsy input', () => {
      expect(service.safeJson(null)).toBeNull();
      expect(service.safeJson('')).toBeNull();
    });

    it('returns a redacted object for non-string input', () => {
      const result = service.safeJson({ apiKey: 'sk-secret' });
      expect(result).toEqual({ apiKey: '[REDACTED]' });
    });

    it('returns a placeholder for unparseable strings', () => {
      const result = service.safeJson('{invalid');
      expect(result).toBe('[REDACTED_UNPARSEABLE_CONFIG]');
    });
  });

  describe('listProviderCatalog', () => {
    it('returns mapped provider entries from the kernel', async () => {
      const adapter = {
        identifier: 'openai',
        name: 'OpenAI',
        type: 'direct',
        capabilities: { text: true },
        privacy: {},
        credentialFields: [{ key: 'apiKey', required: true }],
      } as any;
      mockKernel.listManifests.mockReturnValue([{ providerId: 'openai', version: 'v1' }]);
      mockResolution.resolveAI.mockReturnValue(adapter);
      mockRepo.getProviderConfigs.mockResolvedValue([
        {
          identifier: 'openai',
          enabled: true,
          credentials: AuthService.fixedEncryption(JSON.stringify({ apiKey: 'sk-test' })),
        },
      ]);
      mockKernel.versions.mockReturnValue([
        { version: 'v1', status: 'active', credentialFields: [{ key: 'apiKey' }] },
      ]);
      mockKernel.latestActive.mockReturnValue({
        manifest: { version: 'v1', status: 'active', credentialFields: [{ key: 'apiKey' }] },
      });

      const result = await service.listProviderCatalog();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        identifier: 'openai',
        name: 'OpenAI',
        enabled: true,
        isConfigured: true,
      });
    });
  });

  // ── AISystemSettings ──

  describe('getSystemSettings', () => {
    it('delegates to repository (raw settings)', async () => {
      const settings = { id: 'singleton', activeProvider: null };
      mockRepo.getSystemSettings.mockResolvedValue(settings);

      const result = await service.getSystemSettings();

      expect(result).toBe(settings);
      expect(mockRepo.getSystemSettings).toHaveBeenCalledOnce();
    });
  });

  describe('getDecryptedSystemSettings', () => {
    it('returns null when no settings exist', async () => {
      mockRepo.getSystemSettings.mockResolvedValue(null);

      const result = await service.getDecryptedSystemSettings();

      expect(result).toBeNull();
    });

    it('decrypts secretSettings and parses JSON fields', async () => {
      const rawSettings = {
        id: 'singleton',
        activeProvider: 'openai',
        secretSettings: AuthService.fixedEncryption(JSON.stringify({ openai_key: 'sk-abc' })),
        scopeModels: JSON.stringify({ chat: 'gpt-4' }),
        guardrailSettings: JSON.stringify({ enabled: true }),
        budgetSettings: null,
        rateLimitSettings: JSON.stringify({ rpm: 60 }),
        observability: JSON.stringify({ logLevel: 'debug' }),
        mcpSettings: JSON.stringify({ endpoint: '/mcp' }),
        ragSettings: undefined,
      };
      mockRepo.getSystemSettings.mockResolvedValue(rawSettings);

      const result = await service.getDecryptedSystemSettings();

      expect(result).toEqual({
        ...rawSettings,
        secretSettings: { openai_key: 'sk-abc' },
        scopeModels: { chat: 'gpt-4' },
        guardrailSettings: { enabled: true },
        budgetSettings: undefined,
        rateLimitSettings: { rpm: 60 },
        observability: { logLevel: 'debug' },
        mcpSettings: { endpoint: '/mcp' },
        ragSettings: undefined,
      });
    });

    it('sets secretSettings to undefined on decryption failure', async () => {
      mockRepo.getSystemSettings.mockResolvedValue({
        id: 'singleton',
        secretSettings: 'corrupted-data',
      });

      const result = await service.getDecryptedSystemSettings();

      expect(result!.secretSettings).toBeUndefined();
    });

    it('handles empty string JSON fields gracefully', async () => {
      mockRepo.getSystemSettings.mockResolvedValue({
        id: 'singleton',
        scopeModels: '',
      });

      const result = await service.getDecryptedSystemSettings();

      expect(result!.scopeModels).toBeUndefined();
    });
  });

  describe('upsertSystemSettings', () => {
    it('encrypts secretSettings before storage', async () => {
      const data = {
        activeProvider: 'openai',
        secretSettings: { openai_key: 'sk-abc', gemini_key: 'g-xyz' },
      };
      const encryptedSecret = AuthService.fixedEncryption(JSON.stringify(data.secretSettings));
      mockRepo.upsertSystemSettings.mockResolvedValue({ id: 'singleton', ...data });

      const result = await service.upsertSystemSettings(data);

      expect(AuthService.fixedEncryption).toHaveBeenCalledWith(JSON.stringify(data.secretSettings));
      expect(mockRepo.upsertSystemSettings).toHaveBeenCalledWith({
        ...data,
        secretSettings: encryptedSecret,
      });
      expect(result).toBeDefined();
    });

    it('stringifies JSON object fields', async () => {
      const data = {
        scopeModels: { chat: 'gpt-4' },
        guardrailSettings: { enabled: true },
      };
      mockRepo.upsertSystemSettings.mockResolvedValue({ id: 'singleton' });

      await service.upsertSystemSettings(data);

      const callArgs = mockRepo.upsertSystemSettings.mock.calls[0][0];
      expect(callArgs.scopeModels).toBe(JSON.stringify(data.scopeModels));
      expect(callArgs.guardrailSettings).toBe(JSON.stringify(data.guardrailSettings));
    });

    it('passes through valid JSON string fields', async () => {
      const data = {
        scopeModels: '{"chat":"gpt-4"}',
        budgetSettings: '{"limit":100}',
      };
      mockRepo.upsertSystemSettings.mockResolvedValue({ id: 'singleton' });

      await service.upsertSystemSettings(data);

      const callArgs = mockRepo.upsertSystemSettings.mock.calls[0][0];
      expect(callArgs.scopeModels).toBe('{"chat":"gpt-4"}');
      expect(callArgs.budgetSettings).toBe('{"limit":100}');
    });

    it('throws when a JSON field is an invalid string', async () => {
      const data = { scopeModels: '{invalid' };

      await expect(
        service.upsertSystemSettings(data),
      ).rejects.toThrow('Invalid JSON in scopeModels');

      expect(mockRepo.upsertSystemSettings).not.toHaveBeenCalled();
    });

    it('skips null JSON fields', async () => {
      const data = { scopeModels: null, activeProvider: 'openai' };
      mockRepo.upsertSystemSettings.mockResolvedValue({ id: 'singleton' });

      await service.upsertSystemSettings(data);

      const callArgs = mockRepo.upsertSystemSettings.mock.calls[0][0];
      expect(callArgs.scopeModels).toBeNull();
    });
  });

  // ── AISpendLog ──

  describe('createSpendLog', () => {
    it('delegates to repository (recordSpend)', () => {
      const data = {
        organizationId: 'org1',
        provider: 'openai',
        model: 'gpt-4',
        scope: 'chat',
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.01,
      };
      mockRepo.createSpendLog.mockReturnValue({ id: 's1' });

      service.createSpendLog(data);

      expect(mockRepo.createSpendLog).toHaveBeenCalledWith(data);
    });
  });

  describe('getSpendSummary', () => {
    it('delegates to repository', () => {
      const summary = [{ scope: 'chat', _sum: { costUsd: 0.05 } }];
      mockRepo.getSpendSummary.mockReturnValue(summary);

      const result = service.getSpendSummary('org1');

      expect(mockRepo.getSpendSummary).toHaveBeenCalledWith('org1', undefined);
      expect(result).toBe(summary);
    });
  });

  describe('getUsageSummary', () => {
    it('aggregates total/monthly/daily spend and derives remaining budget', async () => {
      mockRepo.getSpendSummary
        .mockResolvedValueOnce([{ _sum: { costUsd: 5 }, scope: 'generator' }])
        .mockResolvedValueOnce([{ _sum: { costUsd: 2 }, scope: 'generator' }])
        .mockResolvedValueOnce([{ _sum: { costUsd: 0.5 }, scope: 'generator' }]);
      mockRepo.getSystemSettings.mockResolvedValue({
        budgetSettings: JSON.stringify({ monthlyCap: 10, dailyCap: 1 }),
      });

      const result = await service.getUsageSummary('org1');

      expect(result.totalSpendUsd).toBe(5);
      expect(result.monthlySpendUsd).toBe(2);
      expect(result.dailySpendUsd).toBe(0.5);
      expect(result.budget).toEqual({
        monthlyCap: 10,
        dailyCap: 1,
        remainingMonthly: 8,
        remainingDaily: 0.5,
      });
    });

    it('returns null budget when no settings exist', async () => {
      mockRepo.getSpendSummary.mockResolvedValue([]);
      mockRepo.getSystemSettings.mockResolvedValue(null);

      const result = await service.getUsageSummary('org1');

      expect(result.budget).toBeNull();
    });
  });

  // ── AISettingsAudit ──

  describe('getAuditLogs', () => {
    it('delegates to repository with defaults', () => {
      const logs = [{ action: 'test' }];
      mockRepo.getAuditLogs.mockReturnValue(logs);

      const result = service.getAuditLogs();

      expect(mockRepo.getAuditLogs).toHaveBeenCalledWith(100, 0);
      expect(result).toBe(logs);
    });

    it('respects custom limit/offset', () => {
      service.getAuditLogs(50, 10);
      expect(mockRepo.getAuditLogs).toHaveBeenCalledWith(50, 10);
    });
  });

  describe('createAuditLog', () => {
    it('delegates to repository with no detail', () => {
      service.createAuditLog({ userId: 'u1', action: 'provider.upsert' });

      expect(mockRepo.createAuditLog).toHaveBeenCalledWith({
        userId: 'u1',
        action: 'provider.upsert',
        detail: undefined,
      });
    });

    it('redacts sensitive keys from audit detail', () => {
      const detail = JSON.stringify({
        identifier: 'openai',
        apiKey: 'sk-secret-123',
        API_KEY: 'also-secret',
        secret: 'shh',
        password: 'p@ss',
        token: 'jwt-token',
        credential: 'mycred',
        auth: 'basic',
        key: 'aes-key',
        safe: 'value',
      });

      service.createAuditLog({ userId: 'u1', action: 'provider.upsert', detail });

      const callArgs = mockRepo.createAuditLog.mock.calls[0][0];
      const stored = JSON.parse(callArgs.detail);
      expect(stored.apiKey).toBe('[REDACTED]');
      expect(stored.API_KEY).toBe('[REDACTED]');
      expect(stored.secret).toBe('[REDACTED]');
      expect(stored.password).toBe('[REDACTED]');
      expect(stored.token).toBe('[REDACTED]');
      expect(stored.credential).toBe('[REDACTED]');
      expect(stored.auth).toBe('[REDACTED]');
      expect(stored.key).toBe('[REDACTED]');
      expect(stored.safe).toBe('value');
    });

    it('recursively redacts sensitive keys in nested objects', () => {
      const detail = JSON.stringify({
        provider: 'openai',
        config: {
          apiKey: 'nested-secret',
          settings: { token: 'nested-token', safe: 'ok' },
        },
      });

      service.createAuditLog({ userId: 'u1', action: 'provider.upsert', detail });

      const callArgs = mockRepo.createAuditLog.mock.calls[0][0];
      const stored = JSON.parse(callArgs.detail);
      expect(stored.provider).toBe('openai');
      expect(stored.config.apiKey).toBe('[REDACTED]');
      expect(stored.config.settings.token).toBe('[REDACTED]');
      expect(stored.config.settings.safe).toBe('ok');
    });

    it('handles keys that start or end with sensitive words', () => {
      const detail = JSON.stringify({
        myapikey: 'exposed',       // ends with apikey
        keybase64: 'exposed',      // starts with key
      });

      service.createAuditLog({ userId: 'u1', action: 'test', detail });

      const callArgs = mockRepo.createAuditLog.mock.calls[0][0];
      const stored = JSON.parse(callArgs.detail);
      expect(stored.myapikey).toBe('[REDACTED]');
      expect(stored.keybase64).toBe('[REDACTED]');
    });

    it('does not throw when audit detail is invalid JSON', () => {
      service.createAuditLog({
        userId: 'u1',
        action: 'test',
        detail: '{invalid json',
      });

      const callArgs = mockRepo.createAuditLog.mock.calls[0][0];
      const stored = JSON.parse(callArgs.detail);
      expect(stored).toEqual({
        parseError: 'invalid_json',
        raw: '[UNPARSABLE_DETAIL_REDACTED]',
      });
    });

    it('preserves arrays while redacting nested sensitive keys', () => {
      const detail = JSON.stringify({
        changes: [
          { field: 'defaultModel', value: 'gpt-4o' },
          { field: 'apiKey', value: 'sk-secret' },
          { nested: { token: 'secret-token' } },
        ],
      });

      service.createAuditLog({ userId: 'u1', action: 'test', detail });

      const callArgs = mockRepo.createAuditLog.mock.calls[0][0];
      const stored = JSON.parse(callArgs.detail);
      expect(Array.isArray(stored.changes)).toBe(true);
      expect(stored.changes[1].value).toBe('[REDACTED]');
      expect(stored.changes[2].nested.token).toBe('[REDACTED]');
    });
  });

  // ── AIOrgProviderConfig ──

  describe('getOrgProviderConfigs', () => {
    it('delegates to repository', () => {
      const configs = [{ id: '1', organizationId: 'org1', identifier: 'openai' }];
      mockRepo.getOrgProviderConfigs.mockReturnValue(configs);

      const result = service.getOrgProviderConfigs('org1');

      expect(mockRepo.getOrgProviderConfigs).toHaveBeenCalledWith('org1');
      expect(result).toBe(configs);
    });
  });

  describe('getOrgProviderConfig', () => {
    it('delegates to repository', () => {
      const config = { organizationId: 'org1', identifier: 'openai' };
      mockRepo.getOrgProviderConfig.mockReturnValue(config);

      const result = service.getOrgProviderConfig('org1', 'openai');

      expect(mockRepo.getOrgProviderConfig).toHaveBeenCalledWith('org1', 'openai');
      expect(result).toBe(config);
    });
  });

  describe('upsertOrgProviderConfig', () => {
    it('encrypts org-row credentials via EncryptionService, not fixedEncryption (3.9)', async () => {
      const data = { credentials: { apiKey: 'sk-secret' } };
      const encrypted = mockEncryption.encrypt(JSON.stringify(data.credentials));
      vi.clearAllMocks();
      mockRepo.upsertOrgProviderConfig.mockResolvedValue({ id: '1' });

      await service.upsertOrgProviderConfig('org1', 'openai', data);

      // org rows use the same AES-GCM route the org runtime read path uses…
      expect(mockEncryption.encrypt).toHaveBeenCalledWith(JSON.stringify(data.credentials));
      // …and NOT the global-config crypto route.
      expect(AuthService.fixedEncryption).not.toHaveBeenCalled();
      expect(mockRepo.upsertOrgProviderConfig).toHaveBeenCalledWith('org1', 'openai', {
        ...data,
        credentials: encrypted,
        extraConfig: undefined,
      });
    });

    it('handles extraConfig object stringification', async () => {
      const data = { extraConfig: { region: 'eu' } };
      mockRepo.upsertOrgProviderConfig.mockResolvedValue({ id: '1' });

      await service.upsertOrgProviderConfig('org1', 'openai', data);

      expect(mockRepo.upsertOrgProviderConfig).toHaveBeenCalledWith('org1', 'openai', {
        ...data,
        extraConfig: '{"region":"eu"}',
        credentials: undefined,
      });
    });

    it('throws on invalid extraConfig string', async () => {
      await expect(
        service.upsertOrgProviderConfig('org1', 'openai', { extraConfig: 'bad' } as any),
      ).rejects.toThrow('extraConfig must be a valid JSON string');
    });
  });

  describe('deleteOrgProviderConfig', () => {
    it('delegates to repository', async () => {
      const deleted = { id: '1' };
      mockRepo.deleteOrgProviderConfig.mockResolvedValue(deleted);

      const result = await service.deleteOrgProviderConfig('org1', 'openai');

      expect(mockRepo.deleteOrgProviderConfig).toHaveBeenCalledWith('org1', 'openai');
      expect(result).toBe(deleted);
    });
  });

  // ── AIBrandProfile ──

  describe('getBrandProfile', () => {
    it('delegates to repository', () => {
      const profile = { organizationId: 'org1', instructions: 'Be concise' };
      mockRepo.getBrandProfile.mockReturnValue(profile);

      const result = service.getBrandProfile('org1');

      expect(mockRepo.getBrandProfile).toHaveBeenCalledWith('org1', undefined);
      expect(result).toBe(profile);
    });

    it('delegates to repository with brandId', () => {
      const profile = { id: 'brand-2', organizationId: 'org1', instructions: 'Be funny' };
      mockRepo.getBrandProfile.mockReturnValue(profile);

      const result = service.getBrandProfile('org1', 'brand-2');

      expect(mockRepo.getBrandProfile).toHaveBeenCalledWith('org1', 'brand-2');
      expect(result).toBe(profile);
    });
  });

  describe('upsertBrandProfile', () => {
    it('delegates valid data to repository', async () => {
      const data = { instructions: 'Be helpful', language: 'en' };
      mockRepo.upsertBrandProfile.mockReturnValue({ organizationId: 'org1', ...data });

      const result = await service.upsertBrandProfile('org1', data);

      expect(mockRepo.upsertBrandProfile).toHaveBeenCalledWith('org1', data);
      expect(result.instructions).toBe('Be helpful');
    });

    it('validates JSON columns and rejects invalid shapes', async () => {
      const data = {
        instructions: 'Be helpful',
        logoFileIds: 'not-an-array',
      };

      await expect(service.upsertBrandProfile('org1', data)).rejects.toThrow();
      expect(mockRepo.upsertBrandProfile).not.toHaveBeenCalled();
    });

    it('accepts full brand profile JSON shapes', async () => {
      const data = {
        instructions: 'Be concise',
        platformInstructions: { x: 'short' },
        languageProfiles: { en: { instructions: 'English', overrides: { x: 'tweet' } } },
        logoFileIds: ['file-1'],
        palette: [{ name: 'Primary', hex: '#2B5CD3' }],
        fontFamilies: [{ name: 'Inter', fallback: 'sans-serif' }],
        customFonts: [{ fileId: 'font-1', family: 'Custom' }],
        enforcement: { tone: 'friendly' },
        assets: [{ fileId: 'asset-1', url: 'https://example.com/a.png', caption: 'Logo' }],
      };
      mockRepo.upsertBrandProfile.mockReturnValue({ organizationId: 'org1', ...data });

      const result = await service.upsertBrandProfile('org1', data);

      expect(mockRepo.upsertBrandProfile).toHaveBeenCalledWith('org1', data);
      expect(result.platformInstructions).toEqual({ x: 'short' });
    });
  });

  // ── AIPromptTemplate ──

  describe('getPromptTemplates', () => {
    it('delegates to repository', () => {
      const templates = [{ key: 'greeting', content: 'Hello' }];
      mockRepo.getPromptTemplates.mockReturnValue(templates);

      const result = service.getPromptTemplates('org1');

      expect(mockRepo.getPromptTemplates).toHaveBeenCalledWith('org1');
      expect(result).toBe(templates);
    });
  });

  describe('upsertPromptTemplate', () => {
    it('delegates to repository', async () => {
      mockRepo.upsertPromptTemplate.mockReturnValue({ key: 'greeting', content: 'Hi' });

      const result = await service.upsertPromptTemplate('org1', 'greeting', 'Hi');

      expect(mockRepo.upsertPromptTemplate).toHaveBeenCalledWith('org1', 'greeting', 'Hi');
      expect(result.key).toBe('greeting');
    });
  });

  describe('deletePromptTemplate', () => {
    it('delegates to repository', async () => {
      mockRepo.deletePromptTemplate.mockReturnValue({ key: 'greeting' });

      const result = await service.deletePromptTemplate('org1', 'greeting');

      expect(mockRepo.deletePromptTemplate).toHaveBeenCalledWith('org1', 'greeting');
      expect(result.key).toBe('greeting');
    });
  });

  // ── AIMediaJob ──

  describe('createMediaJob', () => {
    it('delegates to repository', async () => {
      const data = {
        organizationId: 'org1',
        provider: 'openai',
        operation: 'generate_image',
      };
      mockRepo.createMediaJob.mockReturnValue({ id: 'mj1', ...data });

      const result = await service.createMediaJob(data);

      expect(mockRepo.createMediaJob).toHaveBeenCalledWith(data);
      expect(result.id).toBe('mj1');
    });
  });

  describe('updateMediaJob', () => {
    it('delegates to repository scoped by org', async () => {
      const updated = { id: 'mj1', status: 'completed' };
      mockRepo.updateMediaJob.mockReturnValue(updated);

      const result = await service.updateMediaJob('org-1', 'mj1', { status: 'completed' });

      expect(mockRepo.updateMediaJob).toHaveBeenCalledWith('org-1', 'mj1', { status: 'completed' });
      expect(result.status).toBe('completed');
    });
  });

  describe('getMediaJobs', () => {
    it('delegates to repository with default limit', () => {
      mockRepo.getMediaJobs.mockReturnValue([]);

      service.getMediaJobs('org1');

      expect(mockRepo.getMediaJobs).toHaveBeenCalledWith('org1', 50);
    });

    it('delegates to repository with custom limit', () => {
      service.getMediaJobs('org1', 20);
      expect(mockRepo.getMediaJobs).toHaveBeenCalledWith('org1', 20);
    });
  });

  // ── AIPromptLibraryItem ──

  describe('getPromptLibraryItems', () => {
    it('delegates to repository', () => {
      const items = [{ id: '1', title: 'My Prompt' }];
      mockRepo.getPromptLibraryItems.mockReturnValue(items);

      const result = service.getPromptLibraryItems('org1');

      expect(mockRepo.getPromptLibraryItems).toHaveBeenCalledWith('org1');
      expect(result).toBe(items);
    });
  });

  describe('createPromptLibraryItem', () => {
    it('delegates to repository', async () => {
      const data = { organizationId: 'org1', title: 'My Prompt', content: 'Act as...' };
      mockRepo.createPromptLibraryItem.mockReturnValue({ id: '1', ...data });

      const result = await service.createPromptLibraryItem(data);

      expect(mockRepo.createPromptLibraryItem).toHaveBeenCalledWith(data);
      expect(result.title).toBe('My Prompt');
    });
  });

  describe('deletePromptLibraryItem', () => {
    it('delegates to repository', () => {
      mockRepo.deletePromptLibraryItem.mockReturnValue(undefined);

      const result = service.deletePromptLibraryItem('li1', 'org1');

      expect(mockRepo.deletePromptLibraryItem).toHaveBeenCalledWith('li1', 'org1');
      expect(result).toBeUndefined();
    });
  });

  // ── AIContentIndex ──

  describe('upsertContentIndex', () => {
    it('delegates to repository when contentHash is valid', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'file',
        sourceId: 'doc1',
        chunkIndex: 0,
        contentHash: 'abc12345',
        chunk: 'Hello world',
      };
      mockRepo.upsertContentIndex.mockResolvedValue({ id: 'ci1', ...data });

      const result = await service.upsertContentIndex(data);

      expect(mockRepo.upsertContentIndex).toHaveBeenCalledWith(data);
      expect(result).toBeDefined();
    });

    it('throws when contentHash is less than 8 characters', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'file',
        sourceId: 'doc1',
        chunkIndex: 0,
        contentHash: 'short',
      };

      await expect(service.upsertContentIndex(data)).rejects.toThrow(
        'contentHash must be at least 8 characters',
      );

      expect(mockRepo.upsertContentIndex).not.toHaveBeenCalled();
    });

    it('throws when contentHash is not a string', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'file',
        sourceId: 'doc1',
        chunkIndex: 0,
        contentHash: 12345 as any,
      };

      await expect(service.upsertContentIndex(data)).rejects.toThrow(
        'contentHash must be at least 8 characters',
      );
    });

    it('accepts exactly 8 characters', async () => {
      const data = {
        organizationId: 'org1',
        sourceType: 'file',
        sourceId: 'doc1',
        chunkIndex: 0,
        contentHash: 'abcdefgh',
      };
      mockRepo.upsertContentIndex.mockResolvedValue({ id: 'ci1', ...data });

      const result = await service.upsertContentIndex(data);

      expect(mockRepo.upsertContentIndex).toHaveBeenCalledWith(data);
      expect(result).toBeDefined();
    });
  });

  // ── Encryption round-trip ──

  describe('encryption round-trip', () => {
    it('encrypt then decrypt returns original plaintext for provider config', () => {
      const originalCredentials = { apiKey: 'sk-test-key-123', baseUrl: 'https://api.example.com' };
      const encrypted = AuthService.fixedEncryption(JSON.stringify(originalCredentials));

      // Simulate what happens in upsertProviderConfig: encrypted is stored
      const storedConfig = { credentials: encrypted };

      // Simulate what happens in decryptProviderConfig: decrypt from storage
      const result = service.decryptProviderConfig(storedConfig);

      expect(result.credentials).toEqual(originalCredentials);
    });

    it('encrypt then decrypt returns original plaintext for system settings secretSettings', async () => {
      const secretSettings = { openai_key: 'sk-abc', admin_secret: 'supersecret' };
      const encrypted = AuthService.fixedEncryption(JSON.stringify(secretSettings));

      mockRepo.getSystemSettings.mockResolvedValue({
        id: 'singleton',
        secretSettings: encrypted,
      });

      const result = await service.getDecryptedSystemSettings();

      expect(result!.secretSettings).toEqual(secretSettings);
    });
  });

  // ── Security invariants ──

  describe('secrets never returned in list', () => {
    it('getProviderConfigs returns raw configs (credentials are encrypted at DB layer, not decrypted by service)', () => {
      const configs = [
        { identifier: 'openai', credentials: 'ENC:...', enabled: true },
      ];
      mockRepo.getProviderConfigs.mockReturnValue(configs);

      // The service does NOT decrypt these — it's a raw repository pass-through.
      // Credentials are only decrypted on-demand via decryptProviderConfig().
      const result = service.getProviderConfigs();

      expect(result[0].credentials).not.toBe('{"apiKey":"real"}');
      // They stay encrypted — only decryptProviderConfig would expose them
    });
  });

  describe('audit never contains secrets', () => {
    it('createAuditLog redacts all sensitive keys from the detail blob', () => {
      const detail = JSON.stringify({
        apiKey: 'sk-live-123',
        secret: 'super-secret',
        token: 'eyJhbGciOi...',
        password: 'pass123',
        credential: 'creds',
        auth: 'auth',
        key: 'encryption-key',
        apikey: 'another-key',
        name: 'openai',
        model: 'gpt-4',
      });

      service.createAuditLog({ userId: 'u1', action: 'provider.upsert', detail });

      const stored = JSON.parse(mockRepo.createAuditLog.mock.calls[0][0].detail);

      // All sensitive values must be redacted
      expect(stored.apiKey).toBe('[REDACTED]');
      expect(stored.secret).toBe('[REDACTED]');
      expect(stored.token).toBe('[REDACTED]');
      expect(stored.password).toBe('[REDACTED]');
      expect(stored.credential).toBe('[REDACTED]');
      expect(stored.auth).toBe('[REDACTED]');
      expect(stored.key).toBe('[REDACTED]');
      expect(stored.apikey).toBe('[REDACTED]');

      // Non-sensitive values pass through
      expect(stored.name).toBe('openai');
      expect(stored.model).toBe('gpt-4');
    });
  });

  describe('getMediaJobsWithCounts', () => {
    it('returns jobs and status counts in one call', async () => {
      mockRepo.getMediaJobs.mockResolvedValue([{ id: 'j1', provider: 'openai', status: 'pending' }]);
      mockRepo.getMediaJobStatusCounts.mockResolvedValue({ pending: 1, processing: 0, failed7d: 2 });

      const result = await service.getMediaJobsWithCounts('org-1', 20);

      expect(result.jobs).toHaveLength(1);
      expect(result.counts).toEqual({ pending: 1, processing: 0, failed7d: 2 });
      expect(mockRepo.getMediaJobs).toHaveBeenCalledWith('org-1', 20);
      expect(mockRepo.getMediaJobStatusCounts).toHaveBeenCalledWith('org-1');
    });
  });
});
