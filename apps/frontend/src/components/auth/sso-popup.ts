'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useFetch } from '@postmill-ai/helpers/utils/custom.fetch';
import { useReturnUrl } from '@postmill-ai/frontend/app/(app)/auth/return.url.component';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';

// Social sign-in in a popup — the same handshake Settings → Comms uses for a
// channel connect (comms-config.modal.tsx / comms.tab.tsx), lifted into a
// hook because every login button needs it.
//
// Opener (login page): fetch the provider's authorize URL, window.open() it,
// then wait for the popup's completion signal. Verified browser facts that
// shape the wait: consent pages may carry Cross-Origin-Opener-Policy (x.com:
// same-origin-allow-popups), which severs window.opener permanently, wipes
// window.name AND makes our `popup` handle report closed=true within
// seconds — so a closed handle is not evidence the flow ended, and the signal
// goes through localStorage (shared same-origin, survives COOP) with
// postMessage as a fast path when the opener survives.
//
// Popup: the OAuth callback lands on /auth?code=…&provider=… exactly as it
// does in a full-page flow. After the backend has set the auth cookie the
// response carries a `reload` (existing user) or `onboarding` (fresh
// registration) header; LayoutContext.afterRequest routes that through
// completeSsoPopup() instead of reloading the popup. A popup cannot tell it
// is one after COOP (no opener, no name), so the discriminator is inverted:
// the callback assumes "popup" unless this tab marked itself as the
// full-page fallback (sessionStorage — tab-local, survives the round trip).

export const SSO_POPUP_NAME = 'postmill-sso';
export const SSO_POPUP_FEATURES = 'width=640,height=720,popup';
export const SSO_COMPLETE_STORAGE_KEY = 'postmill:sso-complete';
export const SSO_COMPLETE_MESSAGE_TYPE = 'postmill:sso-complete';
// Set (sessionStorage) right before a full-page navigation to the provider,
// so the callback knows it IS the user's tab and must not window.close() it.
// A script-opened popup never carries it (written only after window.open()
// failed, or by the in-tab Farcaster/Wallet buttons).
export const SSO_FULLPAGE_STORAGE_KEY = 'postmill:sso-fullpage';
// How long the opener keeps listening after the popup handle reports closed.
export const SSO_GRACE_MS = 10 * 60 * 1000;
// How long a callback page waits after window.close() before concluding it
// is not script-closable (i.e. it is the user's own tab) and navigating.
export const SSO_CLOSE_FALLBACK_MS = 400;

export type SsoAction = 'reload' | 'onboarding' | 'error';

export interface SsoSignal {
  action: SsoAction;
  message?: string;
  ts: number;
}

// What LayoutContext.afterRequest does with a `reload` / `onboarding`
// response header, shared with the opener so both windows land the same
// way: stored return URL first, then /dashboard for onboarding, else reload.
export function navigateAfterAuth(
  action: 'reload' | 'onboarding',
  getAndClearReturnUrl: () => string | null
) {
  const returnUrl = getAndClearReturnUrl();
  if (returnUrl) {
    try {
      const parsed = new URL(returnUrl, window.location.origin);
      window.location.href =
        parsed.origin !== window.location.origin ? '/' : returnUrl;
    } catch {
      window.location.href = '/';
    }
    return;
  }
  if (action === 'onboarding') {
    window.location.href = '/dashboard';
    return;
  }
  window.location.reload();
}

const storage = {
  read(): SsoSignal | null {
    try {
      const raw = window.localStorage.getItem(SSO_COMPLETE_STORAGE_KEY);
      return raw ? (JSON.parse(raw) as SsoSignal) : null;
    } catch {
      return null;
    }
  },
  write(signal: SsoSignal) {
    try {
      window.localStorage.setItem(SSO_COMPLETE_STORAGE_KEY, JSON.stringify(signal));
    } catch {
      /* no storage — postMessage / the opener's grace timeout cover it */
    }
  },
  clear() {
    try {
      window.localStorage.removeItem(SSO_COMPLETE_STORAGE_KEY);
    } catch {
      /* ignore */
    }
  },
};

export function markSsoFullPage() {
  try {
    window.sessionStorage.setItem(SSO_FULLPAGE_STORAGE_KEY, '1');
  } catch {
    /* the callback's "still here" fallback covers it */
  }
}

// ── Popup (callback page) side ──────────────────────────────────────────

type SsoCallbackMode = 'popup' | 'fullpage';
let callbackMode: SsoCallbackMode | null = null;

// Called once by the /auth callback page when it starts the code exchange.
// Consumes the full-page marker so a later, unrelated visit starts clean.
export function beginSsoCallback(): SsoCallbackMode {
  if (callbackMode) return callbackMode;
  let fullPage = false;
  try {
    fullPage = window.sessionStorage.getItem(SSO_FULLPAGE_STORAGE_KEY) === '1';
    window.sessionStorage.removeItem(SSO_FULLPAGE_STORAGE_KEY);
  } catch {
    /* no storage — treat as popup; the "still here" fallback lands anyway */
  }
  callbackMode = fullPage ? 'fullpage' : 'popup';
  return callbackMode;
}

