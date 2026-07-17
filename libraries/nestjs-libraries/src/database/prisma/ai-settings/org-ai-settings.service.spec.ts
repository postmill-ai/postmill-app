import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRepo = {
  upsert: vi.fn(),
  getActive: vi.fn(),
  getByOrg: vi.fn(),
  getByIdentifier: vi.fn(),
  // 1.2: _getPinnedVersion now reads version-agnostically. Delegate to
  // getByIdentifier so per-test `getByIdentifier.mockResolvedValue(...)` covers both.
  findAnyByIdentifier: vi.fn((orgId: string, id: string) =>
    mockRepo.getByIdentifier(orgId, id),
  ),
  setActive: vi.fn(),
  delete: vi.fn(),
  getBudget: vi.fn(),
  upsertBudget: vi.fn(),
};

const mockEncryption = {
  encrypt: vi.fn((v: string) => `enc:${v}`),
  decrypt: vi.fn((v: string) => v.replace(/^enc:/, '')),
};

const mockResolution = {
  resolveAI: vi.fn(),
  resolveWriteVersion: vi.fn((_domain: string, _id: string, version?: string) => version ?? 'v1'),
  latestActiveVersion: vi.fn().mockReturnValue('v1'),
  invalidate: vi.fn(),
};

const mockKernel = {
  listManifests: vi.fn(),
  latestActive: vi.fn(),
};

const mockDefaultsSeed = {
  seedUnset: vi.fn().mockResolvedValue(undefined),
};

vi.mock('./org-ai-settings.repository', () => ({
  OrgAiSettingsRepository: vi.fn(() => mockRepo),
}));

vi.mock('@gitroom/nestjs-libraries/ai/defaults/defaults-cache', () => ({
  bustDefaultsCatalogCache: vi.fn(),
}));

vi.mock('@gitroom/nestjs-libraries/ai/defaults/defaults-seed.service', () => ({
  DefaultsSeedService: vi.fn(() => mockDefaultsSeed),
}));

vi.mock('@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator', () => ({
  isSafePublicHttpsUrl: vi.fn().mockResolvedValue(true),
}));

vi.mock('@gitroom/nestjs-libraries/encryption/encryption.service', () => ({
  EncryptionService: vi.fn(() => mockEncryption),
}));

vi.mock('@gitroom/nestjs-libraries/providers/provider-resolution.service', () => ({
  ProviderResolutionService: vi.fn(() => mockResolution),
}));

vi.mock('@gitroom/nestjs-libraries/providers/providers.module', () => ({
  PROVIDER_KERNEL: 'PROVIDER_KERNEL',
}));

vi.mock('@gitroom/provider-kernel', () => ({
  ProviderKernel: vi.fn(),
  DEFAULT_VERSION: 'v1',
}));

vi.mock('@gitroom/nestjs-libraries/database/prisma/media-providers/provider-credential-link.service', () => ({
  ProviderCredentialLinkService: vi.fn(),
}));

import { OrgAiSettingsService } from './org-ai-settings.service';
import { bustDefaultsCatalogCache as mockBustCache } from '@gitroom/nestjs-libraries/ai/defaults/defaults-cache';

