'use client';

import React, { FC, useCallback, useEffect, useMemo, useState } from 'react';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { useModals } from '@postmill-ai/frontend/components/layout/new-modal';
import { usePermissions } from '@postmill-ai/frontend/components/layout/use-permissions';
import { PlatformIcon } from '@postmill-ai/frontend/components/shared/platform-icon';
import ProviderListShell from '@postmill-ai/frontend/components/settings/shared/provider-list-shell';
import ProviderModalTitle from '@postmill-ai/frontend/components/settings/shared/provider-modal-title';
import { ProviderSearchToolbar } from '@postmill-ai/frontend/components/settings/shared/kit/provider-search-toolbar';
import { CapabilityBadges } from '@postmill-ai/frontend/components/settings/shared/kit/capabilities';
import { CapabilityMeta } from '@postmill-ai/frontend/components/settings/shared/kit/provider-surface.types';
import { CommsProvider, useCommsConfig } from './use-comms-config';
import { CommsConfigForm } from './comms-config.modal';

// Comms capability matrix (kernel CommsAdapterCapabilities) — the transport
// facts a user cares about when picking a chat app. Rendered as badges in the
// picker, same as channels' capability tags.
const COMMS_CAPABILITY_META: Record<string, CapabilityMeta> = {
  webhookInbound: {
    label: 'Webhook',
    color: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  },
  pollInbound: {
    label: 'Polling',
    color: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  },
  threads: {
    label: 'Threads',
    color: 'bg-purple-500/20 text-purple-800 dark:text-purple-400',
  },
  webhookRegistration: {
    label: 'Auto Webhook',
    color: 'bg-teal-500/20 text-teal-800 dark:text-teal-400',
  },
};

const CommsCapabilityBadges: FC<{ capabilities?: Record<string, boolean> }> = ({
  capabilities,
}) => (
  <CapabilityBadges
    keys={Object.keys(COMMS_CAPABILITY_META).filter((k) => capabilities?.[k])}
    meta={COMMS_CAPABILITY_META}
  />
);

// Comms rows show the platform mark circular, same as channel rows.
const CommsProviderIcon: FC<{ identifier: string; name: string; size?: number }> = ({
  identifier,
  name,
  size = 40,
}) => <PlatformIcon identifier={identifier} name={name} size={size} rounded />;

