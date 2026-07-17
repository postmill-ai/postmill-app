'use client';

import React, { useCallback, useMemo, useState } from 'react';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import ProviderIcon from '@gitroom/frontend/components/shared/provider-icon';
import ProviderListShell, {
  ProviderConfigItem,
} from '@gitroom/frontend/components/settings/shared/provider-list-shell';
import { useProviderCatalog } from '@gitroom/frontend/components/settings/shared/use-provider-catalog';
import { ProviderInfoModal } from '@gitroom/frontend/components/settings/shared/provider-info-modal';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { ProviderSurfaceDescriptor, ProviderRow } from './provider-surface.types';
import { useProviderSurface } from './use-provider-surface';
import { ProviderSearchToolbar } from './provider-search-toolbar';
import { CapabilityBadges } from './capabilities';
import { ProviderConfigForm } from './provider-config-form';

/**
 * Top-level surface component (plan Step 1.7). Composes the surface hook + sort
 * (configured → primary → alpha) + filter (search + capability chips) +
 * toolbar + ProviderListShell + the generic config form. The list actions row
 * is uniform: On/Off toggle + Make Primary (when enabled & not primary) +
 * Remove, with a Primary badge replacing the old "Active" pill.
 *
 *   export const ShortlinksTab = () => (
 *     <ProviderSettingsPanel descriptor={shortlinksDescriptor} />
 *   );
 */
export interface ProviderSettingsPanelProps<Meta = any> {
  descriptor: ProviderSurfaceDescriptor<Meta>;
  /** Optional extra return-handler the surface mounts (e.g. OAuth). Rendered as-is. */
  children?: React.ReactNode;
  /** Hide the title/description block (the tab supplies its own chrome). */
  hideHeader?: boolean;
  /** Initial search query (e.g. a `?search=` deep-link prefill). */
  initialSearch?: string;
  /** Fired whenever a provider is saved / removed / activated / toggled — lets a
   *  parent (e.g. the setup wizard) react without polling. */
  onChange?: () => void;
}

