'use client';

import { useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useToaster } from '@gitroom/react/toaster/toaster';

/**
 * Shared OAuth return handler (plan Step 2.1) — extracted from
 * `shortlinks.tab.tsx`. On mount, if `?code&state` are present and a provider
 * identifier was stashed in `sessionStorage[storageKey]`, POST the callback then
 * scrub the URL. Used by shortlinks (and reusable by channels).
 */
export function useOAuthReturn(opts: {
  /** sessionStorage key holding the in-flight provider identifier. */
  storageKey: string;
  /** Build the callback URL from the stored identifier. */
  callbackUrl: (identifier: string) => string;
  /** Tab name for the post-return redirectUri (e.g. 'shortlinks'). */
  tab: string;
  onConnected: () => void;
}) {
  const { storageKey, callbackUrl, tab, onConnected } = opts;
  const fetch = useFetch();
  const t = useT();
  const toaster = useToaster();
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const state = params.get('state');
    if (!code || !state || processing) return;

    setProcessing(true);
    const storedIdentifier = sessionStorage.getItem(storageKey);
    if (!storedIdentifier) {
      toaster.show(
        t('oauth_lost_context', 'Could not resume the connection — please retry.'),
        'warning',
      );
      setProcessing(false);
      return;
    }
    const identifier = storedIdentifier;
    (async () => {
      try {
        const redirectUri = `${window.location.origin}/settings?tab=${tab}`;
        const res = await fetch(callbackUrl(identifier), {
          method: 'POST',
          body: JSON.stringify({ code, state, redirectUri }),
        });
        if (res.ok) {
          toaster.show(t('oauth_success', 'Provider connected successfully'), 'success');
          onConnected();
        } else {
          toaster.show(t('oauth_failure', 'OAuth connection failed'), 'warning');
        }
      } catch {
        toaster.show(t('oauth_failure', 'OAuth connection failed'), 'warning');
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, '', url.toString());
        sessionStorage.removeItem(storageKey);
        setProcessing(false);
      }
    })();
  }, [fetch, processing, t, toaster, storageKey, callbackUrl, tab, onConnected]);

  return { processing };
}
