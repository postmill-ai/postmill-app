import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgProviderConfigService } from './org-provider-config.service';

// F2(c): a channel credential create/rotate must emit a non-fatal `credential.rotated`
// audit event whose metadata carries ONLY the provider + config id — never the secret.
describe('OrgProviderConfigService audit (F2c)', () => {
  let record: ReturnType<typeof vi.fn>;
  let repository: any;
  let service: OrgProviderConfigService;
  let resolution: any;

  beforeEach(() => {
    record = vi.fn().mockResolvedValue(undefined);
    repository = {
      create: vi.fn(),
      getById: vi.fn(),
      getByOrg: vi.fn(),
      updateById: vi.fn(),
    };
    const encryption = { encrypt: (v: string) => `enc:${v}`, decrypt: (v: string) => v } as any;
    const vpn = { listEnabledRegions: vi.fn().mockResolvedValue([]) } as any;
    resolution = {
      latestActiveVersion: vi.fn().mockReturnValue('v1'),
      // 1.1: write paths validate the version through this.
      resolveWriteVersion: vi.fn((_d: string, _p: string, v?: string) => v ?? 'v1'),
      // 1.3a: cache invalidation on create/update/delete.
      invalidate: vi.fn(),
    } as any;
    service = new OrgProviderConfigService(
      repository,
      encryption,
      vpn,
      resolution,
      { record } as any
    );
  });

  const baseRow = (over: Record<string, unknown> = {}) => ({
    id: 'cfg1',
    organizationId: 'o1',
    identifier: 'twitter',
    name: 'My Twitter App',
    version: 'v1',
    enabled: true,
    clientId: 'enc:cid',
    clientSecret: 'enc:csecret',
    additionalConfig: null,
    redirectUri: null,
    scopes: null,
    setupNotes: null,
    vpnSelection: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  });

  it('records credential.rotated on create with no secret in metadata', async () => {
    repository.create.mockResolvedValue(baseRow());

    await service.createConfig(
      'o1',
      {
        identifier: 'twitter',
        name: 'My Twitter App',
        enabled: true,
        clientId: 'super-secret-id',
        clientSecret: 'super-secret-value',
      },
      'u1'
    );

    expect(record).toHaveBeenCalledTimes(1);
    const arg = record.mock.calls[0][0];
    expect(arg.action).toBe('credential.rotated');
    expect(arg.orgId).toBe('o1');
    expect(arg.userId).toBe('u1');
    expect(arg.metadata).toEqual({ provider: 'twitter', configId: 'cfg1' });
    // The secret values must never appear anywhere in the audit payload.
    const serialized = JSON.stringify(arg);
    expect(serialized).not.toContain('super-secret-id');
    expect(serialized).not.toContain('super-secret-value');
    expect(serialized).not.toMatch(/secret|password/i);
  });

  it('records credential.rotated on update with only provider + config id', async () => {
    repository.getById.mockResolvedValue(baseRow());
    repository.updateById.mockResolvedValue(baseRow());

    await service.updateConfig(
      'o1',
      'cfg1',
      { clientSecret: 'rotated-secret' },
      'u1'
    );

    expect(record).toHaveBeenCalledTimes(1);
    const arg = record.mock.calls[0][0];
    expect(arg.action).toBe('credential.rotated');
    expect(arg.metadata).toEqual({ provider: 'twitter', configId: 'cfg1' });
    expect(JSON.stringify(arg)).not.toContain('rotated-secret');
  });

  it('is non-fatal when the audit write rejects', async () => {
    record.mockRejectedValue(new Error('audit down'));
    repository.create.mockResolvedValue(baseRow());

    await expect(
      service.createConfig(
        'o1',
        { identifier: 'twitter', name: 'App', enabled: false },
        'u1'
      )
    ).resolves.toBeDefined();
  });

  // 1.1: the pinned version is validated through resolveWriteVersion.
  it('validates the version through resolveWriteVersion on create', async () => {
    repository.create.mockResolvedValue(baseRow());
    await service.createConfig(
      'o1',
      { identifier: 'twitter', name: 'App', enabled: false, version: 'v2' },
      'u1'
    );
    // 1.4: create passes no `currentVersion` (a new pin), so the 4th arg is undefined.
    expect(resolution.resolveWriteVersion).toHaveBeenCalledWith('social', 'twitter', 'v2', undefined);
    expect(repository.create).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({ version: 'v2' })
    );
  });

  it('propagates a resolveWriteVersion rejection on create', async () => {
    resolution.resolveWriteVersion.mockImplementation(() => {
      throw new Error('version deprecated for write');
    });
    await expect(
      service.createConfig('o1', { identifier: 'twitter', name: 'App', enabled: false }, 'u1')
    ).rejects.toThrow('deprecated');
  });

  // 1.3a: kernel cache invalidation on create / update / delete.
  it('invalidates the resolution cache on create/update/delete', async () => {
    repository.create.mockResolvedValue(baseRow());
    await service.createConfig('o1', { identifier: 'twitter', name: 'App', enabled: false }, 'u1');
    expect(resolution.invalidate).toHaveBeenCalledWith('social', 'twitter', 'o1');

    resolution.invalidate.mockClear();
    repository.getById.mockResolvedValue(baseRow());
    repository.updateById.mockResolvedValue(baseRow());
    await service.updateConfig('o1', 'cfg1', { clientSecret: 'x' }, 'u1');
    expect(resolution.invalidate).toHaveBeenCalledWith('social', 'twitter', 'o1');

    resolution.invalidate.mockClear();
    repository.getById.mockResolvedValue(baseRow());
    repository.deleteById = vi.fn().mockResolvedValue(undefined);
    await service.deleteConfig('o1', 'cfg1', 'u1');
    expect(resolution.invalidate).toHaveBeenCalledWith('social', 'twitter', 'o1');
  });

  // 6.7: testConnection must not echo the decrypted OAuth clientId back.
  describe('testConnection (6.7 no clientId leak)', () => {
    it('returns only a boolean, never the decrypted clientId', async () => {
      repository.getById.mockResolvedValue(baseRow({ clientId: 'enc:super-secret-client-id' }));
      const result = await service.testConnection('o1', 'cfg1');
      expect(result).toEqual({ success: true });
      expect(result).not.toHaveProperty('authUrl');
      expect(JSON.stringify(result)).not.toContain('super-secret-client-id');
    });

    it('reports not-configured without a clientId', async () => {
      repository.getById.mockResolvedValue(baseRow({ clientId: null }));
      const result = await service.testConnection('o1', 'cfg1');
      expect(result).toEqual({ success: false, error: 'Client ID not configured' });
    });
  });

  describe('getDecryptedConfigs', () => {
    it('returns every org config with decrypted secrets and normalized fields', async () => {
      repository.getByOrg.mockResolvedValue([
        baseRow({
          id: 'cfg1',
          identifier: 'twitter',
          name: 'Twitter App',
          version: 'v2',
          enabled: true,
          clientId: 'client-id',
          clientSecret: 'client-secret',
          additionalConfig: '{"botToken":"token"}',
          redirectUri: 'https://example.com/cb',
          scopes: 'read,write',
          setupNotes: 'notes',
          vpnSelection: JSON.stringify({ enabled: true, identifier: 'nord', regionId: 'us' }),
        }),
        baseRow({
          id: 'cfg2',
          identifier: 'linkedin',
          name: 'LinkedIn App',
          version: null,
          enabled: false,
          clientId: null,
          clientSecret: null,
          additionalConfig: null,
          redirectUri: null,
          scopes: null,
          setupNotes: null,
          vpnSelection: null,
        }),
      ]);

      const result = await service.getDecryptedConfigs('o1');

      expect(repository.getByOrg).toHaveBeenCalledWith('o1');
      expect(result).toHaveLength(2);

      const [first, second] = result;
      expect(first.id).toBe('cfg1');
      expect(first.identifier).toBe('twitter');
      expect(first.version).toBe('v2');
      expect(first.enabled).toBe(true);
      expect(first.clientId).toBe('client-id');
      expect(first.clientSecret).toBe('client-secret');
      expect(first.additionalConfig).toBe('{"botToken":"token"}');
      expect(first.redirectUri).toBe('https://example.com/cb');
      expect(first.scopes).toBe('read,write');
      expect(first.setupNotes).toBe('notes');
      expect(first.vpnSelection).toEqual({ enabled: true, identifier: 'nord', regionId: 'us' });

      expect(second.id).toBe('cfg2');
      expect(second.version).toBe('v1');
      expect(second.enabled).toBe(false);
      expect(second.clientId).toBeUndefined();
      expect(second.clientSecret).toBeUndefined();
      expect(second.redirectUri).toBeUndefined();
      expect(second.scopes).toBeUndefined();
      expect(second.setupNotes).toBeUndefined();
      expect(second.vpnSelection).toBeNull();
    });
  });
});
