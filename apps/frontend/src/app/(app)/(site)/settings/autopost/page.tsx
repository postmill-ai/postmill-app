'use client';

import { useUser } from '@postmill-ai/frontend/components/layout/user.context';
import { SettingsGate } from '@postmill-ai/frontend/components/settings/settings-gate';
import { Autopost } from '@postmill-ai/frontend/components/autopost/autopost';

export default function Page() {
  const user = useUser();
  return (
    <SettingsGate allow={user ? !!user.tier : undefined}>
      <Autopost />
    </SettingsGate>
  );
}
