import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OrgVpnConfigService } from './org-vpn-config.service';
import { VpnProviderAdapter } from './vpn-provider.interface';
// The adapters now live in their own workspace packages; build instances from
// the relocated package modules (the same modules ProvidersBootstrap registers).
import nordvpnModules from '@gitroom/provider-nordvpn';
import expressvpnModules from '@gitroom/provider-expressvpn';
import surfsharkModules from '@gitroom/provider-surfshark';
import protonvpnModules from '@gitroom/provider-protonvpn';
import mullvadModules from '@gitroom/provider-mullvad';
import cyberghostModules from '@gitroom/provider-cyberghost';
import piaModules from '@gitroom/provider-pia';
import ipvanishModules from '@gitroom/provider-ipvanish';
import windscribeModules from '@gitroom/provider-windscribe';
import tunnelbearModules from '@gitroom/provider-tunnelbear';
import hotspotshieldModules from '@gitroom/provider-hotspotshield';
import purevpnModules from '@gitroom/provider-purevpn';
import vyprvpnModules from '@gitroom/provider-vyprvpn';
import hidemeModules from '@gitroom/provider-hideme';
import mozillavpnModules from '@gitroom/provider-mozillavpn';
import customproxyModules from '@gitroom/provider-custom-proxy';
import { OrgVpnConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/vpn/org-vpn-config.repository';
import { OrgProviderConfigRepository } from '@gitroom/nestjs-libraries/database/prisma/provider-configs/org-provider-config.repository';
import { EncryptionService } from '@gitroom/nestjs-libraries/encryption/encryption.service';
import { ProviderResolutionService } from '@gitroom/nestjs-libraries/providers/provider-resolution.service';
import { ProviderKernel, ProviderNotFoundError } from '@gitroom/provider-kernel';
import { VpnDispatcherService } from './vpn-dispatcher.service';

// All relocated VPN package modules, mirroring providers.generated.ts.
const ALL_VPN_MODULES = [
  ...nordvpnModules,
  ...expressvpnModules,
  ...surfsharkModules,
  ...protonvpnModules,
  ...mullvadModules,
  ...cyberghostModules,
  ...piaModules,
  ...ipvanishModules,
  ...windscribeModules,
  ...tunnelbearModules,
  ...hotspotshieldModules,
  ...purevpnModules,
  ...vyprvpnModules,
  ...hidemeModules,
  ...mozillavpnModules,
  ...customproxyModules,
];

describe('OrgVpnConfigService', () => {
  let service: OrgVpnConfigService;
  let repository: OrgVpnConfigRepository;
  let encryption: EncryptionService;
  let kernel: ProviderKernel;
  let dispatcher: VpnDispatcherService;
  let resolution: ProviderResolutionService;
  let channelConfigRepository: OrgProviderConfigRepository;

  beforeEach(() => {
    repository = {
      getByOrg: vi.fn().mockResolvedValue([]),
      getByIdentifier: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockImplementation((_orgId, identifier, data) =>
        Promise.resolve({ id: 'cfg-1', identifier, ...data }),
      ),
      delete: vi.fn().mockResolvedValue({ count: 1 }),
    } as unknown as OrgVpnConfigRepository;

    encryption = {
      encrypt: vi.fn((value: string) => `enc:${value}`),
      decrypt: vi.fn((value: string) => value.replace(/^enc:/, '')),
      encryptDeterministic: vi.fn(),
    } as unknown as EncryptionService;

    // Build adapter instances from the relocated package modules. The in-memory
    // registry is gone; providers now resolve through the kernel manifests +
    // ProviderResolutionService.resolveVpn.
    const vpnAdapters = new Map<string, VpnProviderAdapter>();
    for (const mod of ALL_VPN_MODULES) {
      if (mod.manifest.domain === 'vpn') {
        vpnAdapters.set(
          mod.manifest.providerId,
          mod.create({ fetch: async () => new Response() } as any) as VpnProviderAdapter,
        );
      }
    }

    kernel = {
      listManifests: (domain: string) =>
        domain === 'vpn'
          ? [...vpnAdapters.keys()].map((providerId) => ({
              domain: 'vpn',
              providerId,
              version: 'v1',
            }))
          : [],
    } as unknown as ProviderKernel;

    dispatcher = { invalidate: vi.fn() } as unknown as VpnDispatcherService;

    resolution = {
      resolveVpn: vi.fn((identifier: string, options?: { version?: string; credentials?: Record<string, string>; orgId?: string }) => {
        const adapter = vpnAdapters.get(identifier);
        if (!adapter) {
          throw new ProviderNotFoundError({ domain: 'vpn', providerId: identifier, version: options?.version ?? 'v1' });
        }
        return adapter;
      }),
      latestActiveVersion: vi.fn().mockReturnValue('v1'),
      // 1.1: write paths validate + resolve the version through this.
      resolveWriteVersion: vi.fn((_d: string, _p: string, v?: string) => v ?? 'v1'),
      // 1.3a: cache invalidation on upsert/delete.
      invalidate: vi.fn(),
    } as unknown as ProviderResolutionService;

    // 3.7: channel-config repo — used only to clear orphaned vpnSelection on delete.
    channelConfigRepository = {
      getByOrg: vi.fn().mockResolvedValue([]),
      updateById: vi.fn().mockResolvedValue({}),
    } as unknown as OrgProviderConfigRepository;

    service = new OrgVpnConfigService(
      repository,
      encryption,
      dispatcher,
      resolution,
      kernel,
      channelConfigRepository,
    );
  });

  it('returns provider metadata with all adapters', () => {
    const meta = service.getProviderMetadata();
    expect(meta).toHaveLength(16);
    expect(meta.map((m) => m.identifier).sort()).toEqual([
      'custom',
      'cyberghost',
      'expressvpn',
      'hideme',
      'hotspotshield',
      'ipvanish',
      'mozillavpn',
      'mullvad',
      'nordvpn',
      'pia',
      'protonvpn',
      'purevpn',
      'surfshark',
      'tunnelbear',
      'vyprvpn',
      'windscribe',
    ]);
    expect(meta.find((m) => m.identifier === 'custom')!.isDynamicRegions).toBe(true);
    expect(meta.find((m) => m.identifier === 'nordvpn')!.isDynamicRegions).toBe(false);
  });

  it('marks provider configured when required credentials are present', async () => {
    vi.spyOn(repository, 'getByOrg').mockResolvedValue([
      {
        id: 'cfg-1',
        organizationId: 'org-1',
        identifier: 'nordvpn',
        name: null,
        credentials: `enc:{"serviceCredentials":"user:pass"}`,
        enabled: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
    ]);

    const providers = await service.getProviders('org-1');
    const nordvpn = providers.find((p) => p.identifier === 'nordvpn')!;
    expect(nordvpn.isConfigured).toBe(true);
    expect(nordvpn.enabled).toBe(true);

    const mullvad = providers.find((p) => p.identifier === 'mullvad')!;
    expect(mullvad.isConfigured).toBe(false);
  });

  it('encrypts credentials on upsert and validates first', async () => {
    await service.upsert('org-1', 'nordvpn', {
      name: 'Home NordVPN',
      credentials: { serviceCredentials: 'user:pass' },
      enabled: true,
    });

    expect(encryption.encrypt).toHaveBeenCalledWith(
      JSON.stringify({ serviceCredentials: 'user:pass' }),
    );
    expect(repository.upsert).toHaveBeenCalledWith(
      'org-1',
      'nordvpn',
      expect.objectContaining({ enabled: true, name: 'Home NordVPN' }),
      'v1',
    );
  });

  it('throws on invalid credentials', async () => {
    await expect(
      service.upsert('org-1', 'nordvpn', {
        credentials: { serviceCredentials: 'nocolon' },
      }),
    ).rejects.toThrow(/Service credentials must be in the format/);
  });

  it('deletes provider config', async () => {
    await service.delete('org-1', 'nordvpn');
    expect(repository.delete).toHaveBeenCalledWith('org-1', 'nordvpn');
    expect(dispatcher.invalidate).toHaveBeenCalledWith('org-1', 'nordvpn');
  });

  // 1.1: the write version is validated through resolveWriteVersion.
  it('validates the version through resolveWriteVersion on upsert', async () => {
    await service.upsert('org-1', 'nordvpn', {
      credentials: { serviceCredentials: 'user:pass' },
    });
    // 1.4: no existing config row here → no currentVersion passed (4th arg undefined).
    expect(resolution.resolveWriteVersion).toHaveBeenCalledWith('vpn', 'nordvpn', undefined, undefined);
  });

  it('propagates a resolveWriteVersion rejection (deprecated/unknown version)', async () => {
    (resolution.resolveWriteVersion as any).mockImplementation(() => {
      throw new Error('version deprecated for write');
    });
    await expect(
      service.upsert('org-1', 'nordvpn', { credentials: { serviceCredentials: 'user:pass' } }),
    ).rejects.toThrow('deprecated');
  });

  // 1.3a: kernel cache invalidation on upsert + delete.
  it('invalidates the resolution cache on upsert', async () => {
    await service.upsert('org-1', 'nordvpn', { credentials: { serviceCredentials: 'user:pass' } });
    expect(resolution.invalidate).toHaveBeenCalledWith('vpn', 'nordvpn', 'org-1');
  });

  it('invalidates the resolution cache on delete', async () => {
    await service.delete('org-1', 'nordvpn');
    expect(resolution.invalidate).toHaveBeenCalledWith('vpn', 'nordvpn', 'org-1');
  });

  // 3.7: deleting a VPN provider clears orphaned channel vpnSelection rows.
  describe('delete clears orphaned channel VPN selections (3.7)', () => {
    it('nulls vpnSelection on channels that referenced the deleted provider', async () => {
      (channelConfigRepository.getByOrg as any).mockResolvedValue([
        { id: 'ch-1', vpnSelection: JSON.stringify({ enabled: true, identifier: 'nordvpn', regionId: 'us-atlanta' }) },
        { id: 'ch-2', vpnSelection: JSON.stringify({ enabled: true, identifier: 'surfshark', regionId: 'x' }) },
        { id: 'ch-3', vpnSelection: null },
      ]);
      await service.delete('org-1', 'nordvpn');
      expect(channelConfigRepository.updateById).toHaveBeenCalledTimes(1);
      expect(channelConfigRepository.updateById).toHaveBeenCalledWith('org-1', 'ch-1', { vpnSelection: null });
    });

    it('is non-fatal when clearing selections throws', async () => {
      (channelConfigRepository.getByOrg as any).mockRejectedValue(new Error('db down'));
      await expect(service.delete('org-1', 'nordvpn')).resolves.toBeDefined();
      expect(repository.delete).toHaveBeenCalledWith('org-1', 'nordvpn');
    });

    it('does not touch channels selecting a different provider', async () => {
      (channelConfigRepository.getByOrg as any).mockResolvedValue([
        { id: 'ch-2', vpnSelection: JSON.stringify({ enabled: true, identifier: 'surfshark', regionId: 'x' }) },
      ]);
      await service.delete('org-1', 'nordvpn');
      expect(channelConfigRepository.updateById).not.toHaveBeenCalled();
    });
  });

  describe('regions', () => {
    const enabledRow = {
      id: 'cfg-1',
      organizationId: 'org-1',
      identifier: 'nordvpn',
      name: null,
      credentials: `enc:{"serviceCredentials":"user:pass"}`,
      regions: JSON.stringify(['us-atlanta', 'nl-amsterdam']),
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    it('lists enabled provider×region combos with labels', async () => {
      vi.spyOn(repository, 'getByOrg').mockResolvedValue([enabledRow]);
      const list = await service.listEnabledRegions('org-1');
      expect(list).toHaveLength(2);
      expect(list.map((r) => r.regionId).sort()).toEqual(['nl-amsterdam', 'us-atlanta']);
      expect(list[0].providerName).toBe('NordVPN');
      expect(list.find((r) => r.regionId === 'us-atlanta')?.regionLabel).toContain('Atlanta');
    });

    it('excludes a disabled provider from enabled regions', async () => {
      vi.spyOn(repository, 'getByOrg').mockResolvedValue([{ ...enabledRow, enabled: false }]);
      expect(await service.listEnabledRegions('org-1')).toHaveLength(0);
    });

    it('drops enabled region ids no longer in the adapter catalog', async () => {
      vi.spyOn(repository, 'getByOrg').mockResolvedValue([
        { ...enabledRow, regions: JSON.stringify(['us-atlanta', 'ghost-region']) },
      ]);
      const providers = await service.getProviders('org-1');
      const nord = providers.find((p) => p.identifier === 'nordvpn')!;
      expect(nord.enabledRegions).toEqual(['us-atlanta']);
      expect(nord.proxyRegions.length).toBeGreaterThan(0);
    });

    it('resolves a selected region into region + auth + fingerprint', async () => {
      vi.spyOn(repository, 'getByIdentifier').mockResolvedValue(enabledRow);
      const resolved = await service.resolveProxyForChannel('org-1', 'nordvpn', 'us-atlanta');
      expect(resolved).not.toBeNull();
      expect(resolved!.region.host).toContain('atlanta');
      expect(resolved!.auth).toEqual({ username: 'user', password: 'pass' });
      expect(resolved!.credsFingerprint).toMatch(/^[a-f0-9]{64}$/);
    });

    it('returns null for a region the org did not enable', async () => {
      vi.spyOn(repository, 'getByIdentifier').mockResolvedValue(enabledRow);
      expect(await service.resolveProxyForChannel('org-1', 'nordvpn', 'se-stockholm')).toBeNull();
    });

    it('returns null when the provider is disabled', async () => {
      vi.spyOn(repository, 'getByIdentifier').mockResolvedValue({ ...enabledRow, enabled: false });
      expect(await service.resolveProxyForChannel('org-1', 'nordvpn', 'us-atlanta')).toBeNull();
    });

    it('invalidates pooled dispatchers on upsert', async () => {
      await service.upsert('org-1', 'nordvpn', { regions: ['us-atlanta'] });
      expect(dispatcher.invalidate).toHaveBeenCalledWith('org-1', 'nordvpn');
    });
  });

  describe('custom proxy (dynamic regions)', () => {
    const customRow = {
      id: 'cfg-custom',
      organizationId: 'org-1',
      identifier: 'custom',
      name: null,
      credentials: `enc:${JSON.stringify({
        label: 'Office VPN',
        host: 'proxy.acme.example',
        port: '1080',
        protocol: 'socks5',
        username: 'me',
        password: 'pw',
      })}`,
      regions: null,
      enabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as any;

    it('derives a single region from the stored endpoint and auto-enables it', async () => {
      vi.spyOn(repository, 'getByOrg').mockResolvedValue([customRow]);
      const providers = await service.getProviders('org-1');
      const custom = providers.find((p) => p.identifier === 'custom')!;
      expect(custom.isDynamicRegions).toBe(true);
      expect(custom.proxyRegions).toHaveLength(1);
      expect(custom.proxyRegions[0].label).toBe('Office VPN');
      expect(custom.enabledRegions).toEqual(['custom']);
    });

    it('lists the derived region without any stored region toggle', async () => {
      vi.spyOn(repository, 'getByOrg').mockResolvedValue([customRow]);
      const list = await service.listEnabledRegions('org-1');
      expect(list).toEqual([
        { identifier: 'custom', providerName: 'Custom VPN / Proxy', regionId: 'custom', regionLabel: 'Office VPN' },
      ]);
    });

    it('resolves the custom endpoint + auth for a channel', async () => {
      vi.spyOn(repository, 'getByIdentifier').mockResolvedValue(customRow);
      const resolved = await service.resolveProxyForChannel('org-1', 'custom', 'custom');
      expect(resolved!.region.host).toBe('proxy.acme.example');
      expect(resolved!.region.protocol).toBe('socks5');
      expect(resolved!.auth).toEqual({ username: 'me', password: 'pw' });
    });

    it('supports a no-auth custom proxy', async () => {
      const noAuth = {
        ...customRow,
        credentials: `enc:${JSON.stringify({
          label: 'Open proxy',
          host: 'proxy.acme.example',
          port: '8080',
          protocol: 'http-connect',
        })}`,
      };
      vi.spyOn(repository, 'getByIdentifier').mockResolvedValue(noAuth);
      const resolved = await service.resolveProxyForChannel('org-1', 'custom', 'custom');
      expect(resolved!.auth).toEqual({ username: '', password: '' });
      expect(resolved!.region.protocol).toBe('http-connect');
    });

    // 0.2: testConnection must SSRF-validate the org-supplied proxy host before the
    // adapter opens a raw TCP socket — otherwise "Test connection" becomes an
    // internal reachability / port-scan oracle (cloud metadata, internal ports).
    it('blocks a link-local / metadata proxy host in testConnection without probing', async () => {
      const metadataRow = {
        ...customRow,
        credentials: `enc:${JSON.stringify({
          label: 'evil',
          host: '169.254.169.254',
          port: '80',
          protocol: 'http-connect',
        })}`,
      };
      vi.spyOn(repository, 'getByIdentifier').mockResolvedValue(metadataRow);

      const result = await service.testConnection('org-1', 'custom');
      expect(result).toEqual({
        ok: false,
        error: 'Proxy host is not a permitted public address.',
      });
    });
  });
});
