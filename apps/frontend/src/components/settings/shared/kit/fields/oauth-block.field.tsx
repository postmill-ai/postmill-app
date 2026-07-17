'use client';

import React, { useCallback, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { ExtraFieldProps } from './extra-field.types';

/**
 * OAuth2 client-id/secret inputs + Connect button (shortlinks). Only renders
 * when `meta.authType === 'oauth2'`. Writes `extra.clientId` / `extra.clientSecret`.
 * The Connect button mints an authorize URL from `${basePath}/config/:id/oauth/url`,
 * stashes the identifier in sessionStorage (read back by `useOAuthReturn`) and
 * redirects. Mirrors `shortlink-provider-form.tsx`.
 */
export const OAuthBlockField: React.FC<ExtraFieldProps> = ({
  state,
  setExtra,
  meta,
  identifier,
  basePath,
}) => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const [showClientSecret, setShowClientSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const clientId = state.extra.clientId || '';
  const clientSecret = state.extra.clientSecret || '';
  const sessionKey: string = meta?.oauthSessionKey || 'oauth_shortlink_provider';
  const tab: string = meta?.oauthTab || 'shortlinks';
  const connectLabel: string =
    meta?.oauthConnectLabel || t('connect_with_bitly', 'Connect with Bitly');

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const redirectUri = `${window.location.origin}/settings?tab=${tab}`;
      const res = await fetch(`${basePath}/config/${identifier}/oauth/url`, {
        method: 'POST',
        body: JSON.stringify({ redirectUri }),
      });
      if (!res.ok) {
        toaster.show(t('oauth_failed', 'Failed to start OAuth flow'), 'warning');
        return;
      }
      const { url } = await res.json();
      sessionStorage.setItem(sessionKey, identifier);
      window.location.href = url;
    } catch {
      toaster.show(t('oauth_failed', 'Failed to start OAuth flow'), 'warning');
      setConnecting(false);
    }
  }, [identifier, basePath, fetch, toaster, t, tab, sessionKey]);

  if (meta?.authType !== 'oauth2') return null;

  return (
    <>
      <div className="flex flex-col gap-[4px]">
        <label className="text-[13px] text-newTableText">
          {t('client_id', 'Client ID')}
          <span className="text-red-500 ml-[2px]">*</span>
        </label>
        <input
          className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px]"
          type="text"
          placeholder={t('client_id_placeholder', 'OAuth Client ID')}
          value={clientId}
          onChange={(e) => setExtra('clientId', e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-[4px]">
        <label className="text-[13px] text-newTableText">
          {t('client_secret', 'Client Secret')}
          <span className="text-red-500 ml-[2px]">*</span>
        </label>
        <div className="relative">
          <input
            className="bg-newBgColorInner border border-newTableBorder rounded-[8px] p-[8px] text-textColor text-[13px] w-full"
            type={showClientSecret ? 'text' : 'password'}
            placeholder={meta?.isConfigured ? t('secret_saved', '••••• saved — leave blank to keep') : ''}
            value={clientSecret}
            onChange={(e) => setExtra('clientSecret', e.target.value)}
          />
          <button
            type="button"
            className="absolute right-[8px] top-1/2 -translate-y-1/2 text-[11px] text-newTableText hover:text-textColor"
            onClick={() => setShowClientSecret(!showClientSecret)}
          >
            {showClientSecret ? t('hide', 'Hide') : t('show', 'Show')}
          </button>
        </div>
      </div>

      <div className="flex items-center gap-[12px]">
        <div className="text-[12px] text-newTableText flex-1">
          {meta?.isConfigured || clientId || clientSecret
            ? t('oauth_connect_note', 'Click Connect to authorize. You can also paste a generated access token above.')
            : t('oauth_save_first', 'Save Client ID and Client Secret above first, then connect.')}
        </div>
        <button
          className="bg-btnPrimary text-white rounded-[8px] px-[16px] py-[8px] text-[13px] hover:opacity-90 whitespace-nowrap disabled:opacity-50"
          onClick={handleConnect}
          disabled={connecting || (!meta?.isConfigured && !clientId && !clientSecret)}
        >
          {connecting ? t('connecting', 'Connecting...') : connectLabel}
        </button>
      </div>
    </>
  );
};
