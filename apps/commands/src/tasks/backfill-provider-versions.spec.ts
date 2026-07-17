import { describe, it, expect } from 'vitest';
import { BackfillProviderVersions } from './backfill-provider-versions';

function createMockPrismaService() {
  const store: Record<string, any[]> = {
    AIProviderConfig: [{ id: 'ai-1', version: null }],
    AIOrgProviderConfig: [{ id: 'aiorg-1', version: '' }],
    MediaProviderConfig: [{ id: 'media-1', version: null }],
    AIMediaJob: [{ id: 'job-1', version: '' }],
    StorageProviderConfig: [{ id: 'storage-1', version: null }],
    OrgShortLinkConfig: [{ id: 'shortlinkcfg-1', version: '' }],
    ShortLink: [{ id: 'link-1', providerVersion: null }],
    Integration: [{ id: 'integration-1', providerVersion: '' }],
    OrgProviderConfiguration: [
      {
        id: 'orgprovider-1',
        version: null,
        vpnSelection: JSON.stringify({ enabled: true, identifier: 'nordvpn' }),
      },
    ],
    ProviderConfiguration: [{ id: 'providercfg-1', version: '' }],
    OrgVpnConfig: [{ id: 'vpn-1', version: null }],
    ContentPackConfig: [{ id: 'contentpack-1', version: '' }],
    AuthProviderConfig: [{ id: 'auth-1', version: null }],
    AISystemSettings: [
      { id: 'settings-1', activeProvider: 'openai', fallbackProvider: '', fallbackImageProvider: null, scopeModels: null },
    ],
    Organization: [
      { id: 'org-1', activeContentPackIdentifier: 'adobe-stock' },
      { id: 'org-2', activeContentPackIdentifier: 'vecteezy@v2' },
    ],
  };

  const modelProxy = (modelName: string) => ({
    updateMany: ({ where, data }: { where: any; data: any }) => {
      let updated = 0;
      for (const row of store[modelName] || []) {
        const versionField = data.version !== undefined
          ? 'version'
          : data.providerVersion !== undefined
          ? 'providerVersion'
          : null;
        if (versionField && (row[versionField] === null || row[versionField] === '')) {
          row[versionField] = data[versionField];
          updated++;
        }
      }
      return Promise.resolve({ count: updated });
    },
    findMany: ({ where, select }: { where: any; select: any }) => {
      return Promise.resolve(
        (store[modelName] || []).map((row) => {
          const selected: any = {};
          for (const key of Object.keys(select)) {
            selected[key] = row[key];
          }
          return selected;
        }),
      );
    },
    update: ({ where, data }: { where: { id: string }; data: any }) => {
      const row = (store[modelName] || []).find((r) => r.id === where.id);
      if (!row) return Promise.resolve(row);
      for (const key of Object.keys(data)) {
        row[key] = data[key];
      }
      return Promise.resolve(row);
    },
  });

  const prisma = {
    aIProviderConfig: modelProxy('AIProviderConfig'),
    aIOrgProviderConfig: modelProxy('AIOrgProviderConfig'),
    mediaProviderConfig: modelProxy('MediaProviderConfig'),
    aIMediaJob: modelProxy('AIMediaJob'),
    storageProviderConfig: modelProxy('StorageProviderConfig'),
    orgShortLinkConfig: modelProxy('OrgShortLinkConfig'),
    shortLink: modelProxy('ShortLink'),
    integration: modelProxy('Integration'),
    orgProviderConfiguration: modelProxy('OrgProviderConfiguration'),
    providerConfiguration: modelProxy('ProviderConfiguration'),
    orgVpnConfig: modelProxy('OrgVpnConfig'),
    contentPackConfig: modelProxy('ContentPackConfig'),
    authProviderConfig: modelProxy('AuthProviderConfig'),
    aISystemSettings: modelProxy('AISystemSettings'),
    organization: modelProxy('Organization'),
    $transaction: (ops: any[]) => Promise.all(ops),
  };

  return { prisma, store };
}

describe('BackfillProviderVersions', () => {
  it('backfills null/empty scalar versions to v1 and rewrites bare qualified ids to @v1', async () => {
    const { prisma, store } = createMockPrismaService();
    const command = new BackfillProviderVersions(prisma as any);

    await command.run();

    expect(store.AIProviderConfig[0].version).toBe('v1');
    expect(store.AIOrgProviderConfig[0].version).toBe('v1');
    expect(store.MediaProviderConfig[0].version).toBe('v1');
    expect(store.AIMediaJob[0].version).toBe('v1');
    expect(store.StorageProviderConfig[0].version).toBe('v1');
    expect(store.OrgShortLinkConfig[0].version).toBe('v1');
    expect(store.ShortLink[0].providerVersion).toBe('v1');
    expect(store.Integration[0].providerVersion).toBe('v1');
    expect(store.OrgProviderConfiguration[0].version).toBe('v1');
    expect(store.ProviderConfiguration[0].version).toBe('v1');
    expect(store.OrgVpnConfig[0].version).toBe('v1');
    expect(store.ContentPackConfig[0].version).toBe('v1');
    expect(store.AuthProviderConfig[0].version).toBe('v1');

    expect(store.AISystemSettings[0].activeProvider).toBe('openai@v1');
    expect(store.Organization[0].activeContentPackIdentifier).toBe('adobe-stock@v1');
    expect(store.Organization[1].activeContentPackIdentifier).toBe('vecteezy@v2');

    const vpnSelection = JSON.parse(store.OrgProviderConfiguration[0].vpnSelection);
    expect(vpnSelection.vpnVersion).toBe('v1');
  });
});
