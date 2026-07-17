'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SETTINGS_DEFAULT_PATH } from '@gitroom/frontend/components/settings/settings-paths';

// Route-level guard for tier/permission-gated settings sections. The old SettingsPopup
// render-guarded these tabs (`{tab === 'webhooks' && user?.tier?.webhooks && <Webhooks/>}`),
// so a user without the entitlement saw nothing even via a deep-link. With each section now a
// real route, the nav hides the link but the URL is still reachable — this restores parity by
// redirecting a denied user to the default section.
//
// `allow` is tri-state: `undefined` = still resolving (render nothing, don't redirect — avoids
// a flash / premature bounce while user/permissions load), `true` = render, `false` = redirect.
export const SettingsGate: React.FC<{
  allow: boolean | undefined;
  children: React.ReactNode;
}> = ({ allow, children }) => {
  const router = useRouter();
  useEffect(() => {
    if (allow === false) router.replace(SETTINGS_DEFAULT_PATH);
  }, [allow, router]);
  if (allow !== true) return null;
  return <>{children}</>;
};
