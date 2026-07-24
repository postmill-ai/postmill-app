'use client';

import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { useVariables } from '@postmill-ai/react/helpers/variable.context';
import { useSearchParams } from 'next/navigation';
import { PublicComponent } from '@postmill-ai/frontend/components/public-api/public.component';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';

export default function Page() {
  const user = useUser();
  const { isGeneral } = useVariables();
  const url = useSearchParams();
  const showLogout = !url.get('onboarding') || user?.tier?.current === 'STARTER';
  return (
    <SettingsGate
      allow={user ? !!user.tier?.api && isGeneral && showLogout : undefined}
    >
      <PublicComponent />
    </SettingsGate>
  );
}