describe('OrgAiSettingsService.upsert auto-activation', () => {
  let service: OrgAiSettingsService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolution.resolveAI.mockReturnValue({
      identifier: 'openai',
      credentialFields: [{ key: 'apiKey', required: true }],
    });
    service = new OrgAiSettingsService(
      mockRepo as any,
      mockEncryption as any,
      mockResolution as any,
      mockKernel as any,
      mockDefaultsSeed as any,
      undefined,
    );
  });

  it('auto-activates the org first-ever LLM provider (no configs yet)', async () => {
    mockRepo.getByOrg.mockResolvedValue([]); // no provider configured before this write
    mockRepo.upsert.mockResolvedValue({ id: 'cfg-1', identifier: 'openai', version: 'v1' });
    mockRepo.getByIdentifier.mockResolvedValue({
      id: 'cfg-1',
      identifier: 'openai',
      version: 'v1',
      credentials: 'enc:{"apiKey":"sk-test"}',
    });
    mockResolution.resolveAI.mockReturnValue({
      identifier: 'openai',
      credentialFields: [{ key: 'apiKey', required: true }],
    });

    await service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk-test' } });

    expect(mockRepo.setActive).toHaveBeenCalledWith('org-1', 'openai', 'v1');
  });

  it('pins the resolveWriteVersion result and invalidates the cache on upsert (1.1/1.3a)', async () => {
    mockRepo.getByOrg.mockResolvedValue([{ id: 'cfg-1', identifier: 'openai' }]);
    mockRepo.upsert.mockResolvedValue({ id: 'cfg-1' });
    mockResolution.resolveWriteVersion.mockReturnValueOnce('v2');

    await service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk' }, version: 'v2' });

    expect(mockResolution.resolveWriteVersion).toHaveBeenCalledWith('ai', 'openai', 'v2');
    // 3rd positional arg is the payload; 4th is the validated version
    expect(mockRepo.upsert.mock.calls[0][3]).toBe('v2');
    expect(mockResolution.invalidate).toHaveBeenCalledWith('ai', 'openai', 'org-1');
  });

  it('propagates a rejected write version (deprecated/retired/unknown) from resolveWriteVersion (1.1)', async () => {
    mockResolution.resolveWriteVersion.mockImplementationOnce(() => {
      throw new Error('deprecated version rejects new writes');
    });
    await expect(
      service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk' }, version: 'v0' }),
    ).rejects.toThrow('deprecated');
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('does not auto-activate on an established org (already has a configured provider)', async () => {
    // Anti-surprise: an org with any existing config (even none active) must never have a
    // Settings-flow re-save silently flip activation on.
    mockRepo.getByOrg.mockResolvedValue([
      { id: 'cfg-1', identifier: 'openai', isActive: false },
    ]);
    mockRepo.upsert.mockResolvedValue({ id: 'cfg-1', identifier: 'openai', version: 'v1' });
    mockResolution.resolveAI.mockReturnValue({
      identifier: 'openai',
      credentialFields: [{ key: 'apiKey', required: true }],
    });

    await service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk-new' } });

    expect(mockRepo.setActive).not.toHaveBeenCalled();
  });

  it('does not steal primary when an active provider already exists', async () => {
    mockRepo.getByOrg.mockResolvedValue([
      { id: 'cfg-1', identifier: 'openai', isActive: true },
    ]);
    mockRepo.upsert.mockResolvedValue({ id: 'cfg-2', identifier: 'anthropic', version: 'v1' });

    await service.upsert('org-1', 'anthropic', { credentials: { apiKey: 'sk-test' } });

    expect(mockRepo.setActive).not.toHaveBeenCalled();
  });

  it('serializes an object extraConfig and skips encryption when no credentials', async () => {
    mockRepo.getByOrg.mockResolvedValue([{ id: 'x', identifier: 'openai' }]);
    mockRepo.upsert.mockResolvedValue({ id: 'x' });

    await service.upsert('org-1', 'openai', {
      enabled: true,
      extraConfig: { region: 'us' },
    });

    // 3rd positional arg to repo.upsert is the payload
    const payload = mockRepo.upsert.mock.calls[0][2];
    expect(payload.credentials).toBeUndefined();
    expect(payload.extraConfig).toBe(JSON.stringify({ region: 'us' }));
    expect(mockEncryption.encrypt).not.toHaveBeenCalled();
  });

  it('passes a string extraConfig through unchanged', async () => {
    mockRepo.getByOrg.mockResolvedValue([{ id: 'x', identifier: 'openai' }]);
    mockRepo.upsert.mockResolvedValue({ id: 'x' });

    await service.upsert('org-1', 'openai', { extraConfig: 'raw-string' });

    const payload = mockRepo.upsert.mock.calls[0][2];
    expect(payload.extraConfig).toBe('raw-string');
  });

  it('does not auto-activate a first provider that is missing required credentials', async () => {
    mockRepo.getByOrg.mockResolvedValue([]);
    mockRepo.upsert.mockResolvedValue({ id: 'x' });
    mockResolution.resolveAI.mockReturnValue({
      identifier: 'openai',
      credentialFields: [{ key: 'apiKey', required: true }],
    });

    // credentials present (so isFirstProvider true) but the required apiKey is blank
    await service.upsert('org-1', 'openai', { credentials: { apiKey: '   ' } });

    expect(mockRepo.setActive).not.toHaveBeenCalled();
  });

  it('swallows an auto-activation failure of the first provider', async () => {
    mockRepo.getByOrg.mockResolvedValue([]);
    mockRepo.upsert.mockResolvedValue({ id: 'x' });
    mockRepo.getByIdentifier.mockResolvedValue({
      identifier: 'openai',
      version: 'v1',
      credentials: 'enc:{"apiKey":"sk"}',
    });
    mockResolution.resolveAI.mockReturnValue({
      identifier: 'openai',
      credentialFields: [{ key: 'apiKey', required: true }],
    });
    mockRepo.setActive.mockRejectedValue(new Error('db down'));

    // Should not throw despite the setActive rejection.
    await expect(
      service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk' } }),
    ).resolves.toEqual({ id: 'x' });
  });

  it('rejects an unknown provider at upsert (A-22)', async () => {
    mockResolution.resolveAI.mockReturnValue(null);

    await expect(
      service.upsert('org-1', 'ghost', { credentials: { apiKey: 'sk' } }),
    ).rejects.toThrow('Unknown provider');
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('rejects a non-public baseURL at upsert (A-22)', async () => {
    const { isSafePublicHttpsUrl } = await import(
      '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator'
    );
    (isSafePublicHttpsUrl as any).mockResolvedValueOnce(false);

    await expect(
      service.upsert('org-1', 'openai', {
        credentials: { apiKey: 'sk', baseURL: 'http://localhost:3000' },
      }),
    ).rejects.toThrow('Base URL must be a public HTTPS URL');
    expect(mockRepo.upsert).not.toHaveBeenCalled();
  });

  it('seeds defaults and busts catalog cache after upsert (A-22)', async () => {
    mockRepo.getByOrg.mockResolvedValue([{ id: 'cfg-1', identifier: 'openai' }]);
    mockRepo.upsert.mockResolvedValue({ id: 'cfg-1' });

    await service.upsert('org-1', 'openai', { enabled: false });

    expect(mockDefaultsSeed.seedUnset).toHaveBeenCalledWith('org-1');
    expect(mockBustCache).toHaveBeenCalledWith('org-1');
  });
});

describe('OrgAiSettingsService reads/mutations', () => {
  let service: OrgAiSettingsService;

  const adapter = {
    identifier: 'openai',
    name: 'OpenAI',
    type: 'llm',
    capabilities: ['text'],
    credentialFields: [{ key: 'apiKey', required: true }],
    validateCredentials: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolution.resolveAI.mockReturnValue({
      identifier: 'openai',
      credentialFields: [{ key: 'apiKey', required: true }],
    });
    service = new OrgAiSettingsService(
      mockRepo as any,
      mockEncryption as any,
      mockResolution as any,
      mockKernel as any,
      mockDefaultsSeed as any,
      undefined,
    );
  });

  describe('getProviders', () => {
    it('maps each registered adapter, marking configured/enabled from db config', async () => {
      mockKernel.listManifests.mockReturnValue([
        { providerId: 'openai', version: 'v1' },
        { providerId: 'openai', version: 'v2' }, // duplicate providerId → deduped
      ]);
      mockResolution.resolveAI.mockReturnValue(adapter);
      mockRepo.getByOrg.mockResolvedValue([
        {
          identifier: 'openai',
          enabled: true,
          isActive: true,
          credentials: 'enc:{"apiKey":"sk-x"}',
          defaultModel: 'gpt-4',
          reasoningModel: 'o1',
          version: 'v1',
          createdAt: null,
          updatedAt: null,
        },
      ]);

      const res = await service.getProviders('org-1');
      expect(res).toHaveLength(1);
      expect(res[0]).toMatchObject({
        identifier: 'openai',
        enabled: true,
        isActive: true,
        isConfigured: true,
        defaultModel: 'gpt-4',
      });
    });

    it('defaults unset fields when there is no matching db config', async () => {
      mockKernel.listManifests.mockReturnValue([{ providerId: 'openai', version: 'v1' }]);
      mockResolution.resolveAI.mockReturnValue(adapter);
      mockRepo.getByOrg.mockResolvedValue([]);

      const res = await service.getProviders('org-1');
      expect(res[0]).toMatchObject({
        enabled: false,
        isActive: false,
        isConfigured: false,
        defaultModel: '',
        reasoningModel: '',
        version: 'v1',
        createdAt: null,
        updatedAt: null,
      });
    });

    it('skips manifests whose adapter fails to resolve', async () => {
      mockKernel.listManifests.mockReturnValue([{ providerId: 'ghost', version: 'v1' }]);
      mockResolution.resolveAI.mockImplementation(() => {
        throw new Error('unregistered');
      });
      mockRepo.getByOrg.mockResolvedValue([]);

      expect(await service.getProviders('org-1')).toHaveLength(0);
    });
  });

  describe('getActiveProvider', () => {
    it('returns null when no active config', async () => {
      mockRepo.getActive.mockResolvedValue(null);
      expect(await service.getActiveProvider('org-1')).toBeNull();
    });

    it('returns null when the active provider adapter is unknown', async () => {
      mockRepo.getActive.mockResolvedValue({ identifier: 'ghost', version: 'v1', credentials: null });
      mockResolution.resolveAI.mockImplementation(() => {
        throw new Error('unregistered');
      });
      expect(await service.getActiveProvider('org-1')).toBeNull();
    });

    it('returns the decrypted active provider', async () => {
      mockRepo.getActive.mockResolvedValue({
        identifier: 'openai',
        version: null,
        enabled: true,
        isActive: true,
        defaultModel: 'gpt-4',
        reasoningModel: 'o1',
        credentials: 'enc:{"apiKey":"sk-x"}',
      });
      mockResolution.resolveAI.mockReturnValue(adapter);

      const res = await service.getActiveProvider('org-1');
      expect(res).toMatchObject({
        identifier: 'openai',
        version: 'v1',
        name: 'OpenAI',
        credentials: { apiKey: 'sk-x' },
      });
    });
  });

  describe('getByIdentifier', () => {
    it('returns null when config missing', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue(null);
      expect(await service.getByIdentifier('org-1', 'openai')).toBeNull();
    });

    it('returns null when adapter missing', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', credentials: null });
      mockResolution.resolveAI.mockImplementation(() => {
        throw new Error('x');
      });
      expect(await service.getByIdentifier('org-1', 'openai')).toBeNull();
    });

    it('returns the decrypted config with defaulted models', async () => {
      mockRepo.getByIdentifier.mockResolvedValue({
        identifier: 'openai',
        version: 'v2',
        enabled: true,
        isActive: false,
        defaultModel: null,
        reasoningModel: null,
        credentials: 'enc:{"apiKey":"sk-x"}',
      });
      mockResolution.resolveAI.mockReturnValue(adapter);

      const res = await service.getByIdentifier('org-1', 'openai', 'v2');
      expect(res).toMatchObject({
        version: 'v2',
        defaultModel: '',
        reasoningModel: '',
        credentials: { apiKey: 'sk-x' },
      });
    });
  });

  describe('setActive', () => {
    it('throws when the provider is not configured', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue(null);
      await expect(service.setActive('org-1', 'openai')).rejects.toThrow('not configured');
    });

    it('throws when the provider adapter is unknown', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', credentials: 'enc:{}' });
      mockResolution.resolveAI.mockImplementation(() => {
        throw new Error('x');
      });
      await expect(service.setActive('org-1', 'openai')).rejects.toThrow('Unknown provider');
    });

    it('throws when required credentials are missing', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', credentials: 'enc:{}' });
      mockResolution.resolveAI.mockReturnValue(adapter);
      await expect(service.setActive('org-1', 'openai')).rejects.toThrow('not fully configured');
    });

    it('activates when fully configured', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', credentials: 'enc:{"apiKey":"sk-x"}' });
      mockResolution.resolveAI.mockReturnValue(adapter);
      mockRepo.setActive.mockResolvedValue({ ok: true });
      await service.setActive('org-1', 'openai');
      expect(mockRepo.setActive).toHaveBeenCalledWith('org-1', 'openai', 'v1');
    });

    it('seeds defaults and busts catalog cache after setActive (A-22)', async () => {
      mockKernel.latestActive.mockReturnValue({ manifest: { version: 'v1' } });
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', credentials: 'enc:{"apiKey":"sk-x"}' });
      mockResolution.resolveAI.mockReturnValue(adapter);
      mockRepo.setActive.mockResolvedValue({ ok: true });

      await service.setActive('org-1', 'openai');

      expect(mockDefaultsSeed.seedUnset).toHaveBeenCalledWith('org-1');
      expect(mockBustCache).toHaveBeenCalledWith('org-1');
    });
  });

  describe('testConnection', () => {
    it('throws when not configured', async () => {
      mockRepo.getByIdentifier.mockResolvedValue(null);
      await expect(service.testConnection('org-1', 'openai')).rejects.toThrow('not configured');
    });

    it('throws when adapter unknown', async () => {
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: null, credentials: 'enc:{}' });
      mockResolution.resolveAI.mockImplementation(() => {
        throw new Error('x');
      });
      await expect(service.testConnection('org-1', 'openai')).rejects.toThrow('Unknown provider');
    });

    it('validates credentials with the resolved adapter', async () => {
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1', credentials: 'enc:{"apiKey":"sk-x"}' });
      const validate = vi.fn().mockResolvedValue({ valid: true });
      mockResolution.resolveAI.mockReturnValue({ ...adapter, validateCredentials: validate });
      const res = await service.testConnection('org-1', 'openai');
      expect(validate).toHaveBeenCalledWith({ apiKey: 'sk-x' });
      expect(res).toEqual({ valid: true });
    });

    it('validates candidate credentials when supplied (A-22)', async () => {
      const validate = vi.fn().mockResolvedValue({ valid: true });
      mockResolution.resolveAI.mockReturnValue({ ...adapter, validateCredentials: validate });

      const res = await service.testConnection('org-1', 'openai', {
        apiKey: 'candidate',
        baseURL: 'https://api.example.com',
      });

      expect(validate).toHaveBeenCalledWith({
        apiKey: 'candidate',
        baseURL: 'https://api.example.com',
      });
      expect(res).toEqual({ valid: true });
    });
  });

  describe('delete + budget pass-throughs', () => {
    it('delete resolves the pinned version, deletes that row, and invalidates the cache (1.4/1.3a)', async () => {
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v2' });
      mockRepo.delete.mockResolvedValue({ ok: true });
      await service.delete('org-1', 'openai');
      expect(mockRepo.delete).toHaveBeenCalledWith('org-1', 'openai', 'v2');
      expect(mockResolution.invalidate).toHaveBeenCalledWith('ai', 'openai', 'org-1');
    });

    it('busts catalog cache after delete (A-22)', async () => {
      mockRepo.getByIdentifier.mockResolvedValue({ identifier: 'openai', version: 'v1' });
      mockRepo.delete.mockResolvedValue({ ok: true });
      await service.delete('org-1', 'openai');
      expect(mockBustCache).toHaveBeenCalledWith('org-1');
    });

    it('getBudget delegates to the repository', async () => {
      mockRepo.getBudget.mockResolvedValue({ monthlyCap: 10 });
      expect(await service.getBudget('org-1')).toEqual({ monthlyCap: 10 });
    });

    it('updateBudget delegates to the repository', async () => {
      mockRepo.upsertBudget.mockResolvedValue({ ok: true });
      await service.updateBudget('org-1', { dailyCap: 5 });
      expect(mockRepo.upsertBudget).toHaveBeenCalledWith('org-1', { dailyCap: 5 });
    });
  });

  describe('credential decryption', () => {
    it('treats undecryptable credentials as not configured', async () => {
      mockKernel.listManifests.mockReturnValue([{ providerId: 'openai', version: 'v1' }]);
      mockResolution.resolveAI.mockReturnValue(adapter);
      mockEncryption.decrypt.mockImplementationOnce(() => {
        throw new Error('bad key');
      });
      mockRepo.getByOrg.mockResolvedValue([{ identifier: 'openai', credentials: 'enc:garbage' }]);

      const res = await service.getProviders('org-1');
      expect(res[0].isConfigured).toBe(false);
    });

    it('_resolveVersion falls back to DEFAULT_VERSION when kernel has no active', async () => {
      mockKernel.latestActive.mockReturnValue(undefined);
      mockRepo.getByIdentifier.mockResolvedValue(null);
      // exercises the `latest?.manifest.version ?? DEFAULT_VERSION` fallback
      await service.getByIdentifier('org-1', 'openai');
      expect(mockRepo.getByIdentifier).toHaveBeenCalledWith('org-1', 'openai', 'v1');
    });
  });
});