// Provider picker used by "Add Comms Channel" — one config per provider, so
// only providers that are not configured yet are listed.
const ProviderPicker: FC<{
  providers: CommsProvider[];
  onPick: (provider: CommsProvider) => void;
}> = ({ providers, onPick }) => {
  const t = useT();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return providers;
    return providers.filter(
      (p) => p.name.toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q)
    );
  }, [providers, search]);

  return (
    <div className="flex flex-col gap-[12px] w-[520px] max-w-full">
      <ProviderSearchToolbar
        search={search}
        onSearch={setSearch}
        placeholder={t('search_providers', 'Search providers...')}
      />
      <div className="flex flex-col gap-[6px] max-h-[440px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-[13px] text-newTableText text-center py-[24px]">
            {providers.length === 0
              ? t('comms_all_configured', 'All comms providers are configured.')
              : t('no_providers_match', 'No providers match your filters.')}
          </div>
        ) : (
          filtered.map((p) => (
            <button
              key={p.identifier}
              type="button"
              onClick={() => onPick(p)}
              className="flex items-center gap-[12px] p-[10px] rounded-[8px] border border-newTableBorder hover:bg-boxHover text-start"
            >
              <CommsProviderIcon identifier={p.identifier} name={p.name} size={32} />
              <div className="flex flex-col min-w-0">
                <span className="flex items-center gap-[6px] flex-wrap">
                  <span className="text-[14px] font-[500] text-textColor">{p.name}</span>
                  {p.version && (
                    // Pinned-version pill, same as the channels picker/list rows.
                    <span
                      className="text-[10px] rounded-[4px] px-[6px] py-px bg-green-900/20 text-green-900 dark:text-green-400"
                      title={t('pinned_to_version', 'Pinned to version {{version}}', {
                        version: p.version,
                      })}
                    >
                      {p.version}
                    </span>
                  )}
                </span>
                <CommsCapabilityBadges capabilities={p.capabilities} />
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
};

export const CommsTab: FC = () => {
  const t = useT();
  const { data, isLoading, error, mutate } = useCommsConfig();
  const modals = useModals();
  const toaster = useToaster();
  const permissions = usePermissions();
  // Mutating comms config/links is gated by @RequirePermission('settings','update')
  // on the backend; hide the trigger for members who lack it (UI gating only).
  const canManage = permissions.hasPermission('settings', 'update');

  const [search, setSearch] = useState('');

  // Slack OAuth return: the backend callback redirects here with
  // ?connected=<identifier>. Inside the connect popup this page is the
  // intermediate close-page — hand the result to the opener (the config
  // modal listens for postmill:comms-connected, mirroring the channels
  // flow's postmill:channel-connected) and close. A full-page landing just
  // toasts, refetches, and scrubs the URL.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('connected');
    if (!connected) return;
    if (window.opener && window.opener !== window) {
      try {
        window.opener.postMessage(
          { type: 'postmill:comms-connected', provider: connected },
          window.location.origin
        );
      } catch {
        // Opener gone — nothing to notify.
      }
      window.close();
      return;
    }
    toaster.show(t('comms_connected', 'Provider connected'), 'success');
    void mutate();
    const url = new URL(window.location.href);
    url.searchParams.delete('connected');
    window.history.replaceState({}, '', url.toString());
  }, [t, toaster, mutate]);

  const openConfig = useCallback(
    (identifier: string) => {
      const provider = data?.providers.find((p) => p.identifier === identifier);
      if (!provider) return;
      modals.openModal({
        title: (
          <ProviderModalTitle
            identifier={identifier}
            name={provider.name}
            action={provider.isConfigured ? 'edit' : 'setup'}
          />
        ),
        children: (close) => <CommsConfigForm identifier={identifier} onClose={close} />,
      });
    },
    [data, modals]
  );

  const openPicker = useCallback(() => {
    if (!data?.providers.length) {
      toaster.show(t('providers_loading', 'Providers are still loading'), 'warning');
      return;
    }
    const unconfigured = data.providers.filter((p) => !p.isConfigured);
    modals.openModal({
      title: t('add_comms_channel', 'Add Comms Channel'),
      children: (close) => (
        <ProviderPicker
          providers={unconfigured}
          onPick={(p) => {
            close();
            openConfig(p.identifier);
          }}
        />
      ),
    });
  }, [data, modals, t, toaster, openConfig]);

  // Only configured providers are listed — unconfigured ones are added
  // through the picker, exactly like channels.
  const configuredProviders = useMemo(
    () => (data?.providers ?? []).filter((p) => p.isConfigured),
    [data]
  );

  const filteredProviders = useMemo(() => {
    const q = search.trim().toLowerCase();
    return configuredProviders.filter((p) => {
      if (!q) return true;
      return p.name.toLowerCase().includes(q) || p.identifier.toLowerCase().includes(q);
    });
  }, [configuredProviders, search]);

  // Linked member names per provider — the comms analog of channels'
  // "Connected as" line.
  const linkedByIdentifier = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const link of data?.links ?? []) {
      if (link.status !== 'linked') continue;
      (map[link.identifier] ||= []).push(link.userName || link.userEmail);
    }
    return map;
  }, [data]);

  const shellProviders = useMemo(
    () =>
      filteredProviders.map((p) => ({
        id: p.identifier,
        identifier: p.identifier,
        name: p.name,
        enabled: p.enabled && p.isConfigured,
        isActive: p.enabled && p.isConfigured,
        isConfigured: p.isConfigured,
      })),
    [filteredProviders]
  );

  if (error) {
    return (
      <div className="flex flex-col items-center gap-[12px] py-[40px]">
        <div className="text-red-500 text-[14px]">
          {t('comms_load_failed', 'Failed to load comms settings')}: {error.message || 'Unknown error'}
        </div>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="text-textColor text-[14px] py-[40px] text-center">
        {t('loading', 'Loading…')}
      </div>
    );
  }

  return (
    <ProviderListShell
      title=""
      providers={shellProviders}
      onConfigure={openConfig}
      onRemove={() => undefined}
      ProviderIconComponent={CommsProviderIcon}
      toolbar={
        <ProviderSearchToolbar
          search={search}
          onSearch={setSearch}
          placeholder={t('comms_search', 'Search comms channels...')}
          trailing={
            canManage ? (
              <button
                type="button"
                onClick={openPicker}
                className="text-[13px] px-[16px] py-[8px] rounded-[8px] bg-btnPrimary text-white hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                + {t('add_comms_channel', 'Add Comms Channel')}
              </button>
            ) : undefined
          }
        />
      }
      renderBadges={(item) => {
        const provider = configuredProviders.find((p) => p.identifier === item.identifier);
        const linked = linkedByIdentifier[item.identifier] || [];
        return (
          <div className="flex gap-[6px] mt-[4px] items-center flex-wrap">
            <span
              className={`text-[11px] rounded-[4px] px-[6px] py-px ${
                provider?.enabled
                  ? 'bg-green-900/20 text-green-900 dark:text-green-400'
                  : 'bg-newTableHeader text-newTableText'
              }`}
            >
              {provider?.enabled ? t('enabled', 'Enabled') : t('disabled', 'Disabled')}
            </span>
            {provider?.webhookRegistered === false && (
              <span
                className="text-[11px] rounded-[4px] px-[6px] py-px bg-amber-500/15 text-amber-800 dark:text-amber-400"
                title={provider.webhookError}
              >
                {t('comms_webhook_pending', 'Webhook not registered')}
              </span>
            )}
            {linked.length > 0 && (
              <span className="text-[11px] text-newTableText">
                · {t('comms_linked_members', 'Linked: {{names}}', { names: linked.join(', ') })}
              </span>
            )}
          </div>
        );
      }}
      // The whole row opens the config modal — no separate Edit button.
      renderActions={() => null}
      onRowClick={(item) => openConfig(item.identifier)}
    />
  );
};
