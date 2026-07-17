import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgMediaProviderSettingsService } from './org-media-provider-settings.service';

function makeService() {
  const repository = {
    getByOrg: vi.fn().mockResolvedValue([]),
    getByIdentifier: vi.fn().mockResolvedValue(null),
    // 1.2: _getPinnedVersion reads version-agnostically. Delegate to getByIdentifier
    // so a per-test `getByIdentifier.mockResolvedValue(...)` also drives it.
    findAnyByIdentifier: vi.fn((orgId: string, id: string) =>
      repository.getByIdentifier(orgId, id),
    ),
    upsert: vi.fn().mockResolvedValue({ identifier: 'openai' }),
    setActive: vi.fn().mockResolvedValue({ identifier: 'openai', isActive: true }),
    delete: vi.fn().mockResolvedValue({}),
  };
  const encryption = {
    encrypt: vi.fn((v: string) => `enc(${v})`),
    decrypt: vi.fn((v: string) => v.replace(/^enc\((.*)\)$/, '$1')),
  };
  const kernel = { listManifests: vi.fn().mockReturnValue([]) };
  const resolution = {
    resolveMedia: vi.fn(),
    latestActiveVersion: vi.fn().mockReturnValue('v1'),
    resolveWriteVersion: vi.fn((_domain: string, _id: string, version?: string) => version ?? 'v1'),
    invalidate: vi.fn(),
  };
  const mediaRepository = {
    findFoldersByParent: vi.fn().mockResolvedValue([]),
    createFolder: vi.fn().mockImplementation(async (_org: string, data: { name: string }) => ({
      id: `f-${data.name}`,
      name: data.name,
    })),
  };
  const fileService = {
    findFoldersByParent: mediaRepository.findFoldersByParent,
    createFolder: mediaRepository.createFolder,
    getFolder: vi.fn().mockResolvedValue({ id: 'folder-1' }),
  };
  const storageService = {
    getProviderConfigs: vi.fn().mockResolvedValue([{ id: 'sp-1' }, { id: '__virtual_local__' }]),
  };
  const defaultsSeed = {
    seedUnset: vi.fn().mockResolvedValue(undefined),
  };
  const credentialLink = {
    syncFromMediaProvider: vi.fn().mockResolvedValue(undefined),
  };
  const orgAiRepository = {
    getByIdentifier: vi.fn().mockResolvedValue(null),
    // 1.2: _aiCredentials reads the AI row version-agnostically. Delegate so a
    // per-test `getByIdentifier.mockResolvedValue(...)` drives both reads.
    findAnyByIdentifier: vi.fn((orgId: string, id: string) =>
      orgAiRepository.getByIdentifier(orgId, id),
    ),
  };

  const service = new OrgMediaProviderSettingsService(
    repository as never,
    encryption as never,
    resolution as never,
    fileService as never,
    storageService as never,
    defaultsSeed as never,
    kernel as never,
    credentialLink as never,
    orgAiRepository as never,
  );

  return { service, repository, encryption, kernel, resolution, fileService, storageService, defaultsSeed, credentialLink, orgAiRepository };
}

describe('OrgMediaProviderSettingsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('setActive', () => {
    it('marks a configured provider Primary (clears prior, pins version) without disabling others', async () => {
      const { service, repository, resolution } = makeService();
      resolution.latestActiveVersion.mockReturnValue('v1');
      // getConfigForProvider sees a credentialed row → configured.
      repository.getByIdentifier.mockResolvedValue({
        identifier: 'openai',
        credentials: `enc(${JSON.stringify({ apiKey: 'sk-1' })})`,
        storageProviderId: null,
        storageRootFolderId: null,
        version: 'v1',
      });
      await service.setActive('org-1', 'openai');
      // ensures a row exists, then flips isActive via the repo's two-step setActive.
      expect(repository.upsert).toHaveBeenCalledWith(
        'org-1',
        'openai',
        expect.objectContaining({ enabled: true }),
        'v1',
      );
      expect(repository.setActive).toHaveBeenCalledWith('org-1', 'openai', 'v1');
    });

    it('rejects making an unconfigured provider Primary', async () => {
      const { service, repository } = makeService();
      repository.getByIdentifier.mockResolvedValue(null);
      await expect(service.setActive('org-1', 'openai')).rejects.toThrow(/not configured/);
      expect(repository.setActive).not.toHaveBeenCalled();
    });
  });

  describe('upsert', () => {
    it('encrypts credentials at rest and invalidates the cache (1.3a)', async () => {
      const { service, repository, resolution } = makeService();
      await service.upsert('org-1', 'openai', { enabled: true, credentials: { apiKey: 'sk-1' } });
      expect(repository.upsert).toHaveBeenCalledWith(
        'org-1',
        'openai',
        expect.objectContaining({
          enabled: true,
          credentials: `enc(${JSON.stringify({ apiKey: 'sk-1' })})`,
        }),
        'v1',
      );
      expect(resolution.invalidate).toHaveBeenCalledWith('media', 'openai', 'org-1');
    });

    it('validates + pins the version via resolveWriteVersion when none is provided (1.1)', async () => {
      const { service, repository, resolution } = makeService();
      resolution.resolveWriteVersion.mockReturnValue('v2');
      await service.upsert('org-1', 'openai', { enabled: true, credentials: { apiKey: 'sk-1' } });
      expect(resolution.resolveWriteVersion).toHaveBeenCalledWith('media', 'openai', undefined);
      expect(repository.upsert).toHaveBeenCalledWith(
        'org-1',
        'openai',
        expect.anything(),
        'v2',
      );
    });

    it('routes an explicit body.version through resolveWriteVersion (1.1)', async () => {
      const { service, repository, resolution } = makeService();
      resolution.resolveWriteVersion.mockReturnValue('v3');
      await service.upsert('org-1', 'openai', { enabled: true, credentials: { apiKey: 'sk-1' }, version: 'v3' });
      expect(resolution.resolveWriteVersion).toHaveBeenCalledWith('media', 'openai', 'v3');
      expect(repository.upsert).toHaveBeenCalledWith(
        'org-1',
        'openai',
        expect.anything(),
        'v3',
      );
    });

    it('propagates a rejected write version from resolveWriteVersion (1.1)', async () => {
      const { service, repository, resolution } = makeService();
      resolution.resolveWriteVersion.mockImplementation(() => {
        throw new Error('retired version');
      });
      await expect(
        service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk-1' }, version: 'v0' }),
      ).rejects.toThrow('retired');
      expect(repository.upsert).not.toHaveBeenCalled();
    });

    it('live-links openai/minimax credentials to the AI surface (§11.4)', async () => {
      const { service, credentialLink } = makeService();
      await service.upsert('org-1', 'openai', { credentials: { apiKey: 'sk-1' } });
      expect(credentialLink.syncFromMediaProvider).toHaveBeenCalledWith('org-1', 'openai', { apiKey: 'sk-1' });
    });

    it('does not call the link when no credentials are supplied', async () => {
      const { service, credentialLink } = makeService();
      await service.upsert('org-1', 'openai', { enabled: true });
      expect(credentialLink.syncFromMediaProvider).not.toHaveBeenCalled();
    });

    it('ensures the 5-folder typed tree when a storage binding is saved (§11.5)', async () => {
      const { service, fileService } = makeService();
      await service.upsert('org-1', 'fal', {
        storageProviderId: 'sp-1',
        storageRootFolderId: 'root-1',
      });
      const created = fileService.createFolder.mock.calls.map((c) => c[1].name);
      expect(created.sort()).toEqual(['audio', 'documents', 'images', 'other', 'video']);
    });
  });

  describe('getEnabledProviders', () => {
    it('returns enabled+credentialed rows with parsed extraConfig and no secrets', async () => {
      const { service, repository } = makeService();
      repository.getByOrg.mockResolvedValue([
        {
          identifier: 'fal',
          enabled: true,
          credentials: 'enc({"apiKey":"k"})',
          storageProviderId: 'sp-1',
          storageRootFolderId: 'root-1',
          extraConfig: JSON.stringify({ operations: ['image'], c2paAvailable: true }),
        },
        { identifier: 'luma', enabled: false, credentials: 'enc({})', storageProviderId: null, storageRootFolderId: null, extraConfig: null },
        { identifier: 'heygen', enabled: true, credentials: null, storageProviderId: null, storageRootFolderId: null, extraConfig: null },
      ]);

      const result = await service.getEnabledProviders('org-1');
      expect(result).toEqual([
        {
          identifier: 'fal',
          storageProviderId: 'sp-1',
          storageRootFolderId: 'root-1',
          extraConfig: { operations: ['image'], c2paAvailable: true },
        },
      ]);
      expect(JSON.stringify(result)).not.toContain('apiKey');
    });

    it('tolerates malformed extraConfig', async () => {
      const { service, repository } = makeService();
      repository.getByOrg.mockResolvedValue([
        { identifier: 'fal', enabled: true, credentials: 'enc({})', storageProviderId: null, storageRootFolderId: null, extraConfig: '{not json' },
      ]);
      const result = await service.getEnabledProviders('org-1');
      expect(result[0].extraConfig).toEqual({});
    });
  });

  describe('getConfigForProvider', () => {
    it('decrypts the credentials', async () => {
      const { service, repository } = makeService();
      repository.getByIdentifier.mockResolvedValue({
        identifier: 'fal',
        credentials: `enc(${JSON.stringify({ apiKey: 'k-1' })})`,
        storageProviderId: 'sp-1',
        storageRootFolderId: 'root-1',
        version: 'v1',
      });

      const config = await service.getConfigForProvider('org-1', 'fal');
      expect(config).toEqual({
        credentials: { apiKey: 'k-1' },
        storageProviderId: 'sp-1',
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
    });

    it('returns null when not configured', async () => {
      const { service } = makeService();
      expect(await service.getConfigForProvider('org-1', 'nope')).toBeNull();
    });

    it('falls back to the org AI key for Qwen when no media credential exists', async () => {
      const { service, orgAiRepository } = makeService();
      // No media config row for qwen, but the org has an AI Qwen key (AES-GCM encrypted,
      // same scheme as media creds → decrypted with the media EncryptionService).
      orgAiRepository.getByIdentifier.mockResolvedValue({
        identifier: 'qwen',
        credentials: `enc(${JSON.stringify({ apiKey: 'dashscope-key' })})`,
      });

      const config = await service.getConfigForProvider('org-1', 'qwen');
      expect(orgAiRepository.getByIdentifier).toHaveBeenCalledWith('org-1', 'qwen');
      expect(config).toEqual({
        credentials: { apiKey: 'dashscope-key' },
        storageProviderId: null,
        storageRootFolderId: null,
        version: 'v1',
      });
    });

    it('prefers the dedicated media credential over the AI fallback for Qwen', async () => {
      const { service, repository, orgAiRepository } = makeService();
      repository.getByIdentifier.mockResolvedValue({
        identifier: 'qwen',
        credentials: `enc(${JSON.stringify({ apiKey: 'media-key' })})`,
        storageProviderId: 'sp-1',
        storageRootFolderId: 'root-1',
        version: 'v1',
      });
      const config = await service.getConfigForProvider('org-1', 'qwen');
      expect(config?.credentials).toEqual({ apiKey: 'media-key' });
      expect(orgAiRepository.getByIdentifier).not.toHaveBeenCalled();
    });

    it('does not fall back for non-universal providers', async () => {
      const { service, orgAiRepository } = makeService();
      orgAiRepository.getByIdentifier.mockResolvedValue({ credentials: `enc(${JSON.stringify({ apiKey: 'x' })})` });
      expect(await service.getConfigForProvider('org-1', 'runway')).toBeNull();
      expect(orgAiRepository.getByIdentifier).not.toHaveBeenCalled();
    });

    it('reuses the org AI key for the new hub providers (single + multi-field)', async () => {
      const { service, orgAiRepository } = makeService();
      orgAiRepository.getByIdentifier.mockImplementation(async (_org: string, id: string) => {
        if (id === 'togetherai') return { credentials: `enc(${JSON.stringify({ apiKey: 'tg-key' })})` };
        // Bedrock reuses its multi-field AWS credentials verbatim.
        if (id === 'bedrock')
          return {
            credentials: `enc(${JSON.stringify({ region: 'us-east-1', accessKeyId: 'AK', secretAccessKey: 'SK' })})`,
          };
        return null;
      });

      expect((await service.getConfigForProvider('org-1', 'togetherai'))?.credentials).toEqual({ apiKey: 'tg-key' });
      expect((await service.getConfigForProvider('org-1', 'bedrock'))?.credentials).toEqual({
        region: 'us-east-1',
        accessKeyId: 'AK',
        secretAccessKey: 'SK',
      });
    });
  });

  describe('getProviders universal-credential fallback', () => {
    it('marks Qwen configured + enabled when only the AI key exists', async () => {
      const { service, kernel, repository, orgAiRepository } = makeService();
      kernel.listManifests.mockReturnValue([
        { providerId: 'qwen', displayName: 'Qwen', capabilities: { image: true, video: true } },
        { providerId: 'runway', displayName: 'Runway', capabilities: { video: true } },
      ]);
      repository.getByOrg.mockResolvedValue([]); // no media config rows
      orgAiRepository.getByIdentifier.mockImplementation(async (_org: string, id: string) =>
        id === 'qwen' ? { credentials: `enc(${JSON.stringify({ apiKey: 'k' })})` } : null,
      );

      const providers = await service.getProviders('org-1');
      const qwen = providers.find((p) => p.identifier === 'qwen');
      const runway = providers.find((p) => p.identifier === 'runway');
      expect(qwen).toMatchObject({ isConfigured: true, enabled: true });
      expect(runway).toMatchObject({ isConfigured: false, enabled: false });
    });
  });

  describe('getStandardFolderId', () => {
    it('creates missing folders and resolves the typed folder id', async () => {
      const { service, fileService } = makeService();
      fileService.findFoldersByParent
        .mockResolvedValueOnce([]) // ensure pass
        .mockResolvedValueOnce([
          { id: 'f-video', name: 'video' },
          { id: 'f-audio', name: 'audio' },
        ]);

      const id = await service.getStandardFolderId('org-1', 'root-1', 'video');
      expect(id).toBe('f-video');
    });

    it('rejects non-standard folder names', async () => {
      const { service } = makeService();
      expect(await service.getStandardFolderId('org-1', 'root-1', '../escape')).toBeNull();
    });
  });

  describe('isProviderEnabledForOperation', () => {
    it('gates on enabled + extraConfig operations', async () => {
      const { service, repository } = makeService();
      repository.getByIdentifier.mockResolvedValue({
        enabled: true,
        extraConfig: JSON.stringify({ operations: ['video'] }),
      });
      expect(await service.isProviderEnabledForOperation('org-1', 'luma', 'video')).toBe(true);
      expect(await service.isProviderEnabledForOperation('org-1', 'luma', 'image')).toBe(false);

      repository.getByIdentifier.mockResolvedValue({ enabled: false, extraConfig: null });
      expect(await service.isProviderEnabledForOperation('org-1', 'luma', 'video')).toBe(false);

      repository.getByIdentifier.mockResolvedValue({ enabled: true, extraConfig: null });
      expect(await service.isProviderEnabledForOperation('org-1', 'luma', 'video')).toBe(true);
    });

    it('inherits enabled for a universal provider with no row but an AI key (1.7)', async () => {
      const { service, repository, orgAiRepository } = makeService();
      repository.getByIdentifier.mockResolvedValue(null);
      orgAiRepository.getByIdentifier.mockResolvedValue({
        credentials: `enc(${JSON.stringify({ apiKey: 'k' })})`,
      });
      expect(await service.isProviderEnabledForOperation('org-1', 'qwen', 'image')).toBe(true);
    });

    it('an explicit enabled:false universal row is OFF even with an AI key (1.7)', async () => {
      const { service, repository, orgAiRepository } = makeService();
      repository.getByIdentifier.mockResolvedValue({ enabled: false, extraConfig: null });
      orgAiRepository.getByIdentifier.mockResolvedValue({
        credentials: `enc(${JSON.stringify({ apiKey: 'k' })})`,
      });
      expect(await service.isProviderEnabledForOperation('org-1', 'qwen', 'image')).toBe(false);
    });
  });

  describe('enabled:false enforcement (1.7)', () => {
    it('getConfigForProvider skips the AI-key fallback for a disabled universal row (stops spend)', async () => {
      const { service, repository, orgAiRepository } = makeService();
      // Qwen has an explicit media row disabled to stop spend, but no own creds.
      repository.getByIdentifier.mockResolvedValue({
        identifier: 'qwen',
        enabled: false,
        credentials: null,
        storageProviderId: null,
        storageRootFolderId: null,
        version: 'v1',
      });
      orgAiRepository.getByIdentifier.mockResolvedValue({
        credentials: `enc(${JSON.stringify({ apiKey: 'dashscope-key' })})`,
      });

      const config = await service.getConfigForProvider('org-1', 'qwen');
      // 1.1: a disabled row returns null entirely (stronger than empty creds) → the
      // generation path treats it as not-configured; the AI-key fallback never fires.
      expect(config).toBeNull();
      expect(orgAiRepository.getByIdentifier).not.toHaveBeenCalled();
    });

    it('getProviders reports a disabled universal row as disabled even with an AI key', async () => {
      const { service, kernel, repository, orgAiRepository } = makeService();
      kernel.listManifests.mockReturnValue([
        { providerId: 'qwen', displayName: 'Qwen', capabilities: { image: true } },
      ]);
      repository.getByOrg.mockResolvedValue([
        { identifier: 'qwen', enabled: false, credentials: null, storageProviderId: null, storageRootFolderId: null },
      ]);
      orgAiRepository.getByIdentifier.mockResolvedValue({
        credentials: `enc(${JSON.stringify({ apiKey: 'k' })})`,
      });

      const providers = await service.getProviders('org-1');
      const qwen = providers.find((p) => p.identifier === 'qwen');
      expect(qwen?.enabled).toBe(false);
    });
  });

  describe('getProviders / getActiveProviders / delete / testConnection', () => {
    it('merges registry adapters with org config state', async () => {
      const { service, kernel, repository } = makeService();
      kernel.listManifests.mockReturnValue([
        { providerId: 'fal', displayName: 'fal.ai', capabilities: { image: true } },
        { providerId: 'luma', displayName: 'Luma', capabilities: { video: true } },
      ]);
      repository.getByOrg.mockResolvedValue([
        { identifier: 'fal', enabled: true, credentials: 'enc({})', storageProviderId: 'sp-1', storageRootFolderId: null, createdAt: new Date(1), updatedAt: new Date(2) },
      ]);

      const providers = await service.getProviders('org-1');
      expect(providers).toHaveLength(2);
      expect(providers[0]).toMatchObject({ identifier: 'fal', enabled: true, isConfigured: true, storageProviderId: 'sp-1' });
      expect(providers[1]).toMatchObject({ identifier: 'luma', enabled: false, isConfigured: false });
      expect(JSON.stringify(providers)).not.toContain('enc(');
    });

    it('getActiveProviders returns only enabled + credentialed rows', async () => {
      const { service, repository } = makeService();
      repository.getByOrg.mockResolvedValue([
        { identifier: 'fal', enabled: true, credentials: 'enc({})', storageProviderId: null, storageRootFolderId: null },
        { identifier: 'luma', enabled: true, credentials: null, storageProviderId: null, storageRootFolderId: null },
      ]);
      const active = await service.getActiveProviders('org-1');
      expect(active).toEqual([{ identifier: 'fal', storageProviderId: null, storageRootFolderId: null }]);
    });

    it('delete delegates to the repository and invalidates the cache (1.3a)', async () => {
      const { service, repository, resolution } = makeService();
      await service.delete('org-1', 'fal');
      expect(repository.delete).toHaveBeenCalledWith('org-1', 'fal');
      expect(resolution.invalidate).toHaveBeenCalledWith('media', 'fal', 'org-1');
    });

    it('testConnection runs a probe generation with decrypted credentials', async () => {
      const { service, repository, resolution } = makeService();
      const generateImage = vi.fn().mockResolvedValue({ multi: false, image: 'ok' });
      resolution.resolveMedia.mockReturnValue({ identifier: 'fal', capabilities: { image: true }, generateImage });
      repository.getByIdentifier.mockResolvedValue({ identifier: 'fal', credentials: 'enc({"apiKey":"k"})', version: 'v1' });

      const result = await service.testConnection('org-1', 'fal');
      expect(generateImage).toHaveBeenCalledWith('test', { credentials: { apiKey: 'k' } });
      expect(result).toEqual({ ok: true, message: 'Connection successful' });
    });

    it('testConnection reports probe failures and unknown providers', async () => {
      const { service, repository, resolution } = makeService();
      resolution.resolveMedia.mockReturnValue({
        identifier: 'fal',
        capabilities: { image: true },
        generateImage: vi.fn().mockRejectedValue(new Error('bad key')),
      });
      repository.getByIdentifier.mockResolvedValue({ identifier: 'fal', credentials: 'enc({})', version: 'v1' });
      expect(await service.testConnection('org-1', 'fal')).toEqual({ ok: false, message: 'bad key' });

      resolution.resolveMedia.mockImplementation(() => {
        throw new Error('Unknown media provider: fal');
      });
      await expect(service.testConnection('org-1', 'fal')).rejects.toThrow('Unknown media provider');

      repository.getByIdentifier.mockResolvedValue(null);
      await expect(service.testConnection('org-1', 'nope')).rejects.toThrow('not configured');
    });

    it('testConnection prefers the adapter testConnection over image generation', async () => {
      const { service, repository, resolution } = makeService();
      const generateImage = vi.fn();
      const testConnection = vi.fn().mockResolvedValue({ ok: true, message: 'Connection successful' });
      resolution.resolveMedia.mockReturnValue({
        identifier: 'heygen',
        capabilities: { image: false, video: true, avatar: true },
        generateImage,
        testConnection,
      });
      repository.getByIdentifier.mockResolvedValue({ identifier: 'heygen', credentials: 'enc({"apiKey":"k"})', version: 'v1' });

      const result = await service.testConnection('org-1', 'heygen');
      expect(testConnection).toHaveBeenCalledWith({ credentials: { apiKey: 'k' } });
      expect(generateImage).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, message: 'Connection successful' });
    });

    it('testConnection does not run image generation for a non-image provider without a test', async () => {
      const { service, repository, resolution } = makeService();
      const generateImage = vi.fn();
      resolution.resolveMedia.mockReturnValue({ identifier: 'deepgram', capabilities: { image: false, stt: true }, generateImage });
      repository.getByIdentifier.mockResolvedValue({ identifier: 'deepgram', credentials: 'enc({})', version: 'v1' });

      const result = await service.testConnection('org-1', 'deepgram');
      expect(generateImage).not.toHaveBeenCalled();
      expect(result.ok).toBe(true);
    });
  });
});
