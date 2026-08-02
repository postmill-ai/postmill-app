'use client';

import { ReactNode, useCallback } from 'react';
import { SWRConfig } from 'swr';
import { FetchWrapperComponent } from '@postmill-ai/helpers/utils/custom.fetch';
import { deleteDialog } from '@postmill-ai/react/helpers/delete.dialog';
import { useToaster } from '@postmill-ai/react/toaster/toaster';
import { useReturnUrl } from '@postmill-ai/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
export default function LayoutContext(params: { children: ReactNode }) {
  if (params?.children) {
    // eslint-disable-next-line react/no-children-prop
    return <LayoutContextInner children={params.children} />;
  }
  return <></>;
}
export function setClientCookie(cname: string, cvalue: string, exdays: number) {
  if (typeof document === 'undefined') {
    return;
  }
  if (cname === 'auth') {
    window.location.href = '/auth/logout';
    return;
  }
  const d = new Date();
  d.setTime(d.getTime() + exdays * 24 * 60 * 60 * 1000);
  const expires = 'expires=' + d.toUTCString();
  document.cookie = cname + '=' + cvalue + ';' + expires + ';path=/';
}
export const setCookie = setClientCookie;

// A throttled burst can fire dozens of 429s in a second (every in-flight SWR poll
// fails at once). The toaster shows one message at a time, so without a window the
// user would get a stuttering wall of identical toasts. Module scope, because
// afterRequest is rebuilt whenever its deps change.
const RATE_LIMIT_TOAST_WINDOW_MS = 15000;
let lastRateLimitToastAt = 0;

function LayoutContextInner(params: { children: ReactNode }) {
  const returnUrl = useReturnUrl();
  // useReturnUrl returns a fresh object per render, but its getAndClear member is a
  // stable useCallback — destructure it so afterRequest's deps stay stable.
  const { getAndClear: getAndClearReturnUrl } = returnUrl;
  const { backendUrl, isGeneral, isSecured } = useVariables();
  const t = useT();
  const toaster = useToaster();
  const afterRequest = useCallback(
    async (url: string, options: RequestInit, response: Response) => {
      if (
        typeof window !== 'undefined' &&
        (window.location.href.includes('/p/') ||
          window.location.pathname.startsWith('/provider/'))
      ) {
        return true;
      }
      const logout =
        response?.headers?.get('logout') || response?.headers?.get('Logout');
      if (logout && !isSecured) {
        setClientCookie('showorg', '', -10);
        setClientCookie('impersonate', '', -10);
        window.location.href = '/auth/logout';
        return true;
      }
      const reloadOrOnboarding =
        response?.headers?.get('reload') ||
        response?.headers?.get('onboarding');
      if (reloadOrOnboarding) {
        const getAndClear = getAndClearReturnUrl();
        if (getAndClear) {
          try {
            const parsed = new URL(getAndClear, window.location.origin);
            if (parsed.origin !== window.location.origin) {
              window.location.href = '/';
            } else {
              window.location.href = getAndClear;
            }
          } catch {
            window.location.href = '/';
          }
          return true;
        }
      }
      if (response?.headers?.get('onboarding')) {
        window.location.href = '/dashboard';
        return true;
      }

      if (response?.headers?.get('reload')) {
        window.location.reload();
        return true;
      }

      if (response.status === 401 || response?.headers?.get('logout')) {
        if (!isSecured) {
          setClientCookie('showorg', '', -10);
          setClientCookie('impersonate', '', -10);
        }
        window.location.href = '/auth/logout';
      }
      if (response.status === 406) {
        if (
          await deleteDialog(
            t(
              'currently_on_trial_finish_to_use_feature',
              'You are currently on trial, in order to use the feature you must finish the trial'
            ),
            t('finish_the_trial_charge_me_now', 'Finish the trial, charge me now'),
            t('trial', 'Trial'),

          )
        ) {
          window.open('/billing?finishTrial=true', '_blank');
          return false;
        }
        return false;
      }

      if (response.status === 402) {
        const paymentMessage = (await response.json()).message;
        if (
          await deleteDialog(
            t('payment_required_message', '{{message}}', {
              message: paymentMessage,
            }),
            t('move_to_billing', 'Move to billing'),
            t('payment_required', 'Payment Required')
          )
        ) {
          window.open('/billing', '_blank');
          return false;
        }
        return true;
      }

      // Rate limited. Tell the user what happened instead of letting the caller
      // silently render an error/empty state — and never navigate: a 429 on a
      // background poll is not a reason to move someone off the page they're on.
      if (response.status === 429) {
        const now = Date.now();
        if (now - lastRateLimitToastAt > RATE_LIMIT_TOAST_WINDOW_MS) {
          lastRateLimitToastAt = now;
          const retryAfter = Number(response?.headers?.get('retry-after'));
          toaster.show(
            retryAfter > 0
              ? t(
                  'rate_limited_retry_after',
                  'Too many requests. Please try again in {{seconds}} seconds.',
                  { seconds: retryAfter }
                )
              : t(
                  'rate_limited',
                  'Too many requests. Please slow down and try again in a moment.'
                ),
            'warning'
          );
        }
        return true;
      }
      return true;
    },
    [t, isSecured, getAndClearReturnUrl, toaster]
  );
  return (
    // Bound SWR's retry loop app-wide. The default is unlimited exponential
    // retries, which keeps a saturated throttle bucket saturated. Per-hook
    // options still win over these context defaults.
    <SWRConfig value={{ errorRetryCount: 3 }}>
      <FetchWrapperComponent baseUrl={backendUrl} afterRequest={afterRequest}>
        {params?.children || <></>}
      </FetchWrapperComponent>
    </SWRConfig>
  );
}
