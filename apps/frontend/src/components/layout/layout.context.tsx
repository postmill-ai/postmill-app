'use client';

import { ReactNode, useCallback } from 'react';
import { FetchWrapperComponent } from '@gitroom/helpers/utils/custom.fetch';
import { deleteDialog } from '@gitroom/react/helpers/delete.dialog';
import { useReturnUrl } from '@gitroom/frontend/app/(app)/auth/return.url.component';
import { useVariables } from '@gitroom/react/helpers/variable.context';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
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
function LayoutContextInner(params: { children: ReactNode }) {
  const returnUrl = useReturnUrl();
  // useReturnUrl returns a fresh object per render, but its getAndClear member is a
  // stable useCallback — destructure it so afterRequest's deps stay stable.
  const { getAndClear: getAndClearReturnUrl } = returnUrl;
  const { backendUrl, isGeneral, isSecured } = useVariables();
  const t = useT();
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
      return true;
    },
    [t, isSecured, getAndClearReturnUrl]
  );
  return (
    <FetchWrapperComponent baseUrl={backendUrl} afterRequest={afterRequest}>
      {params?.children || <></>}
    </FetchWrapperComponent>
  );
}
