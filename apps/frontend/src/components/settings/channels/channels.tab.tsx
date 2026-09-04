'use client';

import React, { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { createFetchError } from '@postmill-ai/frontend/components/settings/shared/fetch-error';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { ChannelConfigForm, ChannelSetupDescriptor } from './channel-edit.modal';
import { useAddProvider } from '@postmill-ai/frontend/components/launches/add.provider.component';
import ProviderListShell from '@postmill-ai/frontend/components/settings/shared/provider-list-shell';
import {
  useProviderCatalog,
  ProviderCatalogEntry,
  latestActiveVersion,
} from '@postmill-ai/frontend/components/settings/shared/use-provider-catalog';
import { useModals, useDecisionModal } from '@postmill-ai/frontend/components/layout/new-modal';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { PlatformIcon } from '@postmill-ai/frontend/components/shared/platform-icon';
import { StatusPill } from '@postmill-ai/frontend/components/ui/data-table';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { CapabilityBadges as KitCapabilityBadges } from '@postmill-ai/frontend/components/settings/shared/kit/capabilities';
import { ProviderSearchToolbar } from '@postmill-ai/frontend/components/settings/shared/kit/provider-search-toolbar';
import { CapabilityMeta } from '@postmill-ai/frontend/components/settings/shared/kit/provider-surface.types';

interface ProviderCapability {
  analytics: boolean;
  comments: boolean;
  firstComment: boolean;
  poll: boolean;
  video: boolean;
  carousel: boolean;
  altText: boolean;
  maxMedia: number;
  linkPreview: boolean;
  refreshToken: boolean;
  watchlist: boolean;
}

type CapabilityKey = keyof ProviderCapability;

interface ProviderCatalogItem {
  identifier: string;
  name: string;
  description: string;
  scopes: string;
  capabilities: ProviderCapability | null;
  setup: ChannelSetupDescriptor | null;
  callbackUrl: string;
  platformConfigured?: boolean;
}

interface ChannelConfigItem {
  id: string;
  identifier: string;
  name: string;
  enabled: boolean;
  isConfigured: boolean;
  displayValues?: Record<string, string>;
  version: string;
  scopes: string | null;
  redirectUri: string | null;
  setupNotes: string | null;
  vpnSelection?: { enabled: boolean; identifier?: string; regionId?: string } | null;
  updatedAt: string | null;
  capabilities: ProviderCapability | null;
}

const CAPABILITY_KEYS: CapabilityKey[] = [
  'analytics',
  'comments',
  'firstComment',
  'poll',
  'video',
  'carousel',
  'altText',
  'linkPreview',
  'refreshToken',
  'watchlist',
];

const CAPABILITY_FILTERS: { key: CapabilityKey; label: string }[] = [
  { key: 'analytics', label: 'Analytics' },
  { key: 'comments', label: 'Replies' },
  { key: 'firstComment', label: 'First Comment' },
  { key: 'poll', label: 'Polls' },
  { key: 'video', label: 'Video' },
  { key: 'carousel', label: 'Carousel' },
  { key: 'altText', label: 'Alt Text' },
  { key: 'linkPreview', label: 'Link Preview' },
  { key: 'refreshToken', label: 'Refresh Token' },
  { key: 'watchlist', label: 'Watchlist' },
];

const CAPABILITY_COLORS: Record<string, string> = {
  analytics: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  comments: 'bg-purple-500/20 text-purple-800 dark:text-purple-400',
  firstComment: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  poll: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
  video: 'bg-red-500/20 text-dangerText',
  carousel: 'bg-pink-500/20 text-pink-800 dark:text-pink-400',
  altText: 'bg-cyan-500/20 text-cyan-800 dark:text-cyan-400',
  linkPreview: 'bg-indigo-500/20 text-indigo-800 dark:text-indigo-400',
  refreshToken: 'bg-teal-500/20 text-teal-800 dark:text-teal-400',
  watchlist: 'bg-orange-500/20 text-orange-800 dark:text-orange-400',
};

// Capability label + color, built from the existing filter labels and the
// CAPABILITY_COLORS map, passed to the shared kit `CapabilityBadges` primitive.
const capabilityMeta: Record<string, CapabilityMeta> = Object.fromEntries(
  CAPABILITY_FILTERS.map((f) => [
    f.key,
    { label: f.label, color: CAPABILITY_COLORS[f.key] || '' },
  ])
);

const useConfigs = () => {
  const fetch = useFetch();
  return useSWR<ChannelConfigItem[]>('/channels/config', (url: string) =>
    fetch(url).then((r) => { if (!r.ok) throw createFetchError('channels_load_failed', 'Failed to load channels'); return r.json(); })
  );
};

const useProviders = () => {
  const fetch = useFetch();
  return useSWR<ProviderCatalogItem[]>('/channels/config/providers', (url: string) =>
    fetch(url).then((r) => { if (!r.ok) throw createFetchError('provider_catalog_load_failed', 'Failed to load provider catalog'); return r.json(); })
  );
};

// Channel rows show the platform mark circular; PlatformIcon defaults to square
// because format cards and catalog tiles look wrong cropped.
const ChannelProviderIcon: FC<{ identifier: string; name: string; size?: number }> = ({
  identifier,
  name,
  size = 40,
}) => <PlatformIcon identifier={identifier} name={name} size={size} rounded />;

const CapabilityBadges: FC<{ capabilities: ProviderCapability | null }> = ({ capabilities }) => {
  const keys = CAPABILITY_KEYS.filter((c) => capabilities?.[c]);
  return <KitCapabilityBadges keys={keys} meta={capabilityMeta} />;
};

// Single dropdown of capability checkboxes (replaces the row of filter buttons).
const CapabilityFilter: FC<{
  selected: CapabilityKey[];
  onToggle: (cap: CapabilityKey) => void;
  onClear: () => void;
}> = ({ selected, onToggle, onClear }) => {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) {
      document.addEventListener('mousedown', handler);
      return () => document.removeEventListener('mousedown', handler);
    }
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-[8px] text-[13px] px-[12px] py-[8px] rounded-[8px] border border-newTableBorder bg-newBgColor text-newTableText hover:bg-boxHover transition-colors whitespace-nowrap"
      >
        {t('capabilities', 'Capabilities')}
        {selected.length > 0 && (
          <span className="text-[11px] bg-btnPrimary text-white rounded-full px-[6px] py-px">
            {selected.length}
          </span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 mobile:right-auto mobile:left-0 top-[42px] z-300 w-[220px] bg-newBgColorInner border border-newTableBorder rounded-[8px] shadow-lg py-[6px]">
          {CAPABILITY_FILTERS.map((f) => {
            const checked = selected.includes(f.key);
            return (
              <label
                key={f.key}
                className="flex items-center gap-[8px] px-[12px] py-[6px] text-[13px] text-textColor hover:bg-boxHover cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggle(f.key)}
                  className="accent-btnPrimary w-[14px] h-[14px]"
                />
                {f.label}
              </label>
            );
          })}
          {selected.length > 0 && (
            <div className="border-t border-newTableBorder mt-[4px] pt-[4px] px-[12px]">
              <button
                type="button"
                onClick={onClear}
                className="text-[12px] text-textColor hover:underline"
              >
                {t('clear_all', 'Clear all')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Provider picker used by "New credential set (advanced)" — browse providers
// with their capability tags and a capability filter, then configure the chosen
// one. The primary "Add Channel" action is the OAuth connect flow
// (useAddProvider), not this picker.
const ProviderPicker: FC<{
  providers: ProviderCatalogItem[];
  catalog?: ProviderCatalogEntry[];
  onPick: (provider: ProviderCatalogItem) => void;
}> = ({ providers, catalog, onPick }) => {
  const t = useT();
  const [search, setSearch] = useState('');
  const [selectedCaps, setSelectedCaps] = useState<CapabilityKey[]>([]);

  // Version lifecycle from the public catalog (plan §7.5.8): surface the latest
  // selectable version + a sunset/retired pill so deprecated providers warn and
  // retired ones cannot be added.
  const versionInfo = useCallback(
    (identifier: string) => {
      const entries = (catalog || []).filter((e) => e.providerId === identifier);
      if (!entries.length) return null;
      const version = latestActiveVersion(catalog, identifier);
      const status = entries.some((e) => e.status === 'active')
        ? 'active'
        : entries.some((e) => e.status === 'preview')
          ? 'preview'
          : entries.some((e) => e.status === 'deprecated')
            ? 'deprecated'
            : 'retired';
      return { version, status };
    },
    [catalog]
  );

  const toggleCap = useCallback((cap: CapabilityKey) => {
    setSelectedCaps((prev) =>
      prev.includes(cap) ? prev.filter((c) => c !== cap) : [...prev, cap]
    );
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return providers.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.identifier.toLowerCase().includes(q)) {
        return false;
      }
      if (selectedCaps.length && !selectedCaps.some((c) => p.capabilities?.[c])) {
        return false;
      }
      return true;
    });
  }, [providers, search, selectedCaps]);

  return (
    <div className="flex flex-col gap-[12px] w-[520px] max-w-full">
      <ProviderSearchToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t('search_providers', 'Search providers...')}
        trailing={
          <CapabilityFilter
            selected={selectedCaps}
            onToggle={toggleCap}
            onClear={() => setSelectedCaps([])}
          />
        }
      />
      <div className="flex flex-col gap-[6px] max-h-[440px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-[13px] text-newTableText text-center py-[24px]">
            {t('no_providers_match', 'No providers match your filters.')}
          </div>
        ) : (
          filtered.map((p) => {
            const vi = versionInfo(p.identifier);
            const retired = vi?.status === 'retired';
            return (
              <button
                key={p.identifier}
                type="button"
                disabled={retired}
                onClick={() => !retired && onPick(p)}
                className="flex items-start gap-[12px] p-[10px] rounded-[8px] border border-newTableBorder hover:bg-boxHover text-start disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ChannelProviderIcon identifier={p.identifier} name={p.name} size={32} />
                <div className="flex flex-col min-w-0">
                  <span className="flex items-center gap-[6px] flex-wrap">
                    <span className="text-[14px] font-[500] text-textColor">{p.name}</span>
                    {vi && vi.status === 'deprecated' && (
                      <span className="text-[10px] rounded-[4px] px-[6px] py-px bg-amber-500/15 text-amber-800 dark:text-amber-400">
                        {t('deprecated', 'Deprecated')}
                      </span>
                    )}
                    {retired && (
                      <span className="text-[10px] rounded-[4px] px-[6px] py-px bg-red-500/15 text-dangerText">
                        {t('retired', 'Retired')}
                      </span>
                    )}
                  </span>
                  <CapabilityBadges capabilities={p.capabilities} />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};

interface ConnectedChannelItem {
  id: string;
  name: string;
  identifier: string;
  display?: string;
  picture?: string;
  disabled: boolean;
  inBetweenSteps?: boolean;
  refreshNeeded?: boolean;
}

const useConnectedChannels = () => {
  const fetch = useFetch();
  return useSWR<{ integrations: ConnectedChannelItem[] }>(
    '/integrations/list',
    (url: string) =>
      fetch(url)
        .then((r) => (r.ok ? r.json() : { integrations: [] }))
        .catch(() => ({ integrations: [] }))
  );
};

// Unified channel manager: OAuth-connected channels live here too, above the
// credential sets. Mutations reuse the exact calls the composer's channel menu
// makes (launches/menu/menu.tsx) so both surfaces stay in lockstep.
const ConnectedChannelsSection: FC<{
  onRefresh: () => void;
  onConnect: () => void;
}> = ({ onRefresh, onConnect }) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const decision = useDecisionModal();
  const permissions = usePermissions();
  const { data } = useConnectedChannels();
  const channels = useMemo(() => data?.integrations || [], [data]);

  // Optimistic-render RBAC gating: render actions until permissions resolve
  // negative (the backend OrgRbacGuard is the real gate).
  const canUpdate = !(
    permissions.isResolved && !permissions.hasPermission('channels', 'update')
  );
  const canDelete = !(
    permissions.isResolved && !permissions.hasPermission('channels', 'delete')
  );

  const toggleDisabled = useCallback(
    async (channel: ConnectedChannelItem) => {
      const ok = await decision.open({
        title: channel.disabled
          ? t('enable_channel_title', 'Enable Channel')
          : t('disable_channel_title', 'Disable Channel'),
        description: channel.disabled
          ? t(
              'are_you_sure_enable_channel',
              'Are you sure you want to enable this channel?'
            )
          : t(
              'are_you_sure_disable_channel',
              'Are you sure you want to disable this channel?'
            ),
      });
      if (!ok) return;
      const res = await fetch(
        `/integrations/${channel.disabled ? 'enable' : 'disable'}`,
        {
          method: 'POST',
          body: JSON.stringify({ id: channel.id }),
        }
      );
      if (!res.ok) {
        toaster.show(
          t('channel_update_failed', 'Failed to update channel'),
          'warning'
        );
        return;
      }
      toaster.show(
        channel.disabled
          ? t('channel_enabled', 'Channel Enabled')
          : t('channel_disabled', 'Channel Disabled'),
        'success'
      );
      onRefresh();
    },
    [decision, t, fetch, toaster, onRefresh]
  );

  const deleteChannel = useCallback(
    async (channel: ConnectedChannelItem) => {
      const ok = await decision.open({
        title: t('delete_channel_title', 'Delete Channel'),
        description: t(
          'are_you_sure_delete_channel',
          'Are you sure you want to delete this channel?'
        ),
      });
      if (!ok) return;
      const res = await fetch('/integrations', {
        method: 'DELETE',
        body: JSON.stringify({ id: channel.id }),
      });
      if (res.status === 406) {
        toaster.show(
          t(
            'delete_posts_before_channel',
            'You have to delete all the posts associated with this channel before deleting it'
          ),
          'warning'
        );
        return;
      }
      if (!res.ok) {
        toaster.show(
          t('channel_delete_failed', 'Failed to delete channel'),
          'warning'
        );
        return;
      }
      toaster.show(t('channel_deleted', 'Channel Deleted'), 'success');
      onRefresh();
    },
    [decision, t, fetch, toaster, onRefresh]
  );

  return (
    <div className="flex flex-col gap-[10px]">
      <h2 className="text-[16px] font-[500] text-textColor">
        {t('connected_channels', 'Connected channels')}
      </h2>
      <div className="bg-newBgColorInner border border-newTableBorder rounded-[12px]">
        {channels.length === 0 ? (
          <div className="px-[16px] py-[20px] text-[13px] text-newTableText">
            {t('no_channels_connected', 'No channels connected yet.')}
          </div>
        ) : (
          channels.map((channel, index) => (
            <div
              key={channel.id}
              className={`flex items-center gap-[12px] px-[16px] py-[12px] flex-wrap${
                index > 0 ? ' border-t border-newTableBorder' : ''
              }`}
            >
              <ChannelProviderIcon
                identifier={channel.identifier}
                name={channel.name}
                size={32}
              />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[14px] font-[500] text-textColor truncate">
                  {channel.name}
                </span>
                {!!channel.display && (
                  <span className="text-[12px] text-newTableText truncate">
                    {channel.display}
                  </span>
                )}
              </div>
              <StatusPill
                status={
                  channel.inBetweenSteps
                    ? 'amber'
                    : channel.disabled
                      ? 'red'
                      : 'green'
                }
                label={
                  channel.inBetweenSteps
                    ? t('setup_incomplete', 'Setup incomplete')
                    : channel.disabled
                      ? t('disabled', 'Disabled')
                      : t('active', 'Active')
                }
              />
              <div className="flex items-center gap-[12px]">
                {channel.inBetweenSteps && canUpdate && (
                  <button
                    type="button"
                    className="text-[12px] text-textColor hover:underline"
                    onClick={onConnect}
                  >
                    {t('finish_setup', 'Finish setup')}
                  </button>
                )}
                {!channel.inBetweenSteps && canUpdate && (
                  <>
                    <button
                      type="button"
                      className="text-[12px] text-textColor hover:underline"
                      onClick={() => toggleDisabled(channel)}
                    >
                      {channel.disabled
                        ? t('enable', 'Enable')
                        : t('disable', 'Disable')}
                    </button>
                    <button
                      type="button"
                      className="text-[12px] text-textColor hover:underline"
                      onClick={onConnect}
                    >
                      {t('reconnect', 'Reconnect')}
                    </button>
                  </>
                )}
                {canDelete && (
                  <button
                    type="button"
                    className="text-[12px] text-dangerText hover:underline"
                    onClick={() => deleteChannel(channel)}
                  >
                    {t('delete', 'Delete')}
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export const ChannelsTab: FC = () => {
  const t = useT();
  const { mutate: globalMutate } = useSWRConfig();
  const { data: configs, isLoading, error } = useConfigs();
  const { data: providers } = useProviders();
  const { data: catalog } = useProviderCatalog('social');
  const modals = useModals();
  const toaster = useToaster();
  const permissions = usePermissions();
  // Adding a channel hits POST endpoints gated by @RequirePermission('channels','create');
  // hide the trigger for members who lack it (the backend still 403s — this is UI gating only).
  const canAddChannel = permissions.hasPermission('channels', 'create');

  const [search, setSearch] = useState('');

  const providerName = useCallback(
    (identifier: string) =>
      providers?.find((p) => p.identifier === identifier)?.name || identifier,
    [providers]
  );

  const refresh = useCallback(() => globalMutate('/channels/config'), [globalMutate]);
  // Connected-channel mutations and completed connects must refresh both the
  // credential sets and the connected-channels list.
  const refreshAll = useCallback(() => {
    globalMutate('/channels/config');
    globalMutate('/integrations/list');
  }, [globalMutate]);

  // Primary "Add Channel" = the standard OAuth connect flow (same modal as the
  // composer and sidebar): platform tiles, one-click "Uses the Postmill app"
  // connect, BYO-app tiles where no platform app exists.
  const connectChannel = useAddProvider(refreshAll);

  const openConfig = useCallback(
    (identifier: string, config?: ChannelConfigItem) => {
      const provider = providers?.find((p) => p.identifier === identifier);
      modals.openModal({
        title: config
          ? t('edit_channel', 'Edit channel')
          : t('configure_provider_name', 'Configure {{provider}}', {
              provider: providerName(identifier),
            }),
        children: (close) => (
          <ChannelConfigForm
            identifier={identifier}
            providerName={providerName(identifier)}
            defaultScopes={provider?.scopes || ''}
            setup={provider?.setup || null}
            callbackUrl={provider?.callbackUrl || ''}
            platformConfigured={!!provider?.platformConfigured}
            config={
              config
                ? {
                    id: config.id,
                    name: config.name,
                    enabled: config.enabled,
                    scopes: config.scopes || '',
                    redirectUri: config.redirectUri || '',
                    setupNotes: config.setupNotes || '',
                    isConfigured: config.isConfigured,
                    displayValues: config.displayValues,
                    version: config.version,
                    vpnSelection: config.vpnSelection,
                  }
                : undefined
            }
            onClose={close}
            onSaved={refresh}
          />
        ),
      });
    },
    [providers, modals, t, providerName, refresh]
  );

  // Advanced path: create a named credential set (BYO OAuth app). Not the
  // primary action — most users connect straight through OAuth.
  const openConfigSetPicker = useCallback(() => {
    if (!providers?.length) {
      toaster.show(t('providers_loading', 'Providers are still loading'), 'warning');
      return;
    }
    modals.openModal({
      title: t('new_credential_set', 'New credential set'),
      children: (close) => (
        <ProviderPicker
          providers={providers}
          catalog={catalog}
          onPick={(p) => {
            close();
            openConfig(p.identifier);
          }}
        />
      ),
    });
  }, [providers, catalog, modals, t, toaster, openConfig]);

  const filteredConfigs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...(configs || [])]
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          c.identifier.toLowerCase().includes(q) ||
          providerName(c.identifier).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [configs, search, providerName]);

  const shellProviders = useMemo(
    () =>
      filteredConfigs.map((c) => {
        const version = c.version ?? 'v1';
        const catalogEntry = catalog?.find(
          (e) => e.providerId === c.identifier && e.version === version
        );
        return {
          id: c.id,
          identifier: c.identifier,
          name: c.name,
          enabled: c.enabled && c.isConfigured,
          isActive: c.enabled && c.isConfigured,
          isConfigured: c.isConfigured,
          version,
          versionStatus: catalogEntry?.status ?? 'active',
          sunsetAt: catalogEntry?.sunsetAt,
        };
      }),
    [filteredConfigs, catalog]
  );

  // Reopen a config from the lifecycle banner (Upgrade / Reconfigure).
  const openConfigByIdentifier = useCallback(
    (identifier: string) => {
      const config = filteredConfigs.find((c) => c.identifier === identifier);
      openConfig(identifier, config);
    },
    [filteredConfigs, openConfig]
  );

  if (error) {
    return (
      <div className="flex flex-col items-center gap-[12px] py-[40px]">
        <div className="text-red-500 text-[14px]">
          {t('channels_load_failed', 'Failed to load channels')}: {error.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="text-textColor text-[14px] py-[40px] text-center">
        {t('loading_channels', 'Loading channels...')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[24px]">
      <ConnectedChannelsSection
        onRefresh={refreshAll}
        onConnect={connectChannel}
      />
      <ProviderListShell
      title=""
      providers={shellProviders}
      onConfigure={openConfigByIdentifier}
      onUpgrade={openConfigByIdentifier}
      onRemove={() => undefined}
      ProviderIconComponent={ChannelProviderIcon}
      toolbar={
        <ProviderSearchToolbar
          search={search}
          onSearch={setSearch}
          placeholder={t('search_channels', 'Search channels...')}
          trailing={
            canAddChannel ? (
              <div className="flex items-center gap-[12px]">
                <button
                  type="button"
                  onClick={openConfigSetPicker}
                  className="text-[13px] text-textColor hover:underline whitespace-nowrap"
                >
                  {t('new_credential_set_advanced', 'New credential set (advanced)')}
                </button>
                <button
                  type="button"
                  onClick={connectChannel}
                  className="text-[13px] px-[16px] py-[8px] rounded-[8px] bg-btnPrimary text-white hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  + {t('add_channel', 'Add Channel')}
                </button>
              </div>
            ) : undefined
          }
        />
      }
      renderBadges={(provider) => (
        <div className="flex gap-[6px] mt-[4px] items-center">
          <span className="text-[11px] text-newTableText">
            {providerName(provider.identifier)}
          </span>
        </div>
      )}
      renderActions={(provider) => {
        const config = filteredConfigs.find((c) => c.id === provider.id);
        if (!config) return null;
        return (
          <button
            className="text-[12px] text-textColor hover:underline"
            onClick={() => openConfig(config.identifier, config)}
          >
            {t('edit', 'Edit')}
          </button>
        );
      }}
    />
    </div>
  );
};
