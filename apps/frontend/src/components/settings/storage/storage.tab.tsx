'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import useSWR from 'swr';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';
import { useToaster } from '@gitroom/react/toaster/toaster';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import ProviderListShell from '@gitroom/frontend/components/settings/shared/provider-list-shell';
import { useProviderCatalog } from '@gitroom/frontend/components/settings/shared/use-provider-catalog';
import { ProviderFormModal } from '@gitroom/frontend/components/settings/storage/provider-form.modal';
import { MigrationModal } from '@gitroom/frontend/components/settings/storage/migration.modal';
import { AuditTab } from '@gitroom/frontend/components/settings/storage/audit.tab';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
};

export interface StorageProviderRow {
  id: string;
  organizationId: string;
  type: string;
  name: string;
  version?: string;
  region: string | null;
  bucket: string | null;
  endpoint: string | null;
  publicUrl: string | null;
  mounted: boolean;
  quotaBytes: number | null;
  createdAt: string;
  updatedAt: string;
}

interface StorageUsageResponse {
  totalBytes: number;
  quotaBytes: number;
  providers: Array<{ id: string; name: string; usageBytes: number | null }>;
}

interface QuotaStatusResponse {
  usedBytes: number;
  quotaBytes: number;
  percentUsed: number;
  warning: boolean;
}

interface UsageBreakdownResponse {
  byFolder: Array<{ folderId: string; folderName: string; totalBytes: number }>;
  byProvider: Array<{ providerId: string; providerName: string; totalBytes: number }>;
}

const useStorageProviders = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/storage');
    if (!res.ok) throw createFetchError('failed_to_load_storage_providers', 'Failed to load storage providers');
    return res.json();
  }, [fetch]);
  return useSWR<StorageProviderRow[]>('storage-providers', load, { revalidateOnFocus: false });
};

const useStorageUsage = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/storage/usage');
    if (!res.ok) throw createFetchError('failed_to_load_storage_usage', 'Failed to load storage usage');
    return res.json();
  }, [fetch]);
  return useSWR<StorageUsageResponse>('storage-usage', load, { revalidateOnFocus: false });
};

const useQuotaStatus = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/storage/quota-status');
    if (!res.ok) throw createFetchError('failed_to_load_quota_status', 'Failed to load quota status');
    return res.json();
  }, [fetch]);
  return useSWR<QuotaStatusResponse>('storage-quota-status', load, { revalidateOnFocus: false });
};

const useUsageBreakdown = () => {
  const fetch = useFetch();
  const load = useCallback(async () => {
    const res = await fetch('/settings/storage/usage-breakdown');
    if (!res.ok) throw createFetchError('failed_to_load_usage_breakdown', 'Failed to load usage breakdown');
    return res.json();
  }, [fetch]);
  return useSWR<UsageBreakdownResponse>('storage-usage-breakdown', load, { revalidateOnFocus: false });
};

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  LOCAL: 'Local Storage',
  S3: 'AWS S3',
  CLOUDFLARE_R2: 'Cloudflare R2',
  BACKBLAZE_B2: 'Backblaze B2',
  IDRIVE_E2: 'IDrive e2',
  WASABI: 'Wasabi',
  DIGITALOCEAN_SPACES: 'DigitalOcean Spaces',
  HETZNER: 'Hetzner Object Storage',
  STORJ: 'Storj',
  SCALEWAY: 'Scaleway',
  VULTR: 'Vultr Object Storage',
  LINODE: 'Linode / Akamai',
  S3_COMPATIBLE: 'S3-Compatible',
  MEDIALOCKER: 'MediaLocker',
};

type SubTab = 'providers' | 'audit' | 'breakdown';

const CLOUD_TYPES = [
  'S3',
  'CLOUDFLARE_R2',
  'BACKBLAZE_B2',
  'IDRIVE_E2',
  'WASABI',
  'DIGITALOCEAN_SPACES',
  'HETZNER',
  'STORJ',
  'SCALEWAY',
  'VULTR',
  'LINODE',
  'S3_COMPATIBLE',
  'MEDIALOCKER',
];

