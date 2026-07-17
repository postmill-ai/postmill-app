import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgContentPackSettingsService } from './org-content-pack-settings.service';

function makeService() {
  const repository = {
    getByOrg: vi.fn().mockResolvedValue([]),
    getActivePointer: vi.fn().mockResolvedValue(null),
    getByIdentifier: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({ identifier: 'magnific' }),
    delete: vi.fn().mockResolvedValue({}),
    setActivePointer: vi.fn().mockResolvedValue({}),
  };
  const encryption = {
    encrypt: vi.fn((v: string) => `enc(${v})`),
    decrypt: vi.fn((v: string) => v.replace(/^enc\((.*)\)$/, '$1')),
  };
  const resolution = {
    resolveContentPack: vi.fn(),
    resolveWriteVersion: vi.fn((_domain: string, _id: string, version?: string) => version ?? 'v1'),
    latestActiveVersion: vi.fn().mockReturnValue('v1'),
    invalidate: vi.fn(),
    listManifests: vi.fn().mockReturnValue([]),
  };

  const service = new OrgContentPackSettingsService(
    repository as never,
    encryption as never,
    resolution as never,
  );

  return { service, repository, encryption, resolution };
}

describe('OrgContentPackSettingsService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('upsert (1.1/1.3a)', () => {
    it('validates + pins the version via resolveWriteVersion and invalidates the cache', async () => {
      const { service, repository, resolution } = makeService();
      resolution.resolveWriteVersion.mockReturnValue('v2');

      await service.upsert('org-1', 'magnific', { credentials: { apiKey: 'k' }, version: 'v2' });

      expect(resolution.resolveWriteVersion).toHaveBeenCalledWith('contentpack', 'magnific', 'v2');
      expect(repository.upsert).toHaveBeenCalledWith(
        'org-1',
        'magnific',
        expect.objectContaining({ credentials: `enc(${JSON.stringify({ apiKey: 'k' })})` }),
        'v2',
      );
      expect(resolution.invalidate).toHaveBeenCalledWith('contentpack', 'magnific', 'org-1');
    });

    it('propagates a rejected write version from resolveWriteVersion', async () => {
      const { service, repository, resolution } = makeService();
      resolution.resolveWriteVersion.mockImplementation(() => {
        throw new Error('deprecated version');
      });

      await expect(
        service.upsert('org-1', 'magnific', { credentials: { apiKey: 'k' }, version: 'v0' }),
      ).rejects.toThrow('deprecated');
      expect(repository.upsert).not.toHaveBeenCalled();
    });
  });

  describe('delete (1.3a)', () => {
    it('deletes and invalidates the cache', async () => {
      const { service, repository, resolution } = makeService();
      await service.delete('org-1', 'magnific');
      expect(repository.delete).toHaveBeenCalledWith('org-1', 'magnific');
      expect(resolution.invalidate).toHaveBeenCalledWith('contentpack', 'magnific', 'org-1');
    });
  });

  describe('getActive (6.3 decrypt-failure → null)', () => {
    it('returns null when credential decryption fails (degrades to free)', async () => {
      const { service, repository, encryption } = makeService();
      repository.getActivePointer.mockResolvedValue({
        activeContentPackIdentifier: 'magnific@v1',
      });
      repository.getByIdentifier.mockResolvedValue({
        identifier: 'magnific',
        version: 'v1',
        credentials: 'corrupt-ciphertext',
        extraConfig: {},
      });
      encryption.decrypt.mockImplementation(() => {
        throw new Error('bad auth tag');
      });

      expect(await service.getActive('org-1')).toBeNull();
    });
  });

  describe('getActiveForCapability (1.6 free-provider fallback)', () => {
    function withActivePack(ctx: ReturnType<typeof makeService>) {
      ctx.repository.getActivePointer.mockResolvedValue({ activeContentPackIdentifier: 'magnific@v1' });
      ctx.repository.getByIdentifier.mockResolvedValue({
        identifier: 'magnific',
        version: 'v1',
        credentials: `enc(${JSON.stringify({ apiKey: 'k' })})`,
        extraConfig: {},
      });
      return ctx;
    }

    it('returns null (degrades to free) when resolution throws, without propagating', async () => {
      const ctx = withActivePack(makeService());
      ctx.resolution.resolveContentPack.mockImplementation(() => {
        throw new Error('ProviderVersionRetiredError: contentpack/magnific@v1');
      });

      const result = await ctx.service.getActiveForCapability('org-1', 'photos');
      expect(result).toBeNull();
    });

    it('returns the capability when resolution succeeds and the capability is supported', async () => {
      const ctx = withActivePack(makeService());
      const capabilityInstance = { capabilities: ['photos', 'videos'], search: vi.fn() };
      ctx.resolution.resolveContentPack.mockReturnValue(capabilityInstance);

      const result = await ctx.service.getActiveForCapability('org-1', 'photos');
      expect(result).toEqual({ capability: capabilityInstance, active: expect.objectContaining({ identifier: 'magnific' }) });
    });

    it('returns null when the active pack does not declare the capability', async () => {
      const ctx = withActivePack(makeService());
      ctx.resolution.resolveContentPack.mockReturnValue({ capabilities: ['videos'], search: vi.fn() });

      const result = await ctx.service.getActiveForCapability('org-1', 'photos');
      expect(result).toBeNull();
    });

    it('returns null when there is no active pack', async () => {
      const { service } = makeService();
      expect(await service.getActiveForCapability('org-1', 'photos')).toBeNull();
    });
  });
});
