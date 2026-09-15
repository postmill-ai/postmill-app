'use client';

import { useT } from '@postmill-ai/react/translation/get.transation.service.client';
import { SsoStatus } from '@postmill-ai/frontend/components/auth/sso-popup';

// One line under the social buttons: "continue in the popup" while a sign-in
// popup is open, or the failure the popup reported. (The auth pages mount no
// <Toaster/>.)
export function SsoStatusLine({ status }: { status: SsoStatus }) {
  const t = useT();
  if (status.error) {
    return (
      <div className="text-red-400 text-[13px] mt-[8px]" role="alert">
        {status.error}
      </div>
    );
  }
  if (status.waiting) {
    return (
      <div className="text-[13px] mt-[8px] opacity-80" aria-live="polite">
        {t('sso_continue_in_popup', 'Continue in the sign-in window that just opened…')}
      </div>
    );
  }
  return null;
}
