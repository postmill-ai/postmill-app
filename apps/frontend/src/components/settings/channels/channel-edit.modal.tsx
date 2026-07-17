'use client';

import React, { FC, useCallback, useMemo, useState } from 'react';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { createFetchError } from '@gitroom/frontend/components/settings/shared/fetch-error';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useVpnConfig } from '@gitroom/frontend/components/settings/vpn/hooks/useVpnConfig';
import { ChannelVpnRegionSelect } from './channel-vpn-region-select';
import { CampaignSelector } from '@gitroom/frontend/components/campaigns/selector/campaign-selector';
import {
  ProviderVersionSelect,
  useProviderVersionSelection,
} from '@gitroom/frontend/components/settings/shared/provider-version-select';

const PROVIDER_APP_LINKS: Record<string, { label: string; url: string | null }> = {
  linkedin: { label: 'LinkedIn Developer Portal', url: 'https://www.linkedin.com/developers/apps' },
  x: { label: 'X Developer Portal', url: 'https://developer.x.com/en/portal/dashboard' },
  facebook: { label: 'Facebook Developers', url: 'https://developers.facebook.com/apps' },
  instagram: { label: 'Instagram Basic Display', url: 'https://developers.facebook.com/docs/instagram-basic-display-api' },
  'instagram-standalone': { label: 'Instagram Basic Display', url: 'https://developers.facebook.com/docs/instagram-basic-display-api' },
  threads: { label: 'Threads Developer', url: 'https://developers.facebook.com/docs/threads' },
  youtube: { label: 'Google Cloud Console', url: 'https://console.cloud.google.com/apis/credentials' },
  tiktok: { label: 'TikTok for Developers', url: 'https://developers.tiktok.com/apps' },
  pinterest: { label: 'Pinterest Developers', url: 'https://developers.pinterest.com/apps' },
  discord: { label: 'Discord Developer Portal', url: 'https://discord.com/developers/applications' },
  slack: { label: 'Slack API', url: 'https://api.slack.com/apps' },
  reddit: { label: 'Reddit Apps', url: 'https://www.reddit.com/prefs/apps' },
  tumblr: { label: 'Tumblr OAuth Apps', url: 'https://www.tumblr.com/oauth/apps' },
  telegram: { label: 'Telegram BotFather', url: 'https://t.me/botfather' },
  wordpress: { label: 'WordPress Developers', url: 'https://developer.wordpress.com/apps' },
  devto: { label: 'dev.to Settings', url: 'https://dev.to/settings/extensions' },
  hashnode: { label: 'Hashnode Settings', url: 'https://hashnode.com/settings/developer' },
  medium: { label: 'Medium Integration', url: 'https://medium.com/me/settings/apps' },
  mastodon: { label: 'Mastodon Instance', url: null },
  bluesky: { label: 'Bluesky Settings', url: 'https://bsky.app/settings/app-passwords' },
};

export interface ChannelVpnSelection {
  enabled: boolean;
  identifier?: string;
  regionId?: string;
}

export interface ChannelConfigInstance {
  id: string;
  name: string;
  enabled: boolean;
  scopes: string;
  redirectUri: string;
  setupNotes: string;
  isConfigured: boolean;
  /** Pinned provider version of this config — keeps the version select on the
   *  stored version instead of silently defaulting to latest-active on edit. */
  version?: string;
  vpnSelection?: ChannelVpnSelection | null;
}

interface ChannelConfigFormProps {
  identifier: string;
  providerName: string;
  defaultScopes?: string;
  config?: ChannelConfigInstance; // present => edit mode
  onClose: () => void;
  onSaved: () => void;
}