export function isSsoPopupCallback(): boolean {
  return callbackMode === 'popup';
}

// Test seam.
export function resetSsoCallbackMode() {
  callbackMode = null;
  completed = false;
}

let completed = false;

// True once this document has signalled — the "still here" fallback and any
// error path that fires while the window is already closing must not act.
export function hasCompletedSsoPopup(): boolean {
  return completed || (typeof window !== 'undefined' && window.closed);
}

// Signal the opener and close. Callers schedule their own
// SSO_CLOSE_FALLBACK_MS "still here" fallback: a close() that didn't take
// means this is the user's own tab and it should land normally. One signal
// per document: a fetch aborted by the closing window must not overwrite a
// success with "Failed to fetch".
export function completeSsoPopup(signal: Omit<SsoSignal, 'ts'>) {
  if (completed) return;
  completed = true;
  const full: SsoSignal = { ...signal, ts: Date.now() };
  storage.write(full);
  try {
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        { type: SSO_COMPLETE_MESSAGE_TYPE, ...full },
        window.location.origin
      );
    }
  } catch {
    /* opener unreachable (COOP) — the storage signal already went out */
  }
  window.close();
}

// ── Opener (login / register page) side ────────────────────────────────

export interface SsoStatus {
  waiting: boolean;
  error: string | null;
}

// The provider buttons are independent components; the page renders one
// status line for all of them through this context.
export const SsoStatusContext = createContext<{
  status: SsoStatus;
  setStatus: (status: SsoStatus) => void;
} | null>(null);

export function useSsoPopup() {
  const fetch = useFetch();
  const t = useT();
  const { getAndClear } = useReturnUrl();
  const shared = useContext(SsoStatusContext);
  const [local, setLocal] = useState<SsoStatus>({ waiting: false, error: null });
  const status = shared?.status ?? local;
  const setStatus = shared?.setStatus ?? setLocal;
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const start = useCallback(
    async (path: string) => {
      cleanupRef.current?.();
      let link: string;
      try {
        const response = await fetch(path);
        if (!response.ok) {
          throw new Error(`Login link request failed with status ${response.status}`);
        }
        link = await response.text();
      } catch (error) {
        console.error('Failed to get login link:', error);
        setStatus({
          waiting: false,
          error: t('sso_start_failed', 'Could not start the sign-in. Please try again.'),
        });
        return;
      }

      storage.clear();
      const startedAt = Date.now();
      const popup = window.open(link, SSO_POPUP_NAME, SSO_POPUP_FEATURES);
      if (!popup) {
        // Popup blocked — classic full-page redirect. Mark this tab so the
        // callback lands here instead of trying to close it.
        markSsoFullPage();
        window.location.href = link;
        return;
      }
      setStatus({ waiting: true, error: null });

      // Accept a signal only if it was written after THIS attempt started.
      const readSignal = () => {
        const signal = storage.read();
        return signal && signal.ts >= startedAt ? signal : null;
      };
      let finished = false;
      const finish = (signal: SsoSignal) => {
        if (finished) return;
        finished = true;
        cleanup();
        storage.clear();
        if (signal.action === 'error') {
          setStatus({
            waiting: false,
            error: signal.message || t('sso_failed', 'Sign-in failed. Please try again.'),
          });
          return;
        }
        navigateAfterAuth(signal.action, getAndClear);
      };
      const poll = window.setInterval(() => {
        const signal = readSignal();
        if (signal) {
          finish(signal);
          return;
        }
        // popup.closed is deliberately not consulted: COOP swaps flip it
        // long before the user finishes.
        if (Date.now() - startedAt > SSO_GRACE_MS) {
          cleanup();
          setStatus({ waiting: false, error: null });
        }
      }, 1000);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== SSO_COMPLETE_STORAGE_KEY || !event.newValue) return;
        // Use the value the event carries (ordered) rather than re-reading
        // storage, which may already hold a later write.
        let signal: SsoSignal | null = null;
        try {
          signal = JSON.parse(event.newValue) as SsoSignal;
        } catch {
          signal = readSignal();
        }
        if (signal && signal.ts >= startedAt) finish(signal);
      };
      const onMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        const data = event.data as Partial<SsoSignal> & { type?: string };
        if (data?.type !== SSO_COMPLETE_MESSAGE_TYPE || !data.action) return;
        finish({ action: data.action, message: data.message, ts: data.ts ?? Date.now() });
      };
      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        window.removeEventListener('storage', onStorage);
        window.clearInterval(poll);
        cleanupRef.current = null;
      };
      cleanupRef.current = cleanup;
      window.addEventListener('message', onMessage);
      window.addEventListener('storage', onStorage);
    },
    [fetch, t, getAndClear, setStatus]
  );

  return { start, waiting: status.waiting, error: status.error };
}