export const StorageTab: React.FC<{ activeSubTab?: SubTab }> = ({
  activeSubTab = 'providers',
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();

  const { data: providers, mutate: mutateProviders } = useStorageProviders();
  const { data: catalog } = useProviderCatalog('storage');
  const { data: usage, mutate: mutateUsage } = useStorageUsage();
  const { data: quotaStatus, mutate: mutateQuota } = useQuotaStatus();
  const { data: usageBreakdown, mutate: mutateBreakdown } = useUsageBreakdown();

  // The sub-tab is driven by the route (/settings/storage/{providers,audit,usage}); the nav
  // strip lives in the storage layout, not here.
  const subTab = activeSubTab;
  const [showModal, setShowModal] = useState(false);
  const [editProvider, setEditProvider] = useState<StorageProviderRow | null>(null);
  const [presetType, setPresetType] = useState<string | undefined>(undefined);
  const [migrateSource, setMigrateSource] = useState<StorageProviderRow | null>(null);

  const usageMap: Record<string, number> = {};
  if (usage?.providers) {
    for (const p of usage.providers) {
      if (p.usageBytes !== null) {
        usageMap[p.id] = p.usageBytes;
      }
    }
  }

  const refresh = useCallback(() => {
    mutateProviders();
    mutateUsage();
    mutateQuota();
    mutateBreakdown();
  }, [mutateProviders, mutateUsage, mutateQuota, mutateBreakdown]);

  const handleMount = useCallback(async (id: string) => {
    const res = await fetch('/settings/storage/' + id + '/mount', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toaster.show(
        body?.message || t('failed_to_mount_storage_provider', 'Failed to mount storage provider'),
        'warning',
      );
      return;
    }
    refresh();
    toaster.show(t('storage_provider_mounted', 'Storage provider mounted'), 'success');
  }, [fetch, refresh, toaster, t]);

  const handleUnmount = useCallback(async (id: string) => {
    const res = await fetch('/settings/storage/' + id + '/unmount', { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      toaster.show(
        body?.message || t('failed_to_unmount_storage_provider', 'Failed to unmount storage provider'),
        'warning',
      );
      return;
    }
    refresh();
    toaster.show(t('storage_provider_unmounted', 'Storage provider unmounted'), 'success');
  }, [fetch, refresh, toaster, t]);

  const handleDelete = useCallback(async (id: string) => {
    const confirmed = await deleteDialog(
      t(
        'confirm_delete_storage_provider',
        'Are you sure you want to delete this storage provider?',
      ),
      t('delete_storage_provider', 'Delete Storage Provider'),
      t('delete', 'Delete'),
    );
    if (!confirmed) return;

    const res = await fetch('/settings/storage/' + id, { method: 'DELETE' });
    if (res.ok) {
      refresh();
      toaster.show(t('storage_provider_deleted', 'Storage provider deleted'), 'success');
    } else {
      toaster.show(t('failed_to_delete_storage_provider', 'Failed to delete storage provider'), 'warning');
    }
  }, [fetch, refresh, toaster, t]);

  const handleTest = useCallback(async (id: string) => {
    const res = await fetch('/settings/storage/' + id + '/test', { method: 'POST' });
    const data = await res.json();
    if (data.ok) {
      toaster.show(t('connection_test_successful', 'Connection test successful!'), 'success');
    } else {
      toaster.show(
        t('connection_test_failed_reason', 'Connection test failed: {{reason}}', {
          reason: data.error || t('unknown_error', 'Unknown error'),
        }),
        'warning',
      );
    }
  }, [fetch, toaster, t]);

  const handleSaved = useCallback(() => {
    setShowModal(false);
    setEditProvider(null);
    setPresetType(undefined);
    refresh();
  }, [refresh]);

  const otherProviders = (providers || []).filter((p) => p.type !== 'LOCAL');
  const localProvider = (providers || []).find((p) => p.type === 'LOCAL');
  const configuredInstances = [...otherProviders].sort((a, b) => a.name.localeCompare(b.name));
  const instanceMap = new Map(configuredInstances.map((p) => [p.id, p]));

  const handleAdd = useCallback((type?: string) => {
    setEditProvider(null);
    setPresetType(type);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((p: StorageProviderRow) => {
    setEditProvider(p);
    setPresetType(undefined);
    setShowModal(true);
  }, []);

  const storageTypeToKernelId = (type: string) => type.toLowerCase().replace(/_/g, '');

  // Platform-curated "featured" providers (from the catalog projection), keyed by
  // providerId → sortOrder. The catalog is already scoped to the storage domain,
  // so providerId is an unambiguous key (ported from provider-settings-panel.tsx).
  const featuredById = new Map<string, number>();
  for (const e of catalog ?? []) {
    if (e.featured) featuredById.set(e.providerId, e.featuredSortOrder ?? 0);
  }

  // A single inline list: local pinned to the very top, then configured cloud
  // instances (pinned), then one always-present "add another" row per cloud
  // provider type so the same provider can be configured again.
  const shellProviders = [
    ...(localProvider
      ? [{
          id: localProvider.id,
          identifier: 'local',
          name: t('postmill_storage', 'Postmill Storage'),
          enabled: true,
          version: localProvider.version ?? 'v1',
        }]
      : []),
    ...configuredInstances.map((p) => ({
      id: p.id,
      identifier: p.type,
      name: p.name,
      enabled: true,
      mounted: p.mounted,
      version: p.version ?? 'v1',
    })),
    ...[...CLOUD_TYPES]
      .sort((a, b) =>
        (PROVIDER_TYPE_LABELS[a] || a).localeCompare(PROVIDER_TYPE_LABELS[b] || b)
      )
      .map((type) => ({
        id: `template-${type}`,
        identifier: type,
        name: t('storage_type_' + type, PROVIDER_TYPE_LABELS[type] || type),
        enabled: false,
        version: 'v1',
      })),
  ]
    .map((p) => {
      const kernelId = storageTypeToKernelId(p.identifier);
      const catalogEntry = catalog?.find(
        (e) => e.providerId === kernelId && e.version === p.version
      );
      return {
        ...p,
        versionStatus: catalogEntry?.status ?? 'active',
        featured: featuredById.has(kernelId),
        featuredSortOrder: featuredById.get(kernelId) ?? 0,
      };
    })
    // Ordering mirrors the shared ProviderSettingsPanel: local pinned top, then
    // CONFIGURED instances, then unconfigured "add" rows — and featured floats
    // to the front *within* its tier. A featured but unconfigured template must
    // NOT leapfrog a provider the org has actually configured. Array#sort is
    // stable, so ties keep their existing order (instances by name, templates
    // by label).
    .sort((a, b) => {
      if ((a.identifier === 'local') !== (b.identifier === 'local')) {
        return a.identifier === 'local' ? -1 : 1;
      }
      // configured (enabled) rows above unconfigured "add another" rows
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      if (a.featured && b.featured) {
        return a.featuredSortOrder - b.featuredSortOrder;
      }
      return 0;
    });

  const usageBar = (usageBytes: number | null, quotaBytes: number | null) => {
    const percent =
      quotaBytes && usageBytes !== null && quotaBytes > 0
        ? Math.round((usageBytes / quotaBytes) * 100)
        : null;
    return (
      <div className="flex flex-col gap-[4px] mt-[4px]">
        <span className="text-[12px] text-newTableText">
          {usageBytes !== null ? formatBytes(usageBytes) : '—'}
          {quotaBytes ? ` / ${formatBytes(quotaBytes)}` : ''}
        </span>
        {percent !== null && (
          <div className="flex items-center gap-[6px]">
            <div className="w-[80px] bg-newTableHeader rounded-[2px] h-[4px] overflow-hidden">
              <div
                className={`h-full rounded-[2px] ${
                  percent >= 90 ? 'bg-[#ef4444]' : percent >= 80 ? 'bg-[#f59e0b]' : 'bg-btnPrimary'
                }`}
                style={{ width: `${Math.min(percent, 100)}%` }}
              />
            </div>
            <span className="text-[10px] text-newTableText">{percent}%</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-[16px]">
      {/* Quota warning banner */}
      {quotaStatus?.warning && (
        <div className="px-[16px] py-[12px] rounded-[8px] bg-[#2a2a1a] border border-[#f59e0b] text-[#f59e0b] text-[13px]">
          {t(
            'storage_quota_warning',
            "⚠️ You're using {{percent}}% of your storage quota ({{used}} / {{quota}})",
            {
              percent: quotaStatus.percentUsed,
              used: formatBytes(quotaStatus.usedBytes),
              quota: formatBytes(quotaStatus.quotaBytes),
            },
          )}
        </div>
      )}

      {subTab === 'providers' && (
        <div className="flex flex-col gap-[16px]">
          <div className="flex flex-col gap-[4px]">
            <h3 className="text-[18px] font-semibold text-textColor">
              {t('storage_providers', 'Storage Providers')}
            </h3>
            <p className="text-[13px] text-newTableText max-w-[640px]">
              {t(
                'storage_providers_description',
                'See and manage where your files are stored. Mount a provider to make it active.'
              )}
            </p>
          </div>
          <ProviderListShell
            title=""
            providers={shellProviders}
          onConfigure={(id) => {
            const p = instanceMap.get(id);
            if (p) openEdit(p);
          }}
          onRemove={(id) => handleDelete(id)}
          ProviderIconComponent={ProviderIcon}
          renderBadges={(provider) => {
            if (localProvider && provider.id === localProvider.id) {
              return usageBar(quotaStatus?.usedBytes ?? null, quotaStatus?.quotaBytes ?? null);
            }
            const p = instanceMap.get(provider.id);
            if (p) {
              return (
                <div className="flex flex-col gap-[2px]">
                  <span className="text-[12px] text-newTableText">
                    {t('storage_type_' + p.type, PROVIDER_TYPE_LABELS[p.type] || p.type)}
                    {p.bucket ? ` · ${p.bucket}` : ''}
                    {p.region ? ` · ${p.region}` : ''}
                  </span>
                  {usageBar(usageMap[p.id] ?? null, p.quotaBytes)}
                </div>
              );
            }
            // Template row
            return (
              <span className="text-[12px] text-newTableText">
                {t('not_configured_add_another', 'Not configured — add a bucket')}
              </span>
            );
          }}
          renderActions={(provider) => {
            if (localProvider && provider.id === localProvider.id) {
              return (
                <>
                  <button onClick={() => openEdit(localProvider)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-newTableText hover:bg-[#3a3a3a] transition-colors">
                    {t('edit', 'Edit')}
                  </button>
                  <button onClick={() => handleTest(localProvider.id)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-blue-700 dark:text-blue-400 hover:bg-[#1a2a3a] transition-colors">
                    {t('test', 'Test')}
                  </button>
                </>
              );
            }
            const p = instanceMap.get(provider.id);
            if (p) {
              return (
                <>
                  {p.mounted ? (
                    <button onClick={() => handleUnmount(p.id)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-[#f87171] hover:bg-[#3a2a2a] transition-colors">
                      {t('unmount', 'Unmount')}
                    </button>
                  ) : (
                    <button onClick={() => handleMount(p.id)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-textColor hover:bg-[#1a3a1a] transition-colors">
                      {t('mount', 'Mount')}
                    </button>
                  )}
                  <button onClick={() => openEdit(p)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-newTableText hover:bg-[#3a3a3a] transition-colors">
                    {t('edit', 'Edit')}
                  </button>
                  <button onClick={() => handleTest(p.id)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-blue-700 dark:text-blue-400 hover:bg-[#1a2a3a] transition-colors">
                    {t('test', 'Test')}
                  </button>
                  {configuredInstances.length > 1 && (
                    <button onClick={() => setMigrateSource(p)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-[#f59e0b] hover:bg-[#3a2a1a] transition-colors">
                      {t('migrate', 'Migrate')}
                    </button>
                  )}
                  <button onClick={() => handleDelete(p.id)} className="text-[11px] px-[8px] py-[4px] rounded-[6px] bg-newTableHeader text-[#f87171] hover:bg-[#3a1a1a] transition-colors">
                    {t('delete', 'Delete')}
                  </button>
                </>
              );
            }
            // Template row — configure another instance of this provider type.
            const type = provider.id.replace('template-', '');
            return (
              <button onClick={() => handleAdd(type)} className="text-[12px] text-btnPrimaryAccent hover:underline">
                {t('configure', 'Configure')}
              </button>
            );
          }}
          />
        </div>
      )}

      {subTab === 'audit' && (
        <div className="flex flex-col gap-[16px]">
          <p className="text-[13px] text-newTableText max-w-[640px]">
            {t(
              'storage_audit_description',
              'Review recent changes to your storage, like mounts and migrations.'
            )}
          </p>
          <AuditTab />
        </div>
      )}

      {subTab === 'breakdown' && (
        <div className="flex flex-col gap-[20px]">
          <div className="flex flex-col gap-[4px]">
            <h3 className="text-[18px] font-semibold text-textColor">{t('usage_breakdown', 'Usage Breakdown')}</h3>
            <p className="text-[13px] text-newTableText max-w-[640px]">
              {t(
                'storage_usage_description',
                'Check how much storage you are using and which folders use the most space.'
              )}
            </p>
          </div>
          {usageBreakdown ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[20px]">
              <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px] flex flex-col gap-[12px]">
                <h4 className="text-[14px] text-textColor font-medium">{t('by_folder', 'By Folder')}</h4>
                {usageBreakdown.byFolder?.length > 0 ? (
                  <div className="space-y-[6px]">
                    {usageBreakdown.byFolder.map((folder: any) => (
                      <div key={folder.folderId} className="flex items-center justify-between text-[13px]">
                        <span className="text-textColor">{folder.folderName}</span>
                        <span className="text-newTableText">{formatBytes(folder.totalBytes)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-newTableText">{t('no_data', 'No data')}</div>
                )}
              </div>
              <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[20px] flex flex-col gap-[12px]">
                <h4 className="text-[14px] text-textColor font-medium">{t('by_provider', 'By Provider')}</h4>
                {usageBreakdown.byProvider?.length > 0 ? (
                  <div className="space-y-[6px]">
                    {usageBreakdown.byProvider.map((provider: any) => (
                      <div key={provider.providerId} className="flex items-center justify-between text-[13px]">
                        <span className="text-textColor">{provider.providerName}</span>
                        <span className="text-newTableText">{formatBytes(provider.totalBytes)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[13px] text-newTableText">{t('no_data', 'No data')}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="text-[13px] text-newTableText animate-pulse">{t('loading', 'Loading')}</div>
          )}
        </div>
      )}

      {showModal && (
        <ProviderFormModal
          onClose={() => {
            setShowModal(false);
            setEditProvider(null);
            setPresetType(undefined);
          }}
          onSaved={handleSaved}
          editProvider={editProvider}
          presetType={presetType}
        />
      )}

      {migrateSource && (
        <MigrationModal
          source={migrateSource}
          targets={otherProviders.filter((p) => p.id !== migrateSource.id)}
          onClose={() => setMigrateSource(null)}
          onComplete={refresh}
        />
      )}
    </div>
  );
};