export const ChannelConfigForm: FC<ChannelConfigFormProps> = ({
  identifier,
  providerName,
  defaultScopes = '',
  config,
  onClose,
  onSaved,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const isEdit = !!config;
  const isConfigured = config?.isConfigured || false;

  const [name, setName] = useState(config?.name || '');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [editScopes, setEditScopes] = useState(config?.scopes || defaultScopes);
  const [editRedirectUri, setEditRedirectUri] = useState(config?.redirectUri || '');
  const [editSetupNotes, setEditSetupNotes] = useState(config?.setupNotes || '');
  const [enabled, setEnabled] = useState(config?.enabled || false);
  const [saving, setSaving] = useState(false);

  const {
    versions,
    selected: selectedVersion,
    selectVersion,
  } = useProviderVersionSelection('social', identifier, config?.version);

  // Optional VPN egress: built from the org's enabled VPN provider×region combos.
  const { data: vpnConfig } = useVpnConfig();
  const vpnOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    for (const p of vpnConfig?.providers ?? []) {
      if (!p.enabled || !p.isConfigured) continue;
      for (const id of p.enabledRegions ?? []) {
        const region = p.proxyRegions?.find((r) => r.id === id);
        if (!region) continue;
        out.push({ value: `${p.identifier}:${id}`, label: `${p.name}: ${region.label}` });
      }
    }
    return out;
  }, [vpnConfig]);

  const [vpnEnabled, setVpnEnabled] = useState(config?.vpnSelection?.enabled || false);
  const [vpnValue, setVpnValue] = useState(
    config?.vpnSelection?.identifier && config?.vpnSelection?.regionId
      ? `${config.vpnSelection.identifier}:${config.vpnSelection.regionId}`
      : ''
  );

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toaster.show(t('channel_name_required', 'Please enter a name for this channel.'), 'warning');
      return;
    }
    if (enabled && !clientId.trim() && !isConfigured) {
      toaster.show(
        t('credentials_required', 'Please enter a Client ID / API Key before enabling this provider.'),
        'warning'
      );
      return;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: name.trim(),
        enabled,
        scopes: editScopes || '',
      };
      if (clientId.trim()) payload.clientId = clientId.trim();
      if (clientSecret.trim()) payload.clientSecret = clientSecret.trim();
      if (selectedVersion) payload.version = selectedVersion;
      if (editRedirectUri.trim()) payload.redirectUri = editRedirectUri.trim();
      if (editSetupNotes.trim()) payload.setupNotes = editSetupNotes.trim();
      if (vpnOptions.length) {
        if (vpnEnabled && vpnValue) {
          const sep = vpnValue.indexOf(':');
          payload.vpnSelection = {
            enabled: true,
            identifier: vpnValue.slice(0, sep),
            regionId: vpnValue.slice(sep + 1),
          };
        } else {
          payload.vpnSelection = { enabled: false };
        }
      }

      const res = isEdit
        ? await fetch(`/channels/config/${config!.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch('/channels/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identifier, ...payload }),
          });

      if (res.ok) {
        toaster.show(t('channel_saved', 'Channel saved'), 'success');
        onSaved();
        onClose();
        return;
      }
      const errBody = await res.json().catch(() => ({}));
      toaster.show(errBody.message || t('channel_save_failed', 'Failed to save channel'), 'warning');
    } catch {
      toaster.show(t('network_error_saving', 'Network error while saving'), 'warning');
    } finally {
      setSaving(false);
    }
  }, [name, enabled, clientId, clientSecret, selectedVersion, editScopes, editRedirectUri, editSetupNotes, vpnOptions, vpnEnabled, vpnValue, isConfigured, isEdit, config, identifier, fetch, toaster, t, onSaved, onClose]);

  const handleDelete = useCallback(async () => {
    if (!config) return;
    setSaving(true);
    try {
      const res = await fetch(`/channels/config/${config.id}`, { method: 'DELETE' });
      if (!res.ok) throw createFetchError('channel_remove_failed', 'Failed to remove channel');
      toaster.show(t('channel_removed', 'Channel removed'), 'success');
      onSaved();
      onClose();
    } catch {
      toaster.show(t('channel_remove_failed', 'Failed to remove channel'), 'warning');
    } finally {
      setSaving(false);
    }
  }, [config, fetch, toaster, t, onSaved, onClose]);

  const handleTest = useCallback(async () => {
    if (!config) return;
    try {
      const res = await fetch(`/channels/config/${config.id}/test`, { method: 'POST' });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        toaster.show(t('config_valid', 'Configuration valid'), 'success');
      } else {
        toaster.show(result.error || t('test_failed', 'Test failed'), 'warning');
      }
    } catch {
      toaster.show(t('test_failed', 'Test failed'), 'warning');
    }
  }, [config, fetch, toaster, t]);

  const credentialPlaceholder = isConfigured ? t('already_configured', 'Already configured') : '';
  const appLink = PROVIDER_APP_LINKS[identifier];

  return (
    <div className="flex flex-col gap-[12px] min-w-[460px] mobile:min-w-0">
      {appLink?.url && (
        <div className="flex justify-end">
          <a
            href={appLink.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-textColor underline hover:opacity-80"
          >
            {appLink.label}
          </a>
        </div>
      )}

      <div className="flex flex-col gap-[6px]">
        <label className="text-[14px] font-[500]">
          {t('channel_name', 'Channel name')} <span className="text-red-500">*</span>
        </label>
        <Input
          label=""
          name={`name_${identifier}`}
          disableForm={true}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('channel_name_placeholder', 'e.g. Marketing LinkedIn')}
        />
      </div>

      <ProviderVersionSelect
        versions={versions}
        value={selectedVersion}
        onChange={selectVersion}
        label={t('provider_version', 'Provider version')}
      />

      <div className="flex items-center gap-[8px]">
        <label className="text-[14px] font-[500]">{t('enabled', 'Enabled')}</label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            if (e.target.checked && !clientId.trim() && !isConfigured) {
              toaster.show(
                t('credentials_required', 'Please enter a Client ID / API Key before enabling this provider.'),
                'warning'
              );
              return;
            }
            setEnabled(e.target.checked);
          }}
          className="w-[18px] h-[18px]"
        />
      </div>

      <div className="flex flex-col gap-[6px]">
        <label className="text-[14px] font-[500]">{t('client_id', 'Client ID / API Key')}</label>
        <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor flex items-center justify-center">
          <input
            className="h-full bg-transparent outline-none flex-1 text-[14px] text-textColor placeholder-textColor px-[16px]"
            placeholder={credentialPlaceholder}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-[6px]">
        <label className="text-[14px] font-[500]">{t('client_secret', 'Client Secret / API Secret')}</label>
        <div className="bg-newBgColorInner h-[42px] border-newTableBorder border rounded-[8px] text-textColor flex items-center justify-center">
          <input
            type="password"
            className="h-full bg-transparent outline-none flex-1 text-[14px] text-textColor placeholder-textColor px-[16px]"
            placeholder={credentialPlaceholder}
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
          />
        </div>
      </div>

      <Input
        label={t('redirect_uri', 'Redirect URI')}
        name={`redirect_${identifier}`}
        disableForm={true}
        value={editRedirectUri}
        onChange={(e) => setEditRedirectUri(e.target.value)}
        placeholder={t('redirect_uri_placeholder', 'Leave empty for default callback URL')}
      />

      <Input
        label={t('scopes_comma', 'Scopes (comma separated)')}
        name={`scopes_${identifier}`}
        disableForm={true}
        value={editScopes}
        onChange={(e) => setEditScopes(e.target.value)}
      />

      {(config?.setupNotes || editSetupNotes) && (
        <div className="flex flex-col gap-[4px]">
          <label className="text-[14px] font-[500]">{t('setup_instructions', 'Setup Instructions')}</label>
          <textarea
            value={editSetupNotes}
            onChange={(e) => setEditSetupNotes(e.target.value)}
            className="p-[8px] rounded-[8px] border border-newTableBorder bg-bgInput text-textColor min-h-[80px] text-[14px]"
            rows={3}
          />
        </div>
      )}

      {isEdit && config?.id && (
        <CampaignSelector entityType="channel" entityId={config.id} />
      )}

      {vpnOptions.length > 0 && (
        <div className="flex gap-[12px] items-end">
          <div className="flex flex-col gap-[6px]">
            <label className="text-[14px] font-[500]">{t('vpn_connection', 'VPN connection')}</label>
            <button
              type="button"
              role="switch"
              aria-checked={vpnEnabled}
              onClick={() => setVpnEnabled((v) => !v)}
              className="flex items-center gap-[8px]"
            >
              <span
                className={`relative w-[40px] h-[22px] rounded-full transition-colors ${
                  vpnEnabled ? 'bg-btnPrimary' : 'bg-newTableBorder'
                }`}
              >
                <span
                  className={`absolute top-[2px] left-[2px] w-[18px] h-[18px] rounded-full bg-white transition-transform ${
                    vpnEnabled ? 'translate-x-[18px]' : 'translate-x-0'
                  }`}
                />
              </span>
              <span className="text-[14px] text-textColor">
                {vpnEnabled ? t('enabled', 'Enabled') : t('disabled', 'Disabled')}
              </span>
            </button>
          </div>
          <div className="flex-1 flex flex-col gap-[6px]">
            <label className="text-[14px] font-[500]">{t('vpn_region', 'Provider & region')}</label>
            <ChannelVpnRegionSelect
              value={vpnValue}
              options={vpnOptions}
              disabled={!vpnEnabled}
              placeholder={t('vpn_region_placeholder', 'Search provider: region…')}
              onChange={setVpnValue}
            />
          </div>
        </div>
      )}

      <div className="flex gap-[8px] justify-between items-center mt-[8px]">
        <div className="flex gap-[8px]">
          <Button
            type="button"
            className="!bg-transparent border border-newTableBorder text-textColor"
            onClick={onClose}
          >
            {t('cancel', 'Cancel')}
          </Button>
        </div>
        <div className="flex gap-[8px]">
          {isEdit && (
            <>
              <Button
                type="button"
                className="!bg-transparent border border-red-500/30 text-dangerText text-[12px]"
                onClick={handleDelete}
                disabled={saving}
              >
                {t('remove', 'Remove')}
              </Button>
              {isConfigured && (
                <Button
                  type="button"
                  className="!bg-transparent border border-newTableBorder text-textColor text-[12px]"
                  onClick={handleTest}
                >
                  {t('test', 'Test')}
                </Button>
              )}
            </>
          )}
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? t('saving', 'Saving...') : t('save', 'Save')}
          </Button>
        </div>
      </div>
    </div>
  );
};