export function ProviderSettingsPanel<Meta = any>({
  descriptor,
  children,
  hideHeader,
  initialSearch,
  onChange,
}: ProviderSettingsPanelProps<Meta>) {
  const t = useT();
  const surface = useProviderSurface<Meta>(descriptor);
  const { data, error, mutate, setPrimary, toggle, remove, save, test } = surface;

  // Revalidate the local list AND notify the parent (event-driven — no polling).
  const refresh = useCallback(() => {
    mutate();
    onChange?.();
  }, [mutate, onChange]);
  const { data: catalog } = useProviderCatalog(descriptor.catalogDomain);
  const { openModal } = useModals();

  // Clicking a provider name opens a minimal "what is this?" modal with the
  // provider's localized description + website link (from the catalog).
  const openProviderInfo = useCallback(
    (item: ProviderConfigItem) => {
      const entry = catalog?.find(
        (e) => e.providerId === item.identifier && e.version === item.version,
      );
      const href = descriptor.getProviderHref?.(item.meta as ProviderRow<Meta>);
      openModal({
        title: t('about_provider', 'About this provider'),
        withCloseButton: true,
        center: true,
        children: <ProviderInfoModal entry={entry} href={href} />,
      });
    },
    [catalog, descriptor, openModal, t],
  );

  const [search, setSearch] = useState(initialSearch ?? '');
  const [selectedCaps, setSelectedCaps] = useState<string[]>([]);
  const [configuring, setConfiguring] = useState<string | null>(null);

  const rows = useMemo(() => data?.rows ?? [], [data]);

  // Platform-curated "featured" providers (from the catalog projection), keyed by
  // providerId → sortOrder. The catalog is already scoped to this surface's domain,
  // so providerId is an unambiguous key here.
  const featuredById = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of catalog ?? []) {
      if (e.featured) m.set(e.providerId, e.featuredSortOrder ?? 0);
    }
    return m;
  }, [catalog]);

  const matchesCap = useCallback(
    (row: ProviderRow<Meta>, key: string) =>
      descriptor.rowMatchesCapability
        ? descriptor.rowMatchesCapability(row, key)
        : row.capabilities.includes(key),
    [descriptor],
  );

  // Tier order: configured (primary first) → featured (by sortOrder) → alphabetical.
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        if (a.isConfigured !== b.isConfigured) return a.isConfigured ? -1 : 1;
        if (a.isConfigured) {
          if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
          return a.name.localeCompare(b.name);
        }
        const fa = featuredById.has(a.identifier);
        const fb = featuredById.has(b.identifier);
        if (fa !== fb) return fa ? -1 : 1;
        if (fa && fb) {
          return featuredById.get(a.identifier)! - featuredById.get(b.identifier)!;
        }
        return a.name.localeCompare(b.name);
      }),
    [rows, featuredById],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sorted.filter((p) => {
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !p.identifier.toLowerCase().includes(q)
      ) {
        return false;
      }
      if (selectedCaps.length && !selectedCaps.some((c) => matchesCap(p, c))) {
        return false;
      }
      return true;
    });
  }, [sorted, search, selectedCaps, matchesCap]);

  // Tier of a rendered row: configured → featured → rest. Used to draw a thin
  // divider that brackets the featured group (above it only when configured rows
  // precede it; below it before the alphabetized rest).
  const tierOf = useCallback(
    (p: ProviderRow<Meta>): 'configured' | 'featured' | 'rest' =>
      p.isConfigured
        ? 'configured'
        : featuredById.has(p.identifier)
          ? 'featured'
          : 'rest',
    [featuredById],
  );

  const shellItems: ProviderConfigItem[] = useMemo(
    () =>
      filtered.map((p, i) => {
        const catalogEntry = catalog?.find(
          (e) => e.providerId === p.identifier && e.version === p.version,
        );
        const tier = tierOf(p);
        const prevTier = i > 0 ? tierOf(filtered[i - 1]) : undefined;
        const separatorBefore =
          (tier === 'featured' && prevTier === 'configured') ||
          (tier === 'rest' && prevTier === 'featured');
        return {
          id: p.id,
          identifier: p.identifier,
          name: p.name,
          enabled: p.enabled,
          isConfigured: p.isConfigured,
          // Primary is rendered as a custom badge below, not the shell "Active" pill.
          isActive: false,
          capabilities: p.capabilities,
          version: p.version,
          versionStatus: p.versionStatus ?? catalogEntry?.status ?? 'active',
          // Beta badge (workstream E24): false = built without a live key.
          verified: catalogEntry?.verified,
          // Featured badge (gold star) on the name line — platform curation.
          featured: featuredById.has(p.identifier),
          separatorBefore,
          sunsetAt: p.sunsetAt ?? catalogEntry?.sunsetAt,
          meta: p,
        };
      }),
    [filtered, catalog, featuredById, tierOf],
  );

  const rowByIdentifier = useCallback(
    (identifier: string) => filtered.find((p) => p.identifier === identifier),
    [filtered],
  );

  const toggleChip = useCallback(
    (key: string) =>
      setSelectedCaps((prev) =>
        prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key],
      ),
    [],
  );

  if (error) {
    return (
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px] p-[24px] flex flex-col items-center gap-[12px]">
        <span className="text-[14px] text-red-500">
          {t('failed_to_load_settings', 'Failed to load settings')}
        </span>
        <button
          className="text-[13px] bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[16px] py-[8px] hover:bg-boxHover transition-colors"
          onClick={() => window.location.reload()}
        >
          {t('try_again', 'Try again')}
        </button>
      </div>
    );
  }

  if (configuring) {
    const row = rowByIdentifier(configuring);
    const configEntry = catalog?.find(
      (e) => e.providerId === configuring && e.version === row?.version,
    );
    return (
      <div className="flex flex-col gap-[16px]">
        {children}
        <ProviderConfigForm
          descriptor={descriptor}
          identifier={configuring}
          isConfigured={row?.isConfigured ?? false}
          initialVersion={row?.version}
          meta={row?.meta}
          website={configEntry?.website}
          onClose={() => setConfiguring(null)}
          onSaved={() => {
            setConfiguring(null);
            refresh();
          }}
          onRemoved={() => {
            setConfiguring(null);
            refresh();
          }}
          save={save}
          test={test}
          remove={remove}
        />
      </div>
    );
  }

  const primaryEnabled = descriptor.features.primary !== false;
  const toggleEnabled = descriptor.features.toggle === true;
  const toggleLabel = descriptor.features.toggleLabel;

  return (
    <div className="flex flex-col gap-[16px]">
      {children}
      <ProviderListShell
        title={
          hideHeader
            ? ''
            : descriptor.titleKey
              ? t(descriptor.titleKey, descriptor.title)
              : t(`provider_title_${descriptor.key}`, descriptor.title)
        }
        description={
          hideHeader
            ? undefined
            : descriptor.descriptionKey
              ? t(descriptor.descriptionKey, descriptor.description ?? '')
              : t(
                  `provider_description_${descriptor.key}`,
                  descriptor.description ?? '',
                )
        }
        toolbar={
          descriptor.filter.search ? (
            <ProviderSearchToolbar
              search={search}
              onSearch={setSearch}
              chips={descriptor.filter.capabilityChips}
              selected={selectedCaps}
              onToggleChip={toggleChip}
            />
          ) : undefined
        }
        providers={shellItems}
        onConfigure={(id) => setConfiguring(id)}
        onRemove={(id) => remove(id).then((ok) => ok && refresh())}
        ProviderIconComponent={ProviderIcon}
        getProviderHref={
          descriptor.getProviderHref
            ? (item) =>
                descriptor.getProviderHref!((item.meta as ProviderRow<Meta>) ?? (item as any))
            : undefined
        }
        onProviderNameClick={openProviderInfo}
        renderBadges={(item) => {
          const row = item.meta as ProviderRow<Meta>;
          return (
            <CapabilityBadges
              keys={item.capabilities ?? []}
              meta={descriptor.capabilityMeta}
              leading={
                primaryEnabled && row?.isPrimary ? (
                  <span className="text-[10px] rounded-[4px] px-[6px] py-[2px] bg-green-900/20 text-green-900 dark:text-green-400">
                    {t('primary', 'Primary')}
                  </span>
                ) : undefined
              }
            />
          );
        }}
        renderActions={(item) => {
          const row = item.meta as ProviderRow<Meta>;
          return (
            <>
              <button
                className="text-[12px] text-btnPrimaryAccent hover:underline"
                onClick={() => setConfiguring(item.identifier)}
              >
                {row?.isConfigured ? t('edit', 'Edit') : t('configure', 'Configure')}
              </button>
              {primaryEnabled &&
                row?.isConfigured &&
                row?.enabled &&
                !row?.isPrimary && (
                  <button
                    className="text-[12px] text-btnPrimaryAccent hover:underline"
                    onClick={() =>
                      setPrimary(item.identifier, row?.version).then(
                        (ok) => ok && onChange?.(),
                      )
                    }
                  >
                    {t('make_primary', 'Make Primary')}
                  </button>
                )}
              {descriptor.renderExtraActions?.(row, {
                configure: (id) => setConfiguring(id),
              })}
              {toggleEnabled && row?.isConfigured && (
                <label className="flex items-center gap-[4px] cursor-pointer">
                  <span className="text-[11px] text-newTableText">
                    {row.enabled
                      ? toggleLabel?.on ?? t('on', 'On')
                      : toggleLabel?.off ?? t('off', 'Off')}
                  </span>
                  <input
                    type="checkbox"
                    className="accent-btnPrimary w-[14px] h-[14px]"
                    checked={row.enabled}
                    onChange={(e) =>
                      toggle(item.identifier, e.target.checked).then(
                        (ok) => ok && onChange?.(),
                      )
                    }
                  />
                </label>
              )}
              {row?.isConfigured && descriptor.features.remove !== false && (
                <button
                  className="text-[12px] text-red-600 dark:text-red-500 hover:underline"
                  onClick={() => remove(item.identifier).then((ok) => ok && refresh())}
                >
                  {t('remove', 'Remove')}
                </button>
              )}
            </>
          );
        }}
      />
    </div>
  );
}
